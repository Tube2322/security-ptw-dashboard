/* Forwards a completed monthly-inspection record into the matching Microsoft Forms survey run
   by the other department. Microsoft Forms has no public "create response" API (Power Automate
   itself can only read Forms responses, not write them), so the only way to get an unattended
   submission in is to drive a real headless browser through the actual form UI. That means this
   is inherently coupled to the other department's form layout — see FORMS below.

   Field-to-question mapping is POSITIONAL (question 1 = fields[0], question 2 = fields[1], ...),
   verified by hand against both live forms when this was built (question count + labels + option
   text all matched soc-core.js's defaultForms() for these two modules exactly). If the other
   department edits their form (adds/removes/reorders a question), the position mapping goes
   stale — the question-count check below turns that into a clean failure instead of silently
   writing an answer into the wrong question.

   Chromium binary: @sparticuz/chromium (the full package) ships its binary as local files that
   Vercel's build-time bundler is expected to trace and include — in practice that tracing missed
   files this binary depends on (libnss3.so and friends), so every launch failed with "error while
   loading shared libraries: libnss3.so: cannot open shared object file" before ever reaching the
   form. @sparticuz/chromium-min instead downloads a matching prebuilt pack from the package's own
   GitHub release at cold start and unpacks it into /tmp — sidesteps Vercel's bundler entirely, and
   is the combination the package's own README documents as working with Vercel. CHROMIUM_PACK_URL
   must stay pinned to the exact release matching the chromium-min version below (mismatched pairs
   fail the same way). */

/* requiring playwright-core / chromium-min lazily, inside the handler's own try/catch, is
   deliberate: a require()-time crash outside any try/catch surfaces to the caller as Vercel's
   opaque "FUNCTION_INVOCATION_FAILED" page with no detail, whereas catching it here lets us
   return the real error message as JSON — the only way to see what actually broke without
   access to this project's Vercel runtime logs. */
async function loadChromium() {
  const { chromium: playwright } = require('playwright-core');
  /* @sparticuz/chromium-min ships as real ESM (not a CJS build with an __esModule interop flag)
     — require() of it throws "require() of ES Module ... not supported" on Vercel's Node
     runtime. Node's local dev build here happens to support synchronous require(esm) and hid
     this, which is why it only ever showed up once actually deployed. Dynamic import() is what
     Node's own error message says to use instead, and works for both CJS and ESM targets. */
  const chromiumMinExports = await import('@sparticuz/chromium-min');
  const chromium = chromiumMinExports.default || chromiumMinExports;
  return { playwright, chromium };
}
const CHROMIUM_PACK_URL = 'https://github.com/Sparticuz/chromium/releases/download/v149.0.0/chromium-v149.0.0-pack.x64.tar';

/* Same project, same anon key as soc-config.js ships to every browser tab — not a secret (see
   that file's own comment on why). Used here only to log outcomes via the SECURITY DEFINER
   ms_forms_log() RPC and to read/write ms_forms_retry_queue, both already reachable from an
   unauthenticated client today, so this adds no new exposure. */
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  'https://mxlrxivnwtxtiloifksr.supabase.co',
  'sb_publishable_9_W9xONvn3Gw89F4V_QPZw_mOmoGIF2'
);

/* Chromium failing to launch (or the page never settling) under load is transient — the same
   submission tried again a little later routinely just works, which is what happened every time
   this was reproduced today. A question-count mismatch or an unmatched choice is not: the form
   itself has drifted from our mapping, and trying again changes nothing. Only the former is
   worth retrying or queueing; the latter should fail once, loudly, and stay failed. */
