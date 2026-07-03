// Theme: light | dark | system. The inline script in index.html sets the initial
// data-theme before paint; this store keeps it live afterwards (toggle + OS changes).
import { writable, derived } from "svelte/store";

const KEY = "emblem_theme";
const media = typeof matchMedia !== "undefined"
  ? matchMedia("(prefers-color-scheme: dark)") : null;

function stored() {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch { return "system"; }
}

export const theme = writable(stored());                 // the user's preference
export const systemDark = writable(media?.matches ?? false);

media?.addEventListener("change", (e) => systemDark.set(e.matches));

export const resolvedTheme = derived([theme, systemDark], ([$t, $sysDark]) =>
  $t === "system" ? ($sysDark ? "dark" : "light") : $t);

resolvedTheme.subscribe((mode) => {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = mode;
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.content = mode === "dark" ? "#0b0b0d" : "#ffffff";
});

export function setTheme(pref) {
  theme.set(pref);
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch { /* private mode */ }
}
