/* Daily health check of every Microsoft Form the site forwards to (see checkForm in api/forward-msforms.js).
   Opens each live form and verifies the assumptions the sender depends on WITHOUT submitting anything:
   question count, choice/text questions, and that dates come back from the form as the day that was typed.
   The result of each form is stored in ms_forms_health (the Settings page shows it), and the run fails when
   any form is unhealthy so GitHub Actions sends its usual "workflow failed" e-mail. */

process.env.MSFORMS_BROWSER = process.env.MSFORMS_BROWSER || 'system-chrome';
const api = require('../api/forward-msforms.js');
const { supabase, usingServiceRole, FORMS, launchBrowser, checkForm } = api.internals;

async function main() {
  if (!usingServiceRole) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is not set — add it as a GitHub Actions repository secret.');
    process.exit(1);
  }
  const browser = await launchBrowser();
  let unhealthy = 0;
  try {
    for (const [target, form] of Object.entries(FORMS)) {
      const res = await checkForm(browser, target, form);
      const detail = res.ok ? null : res.problems.join(' | ').slice(0, 500);
      console.log((res.ok ? 'OK    ' : 'PROBLEM'), target, detail || '');
      if (!res.ok) unhealthy++;
      const { error } = await supabase.rpc('ms_forms_health_set', { p_target: target, p_ok: res.ok, p_detail: detail });
      if (error) console.error('could not store the result for', target, '-', error.message);
    }
  } finally {
    await browser.close().catch(() => {});
  }
  console.log(unhealthy ? `${unhealthy} form(s) need attention` : 'all forms healthy');
  if (unhealthy) process.exit(1);
}

main().catch((e) => { console.error('health check crashed:', e); process.exit(1); });