function isTransient(err) {
  const msg = String((err && err.message) || err || '');
  return /INSUFFICIENT_RESOURCES|Failed to launch|Target closed|browserType\.launch|Timeout.*exceeded|net::ERR_/i.test(msg);
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

/* One real attempt: launch, navigate, fill, and (unless dryRun) submit. Pulled out of the request
   handler so both the current request and the background retry-queue sweep can call the exact
   same fill logic — the sweep must run the real thing, not a slightly different copy of it. */
async function attemptFill(form, moduleId, data, dryRun) {
  /* Playwright doesn't clean up its per-launch --user-data-dir on a warm/reused Lambda
     container (a documented @sparticuz/chromium caveat) — every invocation leaves a fresh
     /tmp/playwright_chromiumdev_profile-XXXXXX behind, and /tmp is a small fixed-size tmpfs
     shared across warm invocations, not reset per-request. Enough of these accumulate (we hit
     this function dozens of times today testing) and Chromium's own launch starts failing with
     net::ERR_INSUFFICIENT_RESOURCES before it even reaches the form. Sweep them at the start of
     every attempt — best-effort, never fatal — instead of letting them pile up. */
  try {
    const fs = require('fs'), path = require('path');
    const tmpDir = '/tmp';
    const keep = new Set(['chromium', 'chromium-pack', 'al2023', 'fonts', 'swiftshader']);
    for (const name of fs.readdirSync(tmpDir)) {
      if (keep.has(name) || !name.startsWith('playwright_')) continue;
      try { fs.rmSync(path.join(tmpDir, name), { recursive: true, force: true }); } catch (e) {}
    }
  } catch (e) { /* /tmp may not exist yet on a cold start, or not be listable — fine either way */ }

  let browser;
  try {
    const { playwright, chromium } = await loadChromium();
    if (typeof chromium.setGraphicsMode === 'function') chromium.setGraphicsMode(false);
    const executablePath = await chromium.executablePath(CHROMIUM_PACK_URL);
    /* Vercel's function sandbox doesn't have libnss3.so etc. on the default library search path.
       chromium-min's pack unpacks the actual .so files into <dir>/al2023/lib (an AL2023-specific
       lib bundle, since that base image dropped libraries Lambda/Vercel used to ship — confirmed
       by listing /tmp at runtime: libnss3.so etc. live under al2023/lib, not directly in /tmp
       alongside the chromium binary), so LD_LIBRARY_PATH needs both directories. */
    var pathMod = require('path');
    var execDir = pathMod.dirname(executablePath);
    process.env.LD_LIBRARY_PATH = execDir + ':' + pathMod.join(execDir, 'al2023', 'lib');
    browser = await playwright.launch({
      args: chromium.args,
      executablePath: executablePath,
      headless: true
    });
    const page = await browser.newPage();
    await page.goto(form.url, { waitUntil: 'networkidle', timeout: 20000 });

    const items = page.locator('[data-automation-id="questionItem"]');
    /* Some of these forms (the golf-cart one) are configured with a welcome screen, so the
       response page loads with zero questions on it until a "start" button is pressed. The
       button carries no data-automation-id and its label is localized, so it's identified by
       elimination: the only visible button on that screen other than the Microsoft Forms brand
       link in the footer (a product name, not localized text). */
    if (await items.count() === 0) {
      const buttons = page.locator('button:visible');
      const total = await buttons.count();
      for (let i = 0; i < total; i++) {
        const text = norm(await buttons.nth(i).textContent());
        if (!text || text.includes('Microsoft Forms')) continue;
        await buttons.nth(i).click();
        break;
      }
      await items.first().waitFor({ timeout: 10000 });
    }
    const count = await items.count();
    if (count !== form.fields.length) {
      throw new Error(`question count mismatch for ${moduleId}: expected ${form.fields.length}, form now has ${count} — it was likely edited, mapping needs updating`);
    }

    for (let i = 0; i < form.fields.length; i++) {
      await fillQuestion(items.nth(i), form.fields[i], data[form.fields[i].id]);
    }

    /* dryRun proves the whole pipeline (chromium launch, navigation, question-count match,
       every field fill) works without the one irreversible step — clicking submit on a form
       that belongs to another department and can't be un-submitted from our side. */
    if (dryRun) {
      await browser.close();
      return { questionsFilled: form.fields.length };
    }

    await page.locator('[data-automation-id="submitButton"]').click();
    await page.waitForTimeout(1500);
    await browser.close();
    return {};
  } catch (err) {
    if (browser) { try { await browser.close(); } catch (e) {} }
    throw err;
  }
}

/* Retries only transient failures, only for a real (non-dryRun) send — a dry run is a one-shot
   diagnostic, not a submission worth queueing. One short retry only: a launch (browser +
   navigate) can itself take 10-20s under load, and this has to leave enough of the 60s function
   budget (vercel.json) for the queue sweep above plus a real chance to return before Vercel
   kills the invocation outright — a kill produces no response at all, which means the client
   sees a raw network error and the retry-queue insert below never runs either. Anything beyond
   one quick retry is what the queue+sweep is for, not this in-request loop. */
async function attemptWithRetry(form, moduleId, data, dryRun) {
  const delays = dryRun ? [] : [3000];
  let lastErr;
  for (let attempt = 0; ; attempt++) {
    try {
      return await attemptFill(form, moduleId, data, dryRun);
    } catch (err) {
      lastErr = err;
      if (attempt >= delays.length || !isTransient(err)) throw err;
      await sleep(delays[attempt]);
    }
  }
}

/* The date the send is filed under: their own form's date question when it has one, otherwise
   today (monthly_inspection_golf_cart's form asks for no date at all). */
function reportDateFor(form, data) {
  const dateField = form.fields.find((f) => f.type === 'date');
  return (dateField && data[dateField.id]) || new Date().toISOString().slice(0, 10);
}

/* A row still marked 'sending' long after any real send could have finished means nobody ever
   reported back on it: the browser that started it was closed mid-flight, or the function was
   killed before it could mark the row. Either way the submission is in limbo — possibly never
   delivered, and (for traffic+golf) holding a claim no other device will take over. Ten minutes
   is far past the ~20-60s a real send takes, so anything older is safe to treat as abandoned and
   retry from the payload the row itself carries. Returns true when it did work, so the caller
   can keep a single invocation from launching more browsers than its time budget allows. */
async function reapStuckSending() {
  try {
    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: rows, error } = await supabase
      .from('ms_forms_outbox')
      .select('*')
      .eq('status', 'sending')
      .lt('claimed_at', cutoff)
      .lt('attempts', 5)
      .order('claimed_at', { ascending: true })
      .limit(1);
    if (error || !rows || !rows.length) return false;
    const row = rows[0];
    const form = FORMS[row.target_form];
    if (!form || !row.payload) {
      await supabase.rpc('ms_forms_mark', { p_id: row.id, p_ok: false, p_error: 'abandoned: no payload or unknown target form' });
      return true;
    }
    try {
      await attemptFill(form, row.target_form, row.payload, false);
      await supabase.rpc('ms_forms_mark', { p_id: row.id, p_ok: true });
    } catch (err) {
      await supabase.rpc('ms_forms_mark', { p_id: row.id, p_ok: false, p_error: 'stuck send retried and failed: ' + String((err && err.message) || err) });
    }
    return true;
  } catch (e) { return false; /* best-effort — never let this affect the request that triggered it */ }
}

