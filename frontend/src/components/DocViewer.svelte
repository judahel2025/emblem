<script>
  import { api } from "../lib/api.js";

  export let root = "documents";
  export let path = "";

  let kind = "", html = "", sheets = [], slides = [], pdfUrl = "", imgUrl = "", text = "";
  let loading = true, error = "";

  $: ext = (path.split(".").pop() || "").toLowerCase();
  const raw = (r, p) => `/api/file/raw?root=${encodeURIComponent(r)}&path=${encodeURIComponent(p)}`;

  async function load(r, p) {
    loading = true; error = ""; html = ""; sheets = []; slides = []; text = ""; pdfUrl = ""; imgUrl = "";
    const url = raw(r, p);
    const e = (p.split(".").pop() || "").toLowerCase();
    try {
      if (e === "pdf") {
        kind = "pdf"; pdfUrl = url;
      } else if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(e)) {
        kind = "img"; imgUrl = url;
      } else if (e === "docx") {
        kind = "html";
        const buf = await (await fetch(url)).arrayBuffer();
        const mammoth = await import("mammoth");
        html = (await mammoth.convertToHtml({ arrayBuffer: buf })).value;
      } else if (["xlsx", "xls", "csv", "tsv"].includes(e)) {
        kind = "sheet";
        const buf = await (await fetch(url)).arrayBuffer();
        const XLSX = await import("xlsx");
        const wb = XLSX.read(buf, { type: "array" });
        sheets = wb.SheetNames.map((n) => ({ name: n, html: XLSX.utils.sheet_to_html(wb.Sheets[n], { editable: false }) }));
      } else if (e === "md" || e === "markdown") {
        kind = "html";
        const t = await (await fetch(url)).text();
        const { marked } = await import("marked");
        html = marked.parse(t);
      } else if (e === "pptx") {
        kind = "slides";
        const r2 = await api.execute("docs.read", { path: p, root: r });
        const t = (r2.ok && r2.result?.ok) ? r2.result.text : "";
        slides = t.split(/---\s*Slide\s*\d+\s*---/i).map((s) => s.trim()).filter(Boolean);
      } else {
        kind = "text";
        text = await (await fetch(url)).text();
      }
    } catch (err) { error = String(err); kind = "error"; }
    loading = false;
  }
  $: if (path) load(root, path);
</script>

<div class="dv">
  {#if loading}
    <div class="dstate"><span class="spin"></span> rendering…</div>
  {:else if error}
    <div class="dstate err">Couldn't render this file. <span class="dim">{error}</span></div>
  {:else if kind === "pdf"}
    <iframe class="pdf" src={pdfUrl} title="PDF"></iframe>
  {:else if kind === "img"}
    <div class="imgwrap"><img src={imgUrl} alt={path} /></div>
  {:else if kind === "html"}
    <div class="doc">{@html html}</div>
  {:else if kind === "sheet"}
    <div class="sheets">
      {#each sheets as s}
        <div class="sheettitle">{s.name}</div>
        <div class="sheet">{@html s.html}</div>
      {/each}
    </div>
  {:else if kind === "slides"}
    <div class="slides">
      {#each slides as s, i}
        <div class="slide"><div class="slidenum">Slide {i + 1}</div><pre>{s}</pre></div>
      {/each}
    </div>
  {:else}
    <pre class="text">{text}</pre>
  {/if}
</div>

<style>
  .dv { height: 100%; overflow: auto; background: var(--bg); }
  .dstate { padding: 28px; color: var(--text-3); font-size: 13px; }
  .dstate.err { color: var(--danger); }
  .pdf { width: 100%; height: 100%; min-height: 70vh; border: none; background: #fff; }
  .imgwrap { display: flex; justify-content: center; padding: 16px; }
  .imgwrap img { max-width: 100%; border-radius: 8px; }
  .doc { background: #fff; color: #1a1a1a; padding: 40px 48px; max-width: 820px; margin: 16px auto; border-radius: 6px; line-height: 1.6; font-family: Georgia, "Times New Roman", serif; }
  .doc :global(h1), .doc :global(h2), .doc :global(h3) { color: #111; }
  .doc :global(table) { border-collapse: collapse; }
  .doc :global(td), .doc :global(th) { border: 1px solid #ccc; padding: 5px 9px; }
  .sheets { padding: 12px; }
  .sheettitle { font-size: 12px; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.5px; margin: 10px 4px 6px; }
  .sheet { overflow: auto; background: #fff; color: #1a1a1a; border-radius: 6px; }
  .sheet :global(table) { border-collapse: collapse; width: 100%; font-size: 13px; }
  .sheet :global(td), .sheet :global(th) { border: 1px solid #d8d8d8; padding: 5px 9px; white-space: nowrap; }
  .sheet :global(tr:first-child td) { background: #f3efe8; font-weight: 600; }
  .slides { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
  .slide { background: var(--bg-1); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px 18px; }
  .slidenum { font-size: 11px; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
  .slide pre { margin: 0; white-space: pre-wrap; font-family: inherit; font-size: 14px; line-height: 1.6; }
  .text { margin: 0; padding: 16px; font-family: ui-monospace, monospace; font-size: 13px; line-height: 1.65; color: var(--text); white-space: pre-wrap; }
</style>
