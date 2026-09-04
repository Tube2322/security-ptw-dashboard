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
  }
};

function isoToThaiSlashDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return null;
  return `${parseInt(m[3], 10)}/${parseInt(m[2], 10)}/${m[1]}`;
}

async function fillQuestion(item, field, rawValue) {
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

  // radio — match the choice whose visible label equals our stored value exactly.
  const choices = item.locator('[data-automation-id="choiceItem"]');
  const count = await choices.count();
  for (let i = 0; i < count; i++) {
    const c = choices.nth(i);
    const label = (await c.innerText()).trim();
    if (label === value) { await c.click(); return; }
  }
  // allowCustom field whose value isn't one of the fixed options falls back to the form's own
  // "อื่นๆ" (other) choice + its free-text box. Microsoft Forms tags that specific radio with
  // aria-label="คำตอบอื่น" (Thai for "other answer") regardless of whether it's wrapped in the
  // same choiceItem markup the fixed choices use — some forms render it as an ordinary last
  // choiceItem (choices.last() alone used to work), others render it as a separate row with no
  // choiceItem wrapper at all (found on the Visitors form: 2 real choiceItems + a bare radio/
  // textInput pair for "other", so choices.last() silently clicked the wrong fixed choice
  // instead). Matching on the aria-label directly works for both layouts.
  const otherRadio = item.locator('[aria-label="คำตอบอื่น"][role="radio"], input[aria-label="คำตอบอื่น"]').first();
  if (await otherRadio.count() > 0) {
    await otherRadio.click();
    const otherInput = item.locator('input[aria-label="คำตอบอื่น"], input[placeholder="อื่นๆ"]').first();
    await otherInput.fill(value);
    return;
  }
  if (count > 0) {
    // no distinct "other" row found at all — last resort, matches the old behavior
    await choices.last().click();
    const otherInput = item.locator('input[data-automation-id="textInput"]').last();
    await otherInput.fill(value);
    return;
  }
  throw new Error(`no choices found for radio field ${field.id}`);
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
      res.status(200).json({ ok: true, dryRun: true, questionsFilled: form.fields.length });
      return;
    }

    await page.locator('[data-automation-id="submitButton"]').click();
    await page.waitForTimeout(1500);

    await browser.close();
    res.status(200).json({ ok: true });
  } catch (err) {
    if (browser) { try { await browser.close(); } catch (e) {} }
    res.status(502).json({ ok: false, error: String(err && err.message || err) });
  }
};