/* One row at a time, and only once it's had a real minute to breathe since it was last touched —
   this runs at the start of every invocation this endpoint gets for any module, so whatever
   submission happens next anywhere in the app is what nudges a stuck row forward. No cron job:
   there is nothing else in this serverless app that runs on a clock. Never allowed to throw —
   a stuck retry row is a problem for its own next sweep, not for the request that happened to
   trigger this one. */
async function sweepRetryQueue() {
  try {
    const cutoff = new Date(Date.now() - 90 * 1000).toISOString();
    const { data: rows, error } = await supabase
      .from('ms_forms_retry_queue')
      .select('*')
      .or(`last_attempt_at.is.null,last_attempt_at.lt.${cutoff}`)
      .order('created_at', { ascending: true })
      .limit(1);
    if (error || !rows || !rows.length) return false;
    const row = rows[0];
    const form = FORMS[row.target_form];
    if (!form) { await supabase.from('ms_forms_retry_queue').delete().eq('id', row.id); return true; }

    try {
      await attemptFill(form, row.target_form, row.payload, false);
      await supabase.from('ms_forms_retry_queue').delete().eq('id', row.id);
      await supabase.rpc('ms_forms_log', { p_target: row.target_form, p_date: row.report_date, p_ok: true });
    } catch (err) {
      const attempts = (row.attempts || 0) + 1;
      if (attempts >= 5 || !isTransient(err)) {
        await supabase.from('ms_forms_retry_queue').delete().eq('id', row.id);
        await supabase.rpc('ms_forms_log', {
          p_target: row.target_form, p_date: row.report_date, p_ok: false,
          p_error: 'retry queue gave up after ' + attempts + ' attempts: ' + String(err && err.message || err)
        });
      } else {
        await supabase.from('ms_forms_retry_queue')
          .update({ attempts, last_attempt_at: new Date().toISOString() })
          .eq('id', row.id);
      }
    }
    return true;
  } catch (e) { return false; /* best-effort — never let a sweep failure affect the request that triggered it */ }
}

