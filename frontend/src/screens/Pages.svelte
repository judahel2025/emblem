<script>
  // Pages — notes and documents with a REAL creation flow: rich editor
  // (bold/italic/headings/lists/quotes), a color per note, and an explicit
  // Deploy. Content model: blocks [{t:"html", html}], color carried in the
  // pages.icon column (no migration). Legacy agent blocks ({t:"p"}/{type:
  // "text"}) convert to paragraphs on open and upgrade losslessly on save.
  import { onMount, tick } from "svelte";
  import { fly, fade } from "svelte/transition";
  import { api } from "../lib/api.js";
  import { notify } from "../lib/store.js";
  import RichEditor from "../components/RichEditor.svelte";

  let items = [], open = null, title = "", html = "", color = "default", loading = true;
  let editor;
  let titleEl;
  let dirty = false;
  let saving = false;
  let savedFlash = false;

  // Muted "paper" palette — quiet enough to live inside the mono system.
  const COLORS = [
    { id: "default",  tint: "transparent",              chip: "var(--s3)" },
    { id: "graphite", tint: "rgba(120,120,120,0.10)",   chip: "#8a8a8a" },
    { id: "sand",     tint: "rgba(214,177,106,0.14)",   chip: "#d6b16a" },
    { id: "sage",     tint: "rgba(134,178,142,0.14)",   chip: "#86b28e" },
    { id: "blush",    tint: "rgba(219,148,148,0.13)",   chip: "#db9494" },
    { id: "mist",     tint: "rgba(139,169,182,0.14)",   chip: "#8ba9b6" },
    { id: "lavender", tint: "rgba(163,146,196,0.13)",   chip: "#a392c4" },
  ];
  const colorOf = (id) => COLORS.find((c) => c.id === id) || COLORS[0];

  // ── Sanitize before injecting into the editor/cards (agent + tool content
  //    is data, never trusted markup). ────────────────────────────────────────
  function sanitize(raw) {
    try {
      const doc = new DOMParser().parseFromString(`<div>${raw || ""}</div>`, "text/html");
      const rootEl = doc.body.firstElementChild;
      for (const el of [...rootEl.querySelectorAll("script,style,iframe,object,embed,link,meta,form")]) el.remove();
      for (const el of rootEl.querySelectorAll("*")) {
        for (const attr of [...el.attributes]) {
          const n = attr.name.toLowerCase();
          if (n.startsWith("on") || (n === "href" && /^\s*javascript:/i.test(attr.value)) ||
              (n === "src" && /^\s*javascript:/i.test(attr.value))) el.removeAttribute(attr.name);
        }
      }
      return rootEl.innerHTML;
    } catch { return ""; }
  }

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  /** blocks (any era) → HTML for the editor. */
  function blocksToHtml(blocks) {
    if (!Array.isArray(blocks)) return "";
    return sanitize(blocks.map((b) => {
      if (b && typeof b.html === "string") return b.html;
      const text = b?.text ?? "";
      return text ? `<p>${esc(text)}</p>` : "";
    }).join(""));
  }

  async function load() { loading = true; items = (await api.pages()).items || []; loading = false; }

  async function create() {
    try {
      const r = await api.pageCreate("", []);
      await load();
      if (r.id) await openPage(r.id, true);
    } catch (e) { notify(`Couldn't create: ${e.message}`, "danger"); }
  }

  async function openPage(id, focusTitle = false) {
    try {
      const p = await api.pageGet(id);
      if (!p.ok && !p.id && !p.title && !Array.isArray(p.blocks)) throw new Error("not found");
      open = id;
      title = p.title === "Untitled" ? "" : (p.title || "");
      color = p.icon && COLORS.some((c) => c.id === p.icon) ? p.icon : "default";
      html = blocksToHtml(p.blocks);
      dirty = false;
      await tick();
      editor?.setHTML(html);
      if (focusTitle) titleEl?.focus();
    } catch (e) { notify("Couldn't open that page.", "danger"); }
  }

  async function save(showFlash = false) {
    if (!open || saving) return;
    saving = true;
    try {
      const clean = sanitize(html);
      await api.pageUpdate(open, {
        title: title.trim() || "Untitled",
        blocks: clean ? [{ t: "html", html: clean }] : [],
        icon: color,
      });
      dirty = false;
      if (showFlash) { savedFlash = true; setTimeout(() => savedFlash = false, 1600); }
      await load();
    } catch (e) { notify(`Couldn't save: ${e.message}`, "danger"); }
    saving = false;
  }

  async function deploy() {
    await save(true);
    notify("Note deployed", "safe");
    open = null;
  }

  async function closeEditor() {
    if (dirty) await save(false);
    open = null;
  }

  async function remove(id) {
    try { await api.pageDelete(id); } catch (e) { notify(`Couldn't delete: ${e.message}`, "danger"); }
    if (open === id) open = null;
    await load();
  }

  function onBody(e) { html = e.detail; dirty = true; }
  function pickColor(id) { color = id; dirty = true; }

  const fmtDate = (iso) => {
    if (!iso) return "";
    try { return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }); }
    catch { return ""; }
  };
  onMount(load);
