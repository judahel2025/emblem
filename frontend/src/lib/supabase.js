// Supabase Auth via the GoTrue REST API — no SDK dependency, keeps the bundle lean.
// On success we store the access_token as `emblem_token`, which the existing API client
// already sends as `Authorization: Bearer` — so the FastAPI JWT middleware verifies it
// and scopes every request to this user. The anon key is publishable by design.

const SUPABASE_URL = "https://sdkukczeysnyxzsahskz.supabase.co";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNka3VrY3pleXNueXh6c2Foc2t6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2NTYyNDAsImV4cCI6MjA5NzIzMjI0MH0.OcTrIoN2zpWGIjexFF6v7CBtEqFnxDkfbm7WUtnvnKo";

const AUTH = `${SUPABASE_URL}/auth/v1`;

function store(session) {
  if (session?.access_token) {
    localStorage.setItem("emblem_token", session.access_token);
    if (session.refresh_token) localStorage.setItem("emblem_refresh", session.refresh_token);
    if (session.user?.email) localStorage.setItem("emblem_email", session.user.email);
  }
}

async function call(path, body) {
  const res = await fetch(`${AUTH}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || data.error || "Auth failed");
  return data;
}

export const auth = {
  isLoggedIn: () => !!localStorage.getItem("emblem_token"),
  email: () => localStorage.getItem("emblem_email") || "",

  async signUp(email, password) {
    const data = await call("/signup", { email, password });
    store(data); // if email-confirm is off, session is returned immediately
    return data;
  },

  async signIn(email, password) {
    const data = await call("/token?grant_type=password", { email, password });
    store(data);
    return data;
  },

  // Redirect to Google via Supabase. Comes back to our origin with tokens in the URL hash.
  signInWithGoogle() {
    const redirect = encodeURIComponent(window.location.origin + window.location.pathname);
    window.location.href =
      `${AUTH}/authorize?provider=google&redirect_to=${redirect}`;
  },

  // Call once on app load: if we just came back from an OAuth redirect, capture the session.
  handleRedirect() {
    if (typeof window === "undefined" || !window.location.hash) return false;
    const p = new URLSearchParams(window.location.hash.slice(1));
    const access_token = p.get("access_token");
    if (!access_token) return false;
    store({ access_token, refresh_token: p.get("refresh_token") });
    // Clean the tokens out of the URL bar.
    history.replaceState(null, "", window.location.pathname + window.location.search);
    return true;
  },

  signOut() {
    localStorage.removeItem("emblem_token");
    localStorage.removeItem("emblem_refresh");
    localStorage.removeItem("emblem_email");
  },
};