const FORMS = {
  monthly_inspection_fire_extinguisher: {
    url: 'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=YDYBfPpivEywct4fZ2hkPDikm5IrrH5LheWy-VUfBo1UN01CWUZPMUtFTUUyWUdWWFRPRlFZNUpXUi4u&origin=QRCode',
    fields: [
      { id: 'mi_fire_ext_date', type: 'date' },
      { id: 'mi_fire_ext_floor', type: 'radio' },
      { id: 'mi_fire_ext_tank_no', type: 'text' },
      { id: 'mi_fire_ext_type', type: 'radio' },
      { id: 'mi_fire_ext_size', type: 'radio' },
      { id: 'mi_fire_ext_condition', type: 'radio' },
      { id: 'mi_fire_ext_gauge', type: 'radio' },
      { id: 'mi_fire_ext_pin', type: 'radio' },
      { id: 'mi_fire_ext_weight', type: 'radio' },
      { id: 'mi_fire_ext_hose', type: 'radio' },
      { id: 'mi_fire_ext_obstruction', type: 'radio' },
      { id: 'mi_fire_ext_label', type: 'radio' },
      { id: 'mi_fire_ext_checker_name', type: 'text' },
      { id: 'mi_fire_ext_inspector_name', type: 'text' },
      { id: 'mi_fire_ext_note', type: 'text' }
    ]
  },
  monthly_inspection_fire_exit: {
    url: 'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=YDYBfPpivEywct4fZ2hkPDikm5IrrH5LheWy-VUfBo1UMkZCRzVPTklDSlgxTVUxTzJKRlk4Uk5WOS4u&origin=QRCode',
    fields: [
      { id: 'mi_fire_exit_date', type: 'date' },
      { id: 'mi_fire_exit_time', type: 'text' },
      { id: 'mi_fire_exit_door', type: 'radio' },
      { id: 'mi_fire_exit_floor', type: 'text' },
      { id: 'mi_fire_exit_obstruction', type: 'radio' },
      { id: 'mi_fire_exit_push_open', type: 'radio' },
      { id: 'mi_fire_exit_alarm', type: 'radio' },
      { id: 'mi_fire_exit_lock_outside', type: 'radio' },
      { id: 'mi_fire_exit_sign', type: 'radio' },
      { id: 'mi_fire_exit_damaged', type: 'radio' },
      { id: 'mi_fire_exit_checker_name', type: 'text' },
      { id: 'mi_fire_exit_inspector_name', type: 'text' },
      { id: 'mi_fire_exit_note', type: 'text' }
    ]
  },
  monthly_inspection_acc_door: {
    url: 'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=YDYBfPpivEywct4fZ2hkPDikm5IrrH5LheWy-VUfBo1UNUVEMTBYVTNDMk9JQzVWMjNLQVRMRUVHQi4u&origin=QRCode',
    fields: [
      { id: 'mi_acc_date', type: 'date' },
      { id: 'mi_acc_time', type: 'text' },
      { id: 'mi_acc_reader_status', type: 'radio' },
      { id: 'mi_acc_floor', type: 'radio' },
      { id: 'mi_acc_electric_lock', type: 'radio' },
      { id: 'mi_acc_magnet', type: 'radio' },
      { id: 'mi_acc_alarm_light', type: 'radio' },
      { id: 'mi_acc_lock_status', type: 'radio' },
      { id: 'mi_acc_sensor_box', type: 'radio' },
      { id: 'mi_acc_emergency_release', type: 'radio' },
      { id: 'mi_acc_note', type: 'text' },
      { id: 'mi_acc_checker_name', type: 'text' },
      { id: 'mi_acc_inspector_name', type: 'text' }
    ]
  },
  monthly_inspection_cctv: {
    url: 'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=YDYBfPpivEywct4fZ2hkPDikm5IrrH5LheWy-VUfBo1UM1pSTTM1U1gzTEY4UjdMSlRaQktHS0pUVS4u&origin=QRCode',
    fields: [
      { id: 'mi_cctv_date', type: 'date' },
      { id: 'mi_cctv_time', type: 'text' },
      { id: 'mi_cctv_nvr_name', type: 'text' },
      { id: 'mi_cctv_location', type: 'text' },
      { id: 'mi_cctv_dust', type: 'radio' },
      { id: 'mi_cctv_crack', type: 'radio' },
      { id: 'mi_cctv_dirty', type: 'radio' },
      { id: 'mi_cctv_status', type: 'radio' },
      { id: 'mi_cctv_note', type: 'text' }
    ]
  },
  /* Visitors — the one module here that isn't part of the ตรวจประจำเดือน group (it's the daily
     visitor-log form). Their form asks the same 7 questions twice (once per visitor type):
     count, org, contact/dept, card no., time in, time out, note — soc-core.js's visitors form
     was extended field-by-field to match (see defaultForms() there) specifically so this
     mapping wouldn't have to leave most of their form blank. visitor_department/
     visitor_inspector are internal-only fields with no counterpart on their form, so they're
     simply absent from this list — nothing to forward for them. */
  visitors: {
    url: 'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=YDYBfPpivEywct4fZ2hkPDikm5IrrH5LheWy-VUfBo1UOFlBRlRES1hEVjY1UzYyR05HSEtNQzNJTy4u&origin=QRCode',
    fields: [
      { id: 'visitor_date', type: 'date' },
      { id: 'visitor_name', type: 'radio' },
      { id: 'visitor_general_count', type: 'text' },
      { id: 'visitor_general_org', type: 'text' },
      { id: 'visitor_general_contact', type: 'text' },
      { id: 'visitor_general_card_no', type: 'text' },
      { id: 'visitor_general_time_in', type: 'text' },
      { id: 'visitor_general_time_out', type: 'text' },
      { id: 'visitor_general_note', type: 'text' },
      { id: 'visitor_contractor_count', type: 'text' },
      { id: 'visitor_org', type: 'text' },
      { id: 'visitor_contractor_contact', type: 'text' },
      { id: 'visitor_contractor_card_no', type: 'text' },
      { id: 'visitor_contractor_time_in', type: 'text' },
      { id: 'visitor_contractor_time_out', type: 'text' },
      { id: 'visitor_contractor_note', type: 'text' }
    ]
  },
  /* Golf cart — their form is the only one of the six that opens on a welcome screen instead of
     the questions (handled below), and the only one whose condition questions are multi-select,
     so most of these are `checkbox`. It also asks for no date at all, which is why mi_golf_date
     isn't in this list. soc-core.js's monthly_inspection_golf_cart form was rewritten from the
     generic total/pass/fail template to match these 13 questions one-for-one. */
  monthly_inspection_golf_cart: {
    url: 'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=YDYBfPpivEywct4fZ2hkPDikm5IrrH5LheWy-VUfBo1UNTRFVTZVRzdORUhaTjNEQlIwQkZRVjVMVi4u',
    fields: [
      { id: 'mi_golf_name', type: 'text' },
      { id: 'mi_golf_cart', type: 'radio' },
      { id: 'mi_golf_body', type: 'checkbox' },
      { id: 'mi_golf_steering', type: 'checkbox' },
      { id: 'mi_golf_horn', type: 'checkbox' },
      { id: 'mi_golf_seat', type: 'checkbox' },
      { id: 'mi_golf_tire', type: 'checkbox' },
      { id: 'mi_golf_cleanliness', type: 'checkbox' },
      { id: 'mi_golf_battery', type: 'checkbox' },
      { id: 'mi_golf_suspension', type: 'checkbox' },
      { id: 'mi_golf_canvas', type: 'checkbox' },
      { id: 'mi_golf_status', type: 'checkbox' },
      { id: 'mi_golf_note', type: 'text' }
    ]
  },
  /* The other department's main daily form ("จำนวนรถเข้าออกประจำวัน") covers TWO of our modules at
     once: the traffic counts (questions 1-10, 15) and the golf-cart rounds (questions 11-14).
     Nothing about our own forms changes for this — the guards still fill traffic and golf
     separately and each dashboard is unchanged; the two days' worth of answers are assembled into
     one submission by ms_forms_traffic_golf() (an RPC, because the unauthenticated entry portal
     can't read the counterpart module's rows itself) and arrive here as one flat data object.
     Their questions 11-14 label carts with a fixed shift ("กะกลางคืน" on cart 1, "กะกลางวัน" on
     2-4); ours are per-cart totals for the whole day, so the mapping stays positional per cart
     and the shift wording in their labels is theirs to interpret. */
  traffic_golf_daily: {
    url: 'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=YDYBfPpivEywct4fZ2hkPDikm5IrrH5LheWy-VUfBo1UMUtZMzdSUTYwUERIR1REMUZCR0dOMEFJNC4u&origin=QRCode',
    fields: [
      { id: 'traffic_date', type: 'date' },
      { id: 'traffic_name', type: 'radio' },
      { id: 'traffic_car_in_day', type: 'text' },
      { id: 'traffic_moto_in_day', type: 'text' },
      { id: 'traffic_car_out_day', type: 'text' },
      { id: 'traffic_moto_out_day', type: 'text' },
      { id: 'traffic_car_in_night', type: 'text' },
      { id: 'traffic_moto_in_night', type: 'text' },
      { id: 'traffic_car_out_night', type: 'text' },
      { id: 'traffic_moto_out_night', type: 'text' },
      { id: 'golf_cart_1', type: 'text' },
      { id: 'golf_cart_2', type: 'text' },
      { id: 'golf_cart_3', type: 'text' },
      { id: 'golf_cart_4', type: 'text' },
      { id: 'traffic_inspector', type: 'text' }
    ]
  }
};

function isoToThaiSlashDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return null;
  return `${parseInt(m[3], 10)}/${parseInt(m[2], 10)}/${m[1]}`;
}

/* textContent, not innerText: innerText is the *rendered* text and depends on layout, so a
   choice that is present but not laid out the way headless Chromium expects can come back as
   an empty string and silently fail to match (that is what made every CCTV radio miss while
   the identical strings compared equal in a real browser). textContent is layout-independent.
   Internal whitespace is collapsed on both sides so a stray newline — or the stray double
   space their golf-cart form has inside one option — can't break an otherwise exact match. */
const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().normalize('NFC');

async function choiceLabels(item) {
  const choices = item.locator('[data-automation-id="choiceItem"]');
  const count = await choices.count();
  const labels = [];
  for (let i = 0; i < count; i++) labels.push(norm(await choices.nth(i).textContent()));
  return { choices, count, labels };
}

/* An allowCustom value that matches none of the fixed options goes into the form's own "อื่นๆ"
   (Other) row — which their form only offers when it means to accept free text there. Detected
   structurally, never by aria-label: that label is localized to the *browser's* UI language, so
   it reads "คำตอบอื่น" in a Thai browser (where this was verified by hand) but "Other answer" in
   the headless en-US one this actually runs in, which is why matching on it found nothing in
   production. Microsoft Forms renders Other in one of two layouts and both are identifiable by
   shape: an extra input sitting outside any choiceItem (always last in DOM order), or an
   ordinary last choiceItem that additionally holds the free-text box. A free-text input inside a
   choice question only ever belongs to Other, so its presence is the tell that works for both.
   Returns false when the question has no Other row at all. */