</script>

<div class="page" data-tour="pages-root">
  {#if open}
    <div class="editor" in:fade={{ duration: 180 }} style={`--note-tint: ${colorOf(color).tint};`}>
      <div class="ebar">
        <button class="btn ghost back" on:click={closeEditor} aria-label="Back to all pages">
          <i class="ti ti-arrow-left"></i> All pages
        </button>
        <div class="ebar-right">
          {#if savedFlash}<span class="saved" in:fade={{ duration: 120 }}><i class="ti ti-check"></i> Saved</span>
          {:else if dirty}<span class="unsaved">Unsaved changes</span>{/if}
          <button class="btn primary" on:click={deploy} disabled={saving}>
            {saving ? "Deploying…" : "Deploy"} <i class="ti ti-arrow-up-right"></i>
          </button>
        </div>
      </div>

      <div class="sheet" class:tinted={color !== "default"}>
        <input class="ttl" bind:this={titleEl} bind:value={title}
               on:input={() => dirty = true} on:blur={() => save(false)}
               placeholder="Give it a title" aria-label="Note title" />

        <div class="swatches" role="radiogroup" aria-label="Note color">
          {#each COLORS as c}
            <button class="sw" class:on={color === c.id}
                    style={`--chip: ${c.chip};`}
                    role="radio" aria-checked={color === c.id} aria-label={`Color ${c.id}`}
                    title={c.id}
                    on:click={() => pickColor(c.id)}></button>
          {/each}
        </div>

        <RichEditor bind:this={editor} {html}
                    placeholder="Start writing, or ask Emblem to draft this note for you…"
                    on:change={onBody} on:blur={() => save(false)} />
      </div>
    </div>
  {:else}
    <header class="head">
      <div>
        <h1>Pages</h1>
        <p class="sub">Notes and documents Emblem can read, write, and keep for you.</p>
      </div>
      <button class="btn primary" on:click={create}><i class="ti ti-plus"></i> New note</button>
    </header>

    {#if loading}
      <div class="empty">Loading…</div>
    {:else if items.length === 0}
      <div class="empty blank" in:fade={{ duration: 200 }}>
        <i class="ti ti-file-text"></i>
        <p>Nothing here yet. Pages are where drafts, notes, and plans live.</p>
        <button class="btn primary" on:click={create}><i class="ti ti-plus"></i> Create your first note</button>
      </div>
    {:else}
      <div class="grid">
        {#each items as p, i (p.id)}
          {@const c = colorOf(p.icon)}
          <div class="pcard" in:fly={{ y: 8, duration: 200, delay: Math.min(i * 25, 200) }}>
            <span class="cbar" style={`background: ${p.icon && p.icon !== "default" ? c.chip : "transparent"};`} aria-hidden="true"></span>
            <button class="body" on:click={() => openPage(p.id)} aria-label={`Open ${p.title || "untitled note"}`}>
              <span class="chip" style={`background: ${c.tint === "transparent" ? "var(--s2)" : c.tint}; color: ${p.icon && p.icon !== "default" ? c.chip : "var(--text-2)"};`}>
                <i class="ti ti-file-text"></i>
              </span>
              <span class="name">{p.title || "Untitled"}</span>
              {#if fmtDate(p.updated_at || p.created_at)}
                <span class="date">Updated {fmtDate(p.updated_at || p.created_at)}</span>
              {/if}
            </button>
            <button class="del" on:click={() => remove(p.id)} aria-label={`Delete ${p.title || "untitled note"}`}>
              <i class="ti ti-trash"></i>
            </button>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .page { max-width: 960px; margin: 0 auto; padding: 28px 24px 60px; }

  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 24px; }
  h1 { font-size: 20px; font-weight: 600; margin: 0 0 4px; color: var(--text); }
  .sub { color: var(--text-2); font-size: 13px; margin: 0; }

  /* ── Card grid ── */
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }
  .pcard {
    position: relative; overflow: hidden;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-sm);
    transition: border-color var(--t-fast), box-shadow var(--t-fast), transform var(--t-fast);
  }
  .pcard:hover {
    border-color: var(--border-strong);
    box-shadow: var(--shadow-md);
    transform: translateY(-1px);
  }
  .cbar { position: absolute; top: 0; left: 0; right: 0; height: 3px; }
  .body {
    display: flex; flex-direction: column; align-items: flex-start; gap: 8px;
    width: 100%; padding: 18px; text-align: left; cursor: pointer;
    border-radius: inherit;
  }
  .chip {
    width: 34px; height: 34px; border-radius: var(--r-sm);
    display: grid; place-items: center; font-size: 18px;
  }
  .name {
    font-size: 15px; font-weight: 600; color: var(--text); letter-spacing: -0.01em;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .date { font-size: 12px; color: var(--text-3); }
  .del {
    position: absolute; top: 10px; right: 10px;
    width: 30px; height: 30px; border-radius: var(--r-sm);
    display: grid; place-items: center;
    color: var(--text-3); cursor: pointer;
    opacity: 0; transition: opacity var(--t-fast), color var(--t-fast), background var(--t-fast);
  }
  .pcard:hover .del, .del:focus-visible { opacity: 1; }
  .del:hover { color: var(--danger); background: var(--danger-bg); }

  /* ── Empty state ── */
  .empty.blank { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 72px 24px; }
  .empty.blank i { font-size: 40px; color: var(--text-3); }
  .empty.blank p { margin: 0; font-size: 14px; color: var(--text-2); max-width: 360px; }

  /* ── Editor ── */
  .editor { max-width: 780px; margin: 0 auto; display: flex; flex-direction: column; }
  .ebar { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 18px; }
  .back { cursor: pointer; }
  .ebar-right { display: flex; align-items: center; gap: 12px; }
  .saved { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--safe); }
  .unsaved { font-size: 12.5px; color: var(--text-3); }

  .sheet {
    border-radius: var(--r-lg);
    padding: 26px 28px 32px;
    background: linear-gradient(var(--note-tint), var(--note-tint)), var(--bg);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-sm);
    transition: background var(--t-normal);
  }

  .ttl {
    width: 100%; font-size: 26px; font-weight: 600; letter-spacing: -0.02em;
    border: none; outline: none; background: none; color: var(--text);
    padding: 0; margin-bottom: 12px;
  }
  .ttl::placeholder { color: var(--text-3); }

  .swatches { display: flex; align-items: center; gap: 8px; margin-bottom: 18px; }
  .sw {
    width: 20px; height: 20px; border-radius: 50%;
    background: var(--chip);
    border: 2px solid transparent;
    cursor: pointer;
    transition: transform var(--t-fast), border-color var(--t-fast), box-shadow var(--t-fast);
  }
  .sw:hover { transform: scale(1.15); }
  .sw.on { border-color: var(--text); box-shadow: 0 0 0 2px var(--bg), 0 0 8px var(--accent-glow); }
</style>
