/* Drains the Microsoft Forms job queue (ms_forms_jobs) on a GitHub Actions machine, where a send is not
   limited by the 60s / small-/tmp / cold-start constraints of a Vercel function.

   Every submission the API could not deliver on the spot is still a row in ms_forms_jobs, so this just
   takes due rows one at a time and sends each with the same fill logic the API uses. A failure puts the
   row back for another go 10 minutes later (ms_forms_job_done) — nothing is ever given up on, and
   everything sent or failed lands in ms_forms_outbox / ms_forms_send_log so the Settings page shows it.

   GitHub's cron is best-effort (runs start late or get skipped for hours), so this does not lean on it:
   while anything is still waiting the run stays alive and polls, and when it has to end it starts its
   own successor through the workflow_dispatch API. Once one run has started, the chain keeps itself going
   until the queue is empty; the cron in the workflow only has to restart it after an idle stretch. */

process.env.MSFORMS_BROWSER = process.env.MSFORMS_BROWSER || 'system-chrome';
const api = require('../api/forward-msforms.js');
const { supabase, usingServiceRole, FORMS, attemptFill } = api.internals;

const PAUSE_MS = Number(process.env.DRAIN_PAUSE_MS || 4000);
const IDLE_MS = Number(process.env.DRAIN_IDLE_MS || 30000);
/* leaves room inside the workflow's own 45-minute timeout for the last send to finish */
const DEADLINE = Date.now() + Number(process.env.DRAIN_MAX_MINUTES || 35) * 60 * 1000;
/* a job parked in the far future (year 2099) is on hold on purpose and must not keep a run alive */
const HELD_FROM = '2098-01-01';
/* if the form keeps refusing submissions, something systematic is wrong — stop instead of hammering it */
const MAX_REJECTS_IN_A_ROW = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function waitingCount() {
  const { count } = await supabase.from('ms_forms_jobs').select('id', { count: 'exact', head: true })
    .neq('status', 'sent').lt('next_attempt_at', HELD_FROM);
  return count == null ? 0 : count;
}

/* starts the next run of this same workflow; needs `actions: write` on GITHUB_TOKEN */
async function startSuccessor() {
  const token = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) return log('no GITHUB_TOKEN / GITHUB_REPOSITORY, not chaining (cron will pick it up)');
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/msforms-drain.yml/dispatches`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    body: JSON.stringify({ ref: process.env.GITHUB_REF_NAME || 'main' })
  });
  log(res.status === 204 ? 'queued the next run' : 'could not queue the next run: HTTP ' + res.status);
}

async function main() {
  if (!usingServiceRole) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is not set — add it as a GitHub Actions repository secret.');
    process.exit(1);
  }

  let sent = 0, failed = 0, rejects = 0, stopped = false;
  while (Date.now() < DEADLINE) {
    const { data, error } = await supabase.rpc('ms_forms_job_claim', { p_stuck_minutes: 10 });
    if (error) { console.error('claim failed:', error.message); process.exit(1); }
    const job = data && data[0];
    if (!job) {
      /* nothing is due right now: either everything is sent, or the rest is waiting out its retry delay */
      if (!(await waitingCount())) break;
      await sleep(IDLE_MS);
      continue;
    }

    const form = FORMS[job.target_form];
    const label = `${job.target_form} ${job.report_date} (job ${job.id}, attempt ${job.attempts})`;
    if (!form) {
      await supabase.rpc('ms_forms_job_done', { p_id: job.id, p_ok: false, p_error: 'unknown target form: ' + job.target_form });
      failed++; log('SKIP unknown target', label); continue;
    }

    let rowId = null;
    try {
      const begun = await supabase.rpc('ms_forms_begin', { p_target: job.target_form, p_date: job.report_date, p_payload: job.payload });
      rowId = begun && begun.data ? begun.data : null;
    } catch (e) { /* the status row is best-effort; the send matters more */ }

    try {
      const result = await attemptFill(form, job.target_form, job.payload, false);
      if (rowId) await supabase.rpc('ms_forms_mark', { p_id: rowId, p_ok: true });
      await supabase.rpc('ms_forms_job_done', { p_id: job.id, p_ok: true });
      sent++; rejects = 0;
      /* the questions vanished (that is what counts as sent) but the thank-you wording was not seen */
      log('SENT  ', label, result && result.confirmed === false ? '(thank-you text not recognised — worth a look)' : '');
    } catch (err) {
      const message = String((err && err.message) || err);
      if (rowId) { try { await supabase.rpc('ms_forms_mark', { p_id: rowId, p_ok: false, p_error: message }); } catch (e) {} }
      await supabase.rpc('ms_forms_job_done', { p_id: job.id, p_ok: false, p_error: message });
      failed++; log('FAILED', label, '-', message.split('\n')[0]);
      rejects = /submit was not accepted/.test(message) ? rejects + 1 : 0;
      if (rejects >= MAX_REJECTS_IN_A_ROW) {
        stopped = true;
        log(`the form refused ${rejects} submissions in a row — stopping this run instead of hammering it`);
        break;
      }
    }
    await sleep(PAUSE_MS);
  }

  const left = await waitingCount();
  log(`done: ${sent} sent, ${failed} failed this run; ${left} still waiting`);
  /* a run that stopped on the breaker still hands over: the next run only takes jobs that are due
     (a refused job is not due for another 10 minutes), so it moves on instead of hammering, and the
     queue keeps draining without waiting for GitHub's cron. A minute's pause first. */
  if (left) {
    if (stopped) await sleep(Number(process.env.DRAIN_COOLDOWN_MS || 60000));
    await startSuccessor();
  }
}

main().catch((e) => { console.error('worker crashed:', e); process.exit(1); });