async function fillOther(item, selector, choices, count, text) {
  const otherInput = item.locator('input[data-automation-id="textInput"]').first();
  if (await otherInput.count() === 0) return false;
  const inputs = item.locator(selector);
  const inputCount = await inputs.count();
  if (inputCount > count) await inputs.nth(inputCount - 1).check();
  else if (count > 0) await choices.last().click();
  await otherInput.fill(text);
  return true;
}

async function fillQuestion(item, field, rawValue) {
  /* checkbox — their multi-select questions. Our own form stores these as an array of the
     picked option texts, with any value that isn't one of the fixed options being the "อื่นๆ"
     free text (see the User Entry Portal's choice renderer), so the same split applies here:
     every value that matches a choice gets checked, everything left over goes into Other. */
  if (field.type === 'checkbox') {
    const values = (Array.isArray(rawValue) ? rawValue : String(rawValue == null ? '' : rawValue).split(','))
      .map((v) => String(v).trim()).filter(Boolean);
    if (!values.length) return;
    const { choices, count, labels } = await choiceLabels(item);
    const custom = [];
    for (const v of values) {
      const idx = labels.indexOf(norm(v));
      /* check(), not click(): a checkbox this record already ticked must not be toggled back
         off if the same value somehow appears twice. */
      if (idx >= 0) await choices.nth(idx).locator('input[type="checkbox"]').check();
      else custom.push(v);
    }
    if (custom.length && !(await fillOther(item, 'input[type="checkbox"]', choices, count, custom.join(', ')))) {
      throw new Error(
        `no matching choice for ${field.id}: sent ${custom.map((s) => `"${s}"`).join(', ')}, form offers ` +
        (labels.length ? labels.map((s) => `"${s}"`).join(', ') : '(no choices found)')
      );
    }
    return;
  }

  const value = rawValue == null ? '' : String(rawValue).trim();
  if (!value) return; // optional/empty field (e.g. หมายเหตุ) — leave blank on the target form too

  if (field.type === 'date') {
    const text = isoToThaiSlashDate(value);
    if (!text) throw new Error(`invalid date value for ${field.id}: ${rawValue}`);
    const input = item.locator('[data-automation-id="dateContainer"] input').first();
    await input.click();
    await input.fill(text);
    await input.press('Escape');
    return;
  }

  if (field.type === 'text') {
    const input = item.locator('input[data-automation-id="textInput"], textarea[data-automation-id="textInput"]').first();
    await input.fill(value);
    return;
  }

  // radio — match the choice whose label equals our stored value.
  const target = norm(value);
  const { choices, count, labels } = await choiceLabels(item);
  const idx = labels.indexOf(target);
  if (idx >= 0) { await choices.nth(idx).click(); return; }
  if (await fillOther(item, 'input[type="radio"]', choices, count, value)) return;
  /* No exact match and no "other" row to put the value in. The old code guessed here — it
     clicked whatever the last choice happened to be and tried to type into a text box next to
     it — which on a form with no "other" option (CCTV) just hung for 30s on a locator that
     doesn't exist, and on a form that *does* have one would have quietly filed a real answer as
     free text under "อื่นๆ". Both are worse than refusing: a value that doesn't fit their
     choices means our form and theirs have drifted, and that needs a human, not a guess. */
  throw new Error(
    `no matching choice for ${field.id}: sent "${value}", form offers ` +
    (labels.length ? labels.map((s) => `"${s}"`).join(', ') : '(no choices found)')
  );
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'method not allowed' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const moduleId = body && body.module;
  const data = (body && body.data) || {};
  const dryRun = !!(body && body.dryRun);
  const form = FORMS[moduleId];
  if (!form) { res.status(400).json({ ok: false, error: 'unsupported module: ' + moduleId }); return; }

  /* Whatever submission triggered this call also nudges one piece of stuck work forward first —
     see the two sweeps' own comments for why this, and not a cron job, is what "wait and resend
     automatically" means in a serverless app with nothing running on a clock. At most ONE of them
     runs per invocation: each launches its own browser, and two of those plus this request's own
     send does not fit in the 60s function budget (vercel.json). The two are disjoint by design —
     the queue holds sends that failed and said so, the reaper picks up sends nobody ever reported
     back on at all. */
  const sweptQueue = await sweepRetryQueue();
  const didBackgroundWork = sweptQueue || await reapStuckSending();

  /* A dry run stakes nothing: it is a diagnostic that deliberately never submits, so it must not
     appear in the outbox or the log as if a real send had been attempted. */
  const isoDate = reportDateFor(form, data);
  let rowId = null;
  if (!dryRun) {
    /* Staked BEFORE the attempt, not after it. This is the fix for submissions vanishing without
       a trace: the row (and its payload) exists from the moment the send starts, so if this
       function or the caller's browser dies mid-flight, reapStuckSending() can still find it and
       finish the job — and the status page shows "กำลังส่ง" instead of nothing at all. */
    try {
      const begun = await supabase.rpc('ms_forms_begin', { p_target: moduleId, p_date: isoDate, p_payload: data });
      rowId = begun && begun.data ? begun.data : null;
    } catch (e) { /* the send itself is still worth attempting even if staking the row failed */ }
  }

  try {
    /* No in-request retry when a background job already spent part of the budget — the failure
       gets queued or reaped either way, and running out of time is what produced the killed
       invocations this whole path is being hardened against. */
    const result = await attemptWithRetry(form, moduleId, data, dryRun || didBackgroundWork);
    if (dryRun) { res.status(200).json({ ok: true, dryRun: true, questionsFilled: result.questionsFilled }); return; }
    if (rowId) await supabase.rpc('ms_forms_mark', { p_id: rowId, p_ok: true });
    res.status(200).json({ ok: true });
  } catch (err) {
    const message = String((err && err.message) || err);
    const transient = !dryRun && isTransient(err);
    if (!dryRun && rowId) {
      try { await supabase.rpc('ms_forms_mark', { p_id: rowId, p_ok: false, p_error: message }); } catch (e) {}
    }
    if (transient) {
      /* Queued so the next call to this endpoint — for any module, not just this one — retries
         it once 90s have passed (see sweepRetryQueue). */
      try {
        await supabase.from('ms_forms_retry_queue').insert({ target_form: moduleId, report_date: isoDate, payload: data });
      } catch (e) { /* queueing is a best-effort safety net, not allowed to mask the real error below */ }
    }
    res.status(502).json({ ok: false, error: message, transient });
  }
};
