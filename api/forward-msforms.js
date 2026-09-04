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

const { chromium: playwright } = require('playwright-core');
const chromium = require('@sparticuz/chromium-min');
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

  // radio — match the choice whose visible label equals our stored value exactly; an
  // allowCustom field whose value isn't one of the fixed options falls back to the form's own
  // "อื่นๆ" choice (assumed to be the last one, matching every form checked so far) plus its
  // free-text box, rather than silently picking nothing.
  const choices = item.locator('[data-automation-id="choiceItem"]');
  const count = await choices.count();
  for (let i = 0; i < count; i++) {
    const c = choices.nth(i);
    const label = (await c.innerText()).trim();
    if (label === value) { await c.click(); return; }
  }
  if (count > 0) {
    const other = choices.last();
    await other.click();
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
    if (typeof chromium.setGraphicsMode === 'function') chromium.setGraphicsMode(false);
    const executablePath = await chromium.executablePath(CHROMIUM_PACK_URL);
    /* Vercel's function sandbox doesn't have libnss3.so etc. on the default library search path
       even though chromium-min just unpacked them right next to the binary — the dynamic loader
       never looks in /tmp/chromium-pack on its own. Pointing LD_LIBRARY_PATH at that directory
       before launch is what actually lets the binary find them; without this line the launch
       fails the exact same way whether the binary came from the bundled package or a downloaded
       pack, which is why switching packages alone didn't fix it. */
    process.env.LD_LIBRARY_PATH = require('path').dirname(executablePath);
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
