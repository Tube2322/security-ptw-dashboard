/* Drains the Microsoft Forms job queue (ms_forms_jobs). Run every 20 minutes by
   .github/workflows/msforms-drain.yml on a GitHub Actions machine, where a send is not limited by the
   60s / small-/tmp / cold-start constraints of a Vercel function.

   Every submission the API could not deliver on the spot is still a row in ms_forms_jobs, so this just
   takes due rows one at a time and sends each with the same fill logic the API uses. A failure puts the
   row back for another go 15 minutes later (ms_forms_job_done) — nothing is ever given up on, and
   everything sent or failed lands in ms_forms_outbox / ms_forms_send_log so the Settings page shows it. */

process.env.MSFORMS_BROWSER = process.env.MSFORMS_BROWSER || 'system-chrome';
const api = require('../api/forward-msforms.js');
const { supabase, usingServiceRole, FORMS, attemptFill } = api.internals;

const PAUSE_MS = Number(process.env.DRAIN_PAUSE_MS || 4000);
/* leaves room inside the workflow's own 45-minute timeout for the last send to finish */
const DEADLINE = Date.now() + Number(process.env.DRAIN_MAX_MINUTES || 35) * 60 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function main() {
  if (!usingServiceRole) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is not set — add it as a GitHub Actions repository secret.');
    process.exit(1);
  }

  let sent = 0, failed = 0;
  while (Date.now() < DEADLINE) {
    const { data, error } = await supabase.rpc('ms_forms_job_claim', { p_stuck_minutes: 10 });
    if (error) { console.error('claim failed:', error.message); process.exit(1); }
    const job = data && data[0];
    if (!job) break;

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
      await attemptFill(form, job.target_form, job.payload, false);
      if (rowId) await supabase.rpc('ms_forms_mark', { p_id: rowId, p_ok: true });
      await supabase.rpc('ms_forms_job_done', { p_id: job.id, p_ok: true });
      sent++; log('SENT  ', label);
    } catch (err) {
      const message = String((err && err.message) || err);
      if (rowId) { try { await supabase.rpc('ms_forms_mark', { p_id: rowId, p_ok: false, p_error: message }); } catch (e) {} }
      await supabase.rpc('ms_forms_job_done', { p_id: job.id, p_ok: false, p_error: message });
      failed++; log('FAILED', label, '-', message.split('\n')[0]);
    }
    await sleep(PAUSE_MS);
  }

  const { count } = await supabase.from('ms_forms_jobs').select('id', { count: 'exact', head: true }).neq('status', 'sent');
  log(`done: ${sent} sent, ${failed} failed this run; ${count == null ? '?' : count} still waiting`);
}

main().catch((e) => { console.error('worker crashed:', e); process.exit(1); });
