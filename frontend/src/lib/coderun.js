// In-browser code execution, free, no server, no cold starts. The browser IS the
// sandbox (same idea that runs document generation client-side):
//   • JS / TS  → a sandboxed <iframe> (sandbox="allow-scripts", no same-origin) that
//                captures console output and posts it back. It cannot touch our page.
//   • HTML     → rendered live via iframe srcdoc (a real preview).
//   • Python   → Pyodide (CPython compiled to WASM), lazy-loaded from the CDN once.
// Anything else (Go/Rust/Java/native) isn't runnable in-browser, the caller offers
// the github.dev / Codespaces link instead.

export const RUNNABLE = new Set(["javascript", "js", "typescript", "ts", "html", "python", "py"]);

export function langOf(fileName = "") {
  const ext = fileName.split(".").pop().toLowerCase();
  return ({ js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
            ts: "typescript", tsx: "typescript", html: "html", htm: "html",
            py: "python" })[ext] || ext;
}

export function canRun(fileNameOrLang) {
  const l = fileNameOrLang.includes(".") ? langOf(fileNameOrLang) : fileNameOrLang.toLowerCase();
  return RUNNABLE.has(l);
}

// ── JS/TS in a sandboxed iframe ────────────────────────────────────────────────
// TS is run as JS after a naive type-strip (good enough for snippets; no full tsc).
function stripTypes(src) {
  return src
    .replace(/^\s*import\s+type\s+.*$/gm, "")
    .replace(/:\s*[A-Za-z_$][\w$<>\[\].,\s|&]*(?=\s*[=,);{])/g, "")   // : Type annotations
    .replace(/\bas\s+[A-Za-z_$][\w$<>\[\].]*/g, "")                    // as Type
    .replace(/<[A-Za-z_$][\w$,\s]*>(?=\()/g, "");                       // generic call args
}

export function runJs(code, lang = "javascript", timeoutMs = 6000) {
  const src = lang === "typescript" ? stripTypes(code) : code;
  return new Promise((resolve) => {
    const logs = [];
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.sandbox = "allow-scripts";
    const html = `<!doctype html><script>
      const send = (level, args) => parent.postMessage({ __run: 1, level,
        text: args.map(a => { try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
                              catch { return String(a); } }).join(' ') }, '*');
      ['log','info','warn','error'].forEach(l => { const o = console[l];
        console[l] = (...a) => { send(l, a); try { o.apply(console, a); } catch {} }; });
      window.onerror = (m) => { send('error', [m]); };
      window.addEventListener('unhandledrejection', e => send('error', ['Unhandled: ' + (e.reason?.message || e.reason)]));
      (async () => { try {
        ${src}
      } catch (e) { send('error', [e && e.stack ? e.stack : String(e)]); }
        parent.postMessage({ __run: 1, done: 1 }, '*'); })();
    <\/script>`;
    let done = false;
    const finish = () => { if (done) return; done = true;
      window.removeEventListener("message", onMsg); clearTimeout(timer);
      try { iframe.remove(); } catch {}
      resolve({ logs, ok: !logs.some(l => l.level === "error") }); };
    const onMsg = (e) => {
      const d = e.data; if (!d || !d.__run) return;
      if (d.done) return finish();
      logs.push({ level: d.level, text: d.text });
    };
    window.addEventListener("message", onMsg);
    const timer = setTimeout(() => { logs.push({ level: "warn", text: `⏱ stopped after ${timeoutMs / 1000}s` }); finish(); }, timeoutMs);
    iframe.srcdoc = html;
    document.body.appendChild(iframe);
  });
}

// ── HTML live preview (returns srcdoc for an iframe the caller renders) ─────────
export function htmlPreview(code) { return code; }

// ── Python via Pyodide (lazy-loaded once from the CDN) ─────────────────────────
let _pyodide = null, _pyLoading = null;
const PYODIDE_VER = "0.27.2";
async function getPyodide(onStatus) {
  if (_pyodide) return _pyodide;
  if (_pyLoading) return _pyLoading;
  _pyLoading = (async () => {
    onStatus?.("Loading Python (first run only)…");
    const base = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VER}/full/`;
    const mod = await import(/* @vite-ignore */ base + "pyodide.mjs");
    _pyodide = await mod.loadPyodide({ indexURL: base });
    return _pyodide;
  })();
  return _pyLoading;
}

export async function runPython(code, onStatus, timeoutMs = 15000) {
  const logs = [];
  let py;
  try { py = await getPyodide(onStatus); }
  catch (e) { return { logs: [{ level: "error", text: "Couldn't load Python: " + (e?.message || e) }], ok: false }; }
  onStatus?.("");
  py.setStdout({ batched: (s) => logs.push({ level: "log", text: s }) });
  py.setStderr({ batched: (s) => logs.push({ level: "error", text: s }) });
  try {
    const run = py.runPythonAsync(code);
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error(`stopped after ${timeoutMs / 1000}s`)), timeoutMs));
    await Promise.race([run, timeout]);
    return { logs, ok: !logs.some(l => l.level === "error") };
  } catch (e) {
    logs.push({ level: "error", text: String(e?.message || e) });
    return { logs, ok: false };
  }
}

// ── github.dev (web VS Code) link ──────────────────────────────────────────────
export function githubDevUrl(owner, repo, branch, path) {
  const p = path ? `/blob/${branch || "main"}/${path}` : "";
  return `https://github.dev/${owner}/${repo}${p}`;
}
