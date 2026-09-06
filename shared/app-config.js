/* VA Venue Demo Public — browser-safe configuration. */
(() => {
  const qs = new URLSearchParams(location.search);
  window.VENUE_DEMO_APP_CONFIG = Object.freeze({
    SUPABASE_URL: "https://lyvdrqilglqwkmajmbai.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_3iEjIeI5LxCq7kHdCQD_Iw_9nvFVMoU",
    VENUE_ID: String(qs.get("venue") || "filarmoniya").trim(),
    LOGIN_PATH: "/VA-Philharmonic-Public-Demo/auth/login.html",
    PLATFORM_ADMIN_PATH: "/VA-Venue-Demo-Public/admin/seance-editor.html"
  });
})();
