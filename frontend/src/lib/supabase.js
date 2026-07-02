// Auth client — talks to the Emblem Worker's own /auth/* endpoints (Cloudflare-native,
// no Supabase). On success we store the Worker-signed JWT as `emblem_token`, which the
// API client sends as `Authorization: Bearer` and the Worker verifies on every request.
// (File name kept as supabase.js so imports don't churn; the `auth` interface is identical.)

import { API_BASE } from "./api.js";

const base = () => API_BASE || "";

function store(data) {
  if (data?.token) {
    localStorage.setItem("emblem_token", data.token);
    if (data.email) localStorage.setItem("emblem_email", data.email);
  }
}

async function call(path, body) {
  const res = await fetch(`${base()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Auth failed");
  return data;
}

export const auth = {
  isLoggedIn: () => !!localStorage.getItem("emblem_token"),
  email: () => localStorage.getItem("emblem_email") || "",

  async signUp(email, password) {
    const data = await call("/auth/signup", { email, password });
    store({ ...data, email });
    return data;
  },

  async signIn(email, password) {
    const data = await call("/auth/login", { email, password });
    store({ ...data, email });
    return data;
  },

  // Full-page redirect to the Worker, which bounces to Google and back with the JWT in the hash.
  signInWithGoogle() {
    window.location.href = `${base()}/auth/google`;
  },

  // On load: capture a token handed back in the URL hash after Google sign-in.
  handleRedirect() {
    if (typeof window === "undefined" || !window.location.hash) return false;
    const p = new URLSearchParams(window.location.hash.slice(1));
    const token = p.get("emblem_token");
    if (!token) return false;
    localStorage.setItem("emblem_token", token);
    history.replaceState(null, "", window.location.pathname + window.location.search);
    return true;
  },

  signOut() {
    localStorage.removeItem("emblem_token");
    localStorage.removeItem("emblem_email");
  },
};
