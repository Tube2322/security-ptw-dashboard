/* SOC Command Center — Supabase project configuration.
   The URL and anon key below are NOT secrets: Supabase anon/publishable keys are designed to be
   shipped inside client-side code, exactly like this. What actually protects the data is Row
   Level Security (see the `init_soc_schema` migration) — never the secrecy of this key. The
   key that must never appear in this file, or anywhere else client-side, is the `service_role` key.
   This project has no build step, so there is no env-var injection; this checked-in file is the
   config. */
(function () {
  var SUPABASE_URL = 'https://mxlrxivnwtxtiloifksr.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_9_W9xONvn3Gw89F4V_QPZw_mOmoGIF2';

  window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
  });
})();
