(() => {
  "use strict";

  const config = window.VENUE_DEMO_APP_CONFIG;

  if (!config) {
    throw new Error("VENUE_DEMO_APP_CONFIG is not loaded");
  }

  if (!window.supabase?.createClient) {
    throw new Error("Supabase JS library is not loaded");
  }

  if (
    !config.SUPABASE_PUBLISHABLE_KEY ||
    config.SUPABASE_PUBLISHABLE_KEY === "PASTE_PUBLISHABLE_KEY_HERE"
  ) {
    console.warn(
      "Paste the Supabase publishable key into shared/app-config.js before opening the platform."
    );
  }

  const client = window.supabase.createClient(
    config.SUPABASE_URL,
    config.SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      },
      global: {
        headers: {
          "x-client-info": "va-venue-demo-public/1.0"
        }
      }
    }
  );

  const cachedProfiles = new Map();

  function currentRelativeUrl() {
    return `${location.pathname}${location.search}${location.hash}`;
  }

  function loginUrl(next = currentRelativeUrl()) {
    const url = new URL(config.LOGIN_PATH, location.origin);
    if (next) url.searchParams.set("next", next);
    return url.pathname + url.search;
  }

  function authStorageKey() {
    try {
      const projectRef = new URL(config.SUPABASE_URL).hostname.split(".")[0];
      return projectRef ? `sb-${projectRef}-auth-token` : "";
    } catch (_) {
      return "";
    }
  }

  function readStoredAuthSession() {
    const key = authStorageKey();
    if (!key) return null;

    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;

      const saved = JSON.parse(raw);

      if (!saved?.access_token || !saved?.refresh_token) {
        return null;
      }

      return {
        access_token: saved.access_token,
        refresh_token: saved.refresh_token
      };
    } catch (_) {
      return null;
    }
  }

  async function getSession() {
    const { data, error } = await client.auth.getSession();

    if (error) {
      throw error;
    }

    if (data?.session) {
      return data.session;
    }

    // GitHub Pages recovery fallback.
    // In the Public Demo Supabase Auth writes the valid session into localStorage,
    // but on a fresh protected page getSession() may return null before restoring it.
    // Rehydrate only the standard session fields from this project's own auth key.
    const stored = readStoredAuthSession();

    if (!stored) {
      return null;
    }

    const restored = await client.auth.setSession(stored);

    if (restored.error) {
      throw restored.error;
    }

    return restored.data?.session || null;
  }

  async function requireSession() {
    const session = await getSession();

    if (!session) {
      location.replace(loginUrl());
      throw new Error("authentication_required");
    }

    return session;
  }

  async function authenticatedRpc(functionName, args = {}) {
    let session;

    try {
      session = await requireSession();
    } catch (error) {
      return {
        data: null,
        error: {
          code: "authentication_required",
          message: error?.message || "authentication_required"
        },
        status: 401
      };
    }

    const url =
      `${config.SUPABASE_URL}/rest/v1/rpc/${encodeURIComponent(functionName)}`;

    let response;

    try {
      response = await fetch(url, {
        method: "POST",
        cache: "no-store",
        headers: {
          "apikey": config.SUPABASE_PUBLISHABLE_KEY,
          "Authorization": `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
          "x-client-info": "va-venue-demo-public/1.1"
        },
        body: JSON.stringify(args || {})
      });
    } catch (error) {
      return {
        data: null,
        error: {
          code: "network_error",
          message: error?.message || "network_error"
        },
        status: 0
      };
    }

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      return {
        data: null,
        error: body || {
          code: String(response.status),
          message: response.statusText || `HTTP ${response.status}`
        },
        status: response.status,
        statusText: response.statusText
      };
    }

    return {
      data: body,
      error: null,
      status: response.status,
      statusText: response.statusText
    };
  }

  async function getAccessProfile({ refresh = false, venueId = config.VENUE_ID } = {}) {
    const venue = String(venueId || config.VENUE_ID || "").trim();
    if (!refresh && cachedProfiles.has(venue)) return cachedProfiles.get(venue);

    await requireSession();

    const { data, error } = await authenticatedRpc(
      "get_my_access_profile",
      { p_venue_id: venue || null }
    );

    if (error) {
      cachedProfiles.delete(venue);
      if (
        String(error.message || "").includes("staff_profile_not_found") ||
        String(error.message || "").includes("active_staff_role_not_found") ||
        String(error.message || "").includes("venue_access_denied")
      ) {
        throw new Error("staff_access_denied");
      }
      throw error;
    }

    cachedProfiles.set(venue, data);
    return data;
  }

  function hasPermission(profile, permissionCode) {
    return Array.isArray(profile?.permissions) &&
      profile.permissions.includes(permissionCode);
  }

  async function requirePermission(permissionCode, venueId = config.VENUE_ID) {
    const profile = await getAccessProfile({ venueId });

    if (!hasPermission(profile, permissionCode)) {
      const error = new Error(`permission_denied:${permissionCode}`);
      error.code = "permission_denied";
      throw error;
    }

    return profile;
  }

  async function signOut() {
    cachedProfiles.clear();
    await client.auth.signOut();
    location.replace(config.LOGIN_PATH);
  }

  async function invoke(functionName, body) {
    const session = await requireSession();

    const response = await fetch(
      `${config.SUPABASE_URL}/functions/v1/${encodeURIComponent(functionName)}`,
      {
        method: "POST",
        cache: "no-store",
        headers: {
          "apikey": config.SUPABASE_PUBLISHABLE_KEY,
          "Authorization": `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
          "x-client-info": "va-venue-demo-public/1.1"
        },
        body: JSON.stringify(body ?? {})
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok || data?.ok === false) {
      throw new Error(
        data?.error ||
        data?.message ||
        `function_http_${response.status}`
      );
    }

    return data;
  }

  function clearCachedProfile() {
    cachedProfiles.clear();
  }

  const browserClient = new Proxy(client, {
    get(target, prop) {
      if (prop === "rpc") return authenticatedRpc;
      const value = target[prop];
      return typeof value === "function" ? value.bind(target) : value;
    }
  });

  window.PH_SUPABASE = browserClient;

  window.PhAuth = Object.freeze({
    config,
    client: browserClient,
    getSession,
    requireSession,
    getAccessProfile,
    hasPermission,
    requirePermission,
    invoke,
    signOut,
    loginUrl,
    clearCachedProfile
  });
})();
