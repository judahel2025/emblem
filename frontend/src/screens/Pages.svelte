<script>
  import { onMount } from "svelte";
  import { fly, fade } from "svelte/transition";
  import { api } from "../lib/api.js";
  let items = [], open = null, title = "", body = "", loading = true;

  async function load() { loading = true; items = (await api.pages()).items || []; loading = false; }
  async function create() {
    const r = await api.pageCreate("Untitled", []); await load();
    if (r.id) openPage(r.id);
  }
  async function openPage(id) {
    const p = await api.pageGet(id);
    if (p.ok) { open = id; title = p.title; body = (p.blocks?.[0]?.text) || ""; }
  }
  async function save() {
    await api.pageUpdate(open, { title, blocks: body ? [{ type: "text", text: body }] : [] });
    await load();
  }
  async function remove(id) { await api.pageDelete(id); if (open === id) open = null; await load(); }
  const fmtDate = (iso) => {
    if (!iso) return "";
    try { return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }); }
    catch { return ""; }
  };
  onMount(load);
</script>

<div class="page" data-tour="pages-root">
  {#if open}
    <div class="editor" in:fade={{ duration: 180 }}>
      <button class="btn ghost back" on:click={() => { open = null; }} aria-label="Back to all pages">
        <i class="ti ti-arrow-left"></i> All pages
      </button>
      <input class="ttl" bind:value={title} on:blur={save} placeholder="Untitled" aria-label="Page title" />
      <textarea class="bdy" bind:value={body} on:blur={save}
        placeholder="Start writing, or ask Emblem to draft this page for you…" aria-label="Page body"></textarea>
    </div>
  {:else}
    <header class="head">
      <div>
        <h1>Pages</h1>
        <p class="sub">Notes and documents Emblem can read, write, and keep for you.</p>
      </div>
      <button class="btn primary" on:click={create}><i class="ti ti-plus"></i> New page</button>
    </header>

    {#if loading}
      <div class="empty">Loading…</div>
    {:else if items.length === 0}
      <div class="empty blank" in:fade={{ duration: 200 }}>
        <i class="ti ti-file-text"></i>
        <p>Nothing here yet. Pages are where drafts, notes, and plans live.</p>
        <button class="btn primary" on:click={create}><i class="ti ti-plus"></i> Create your first page</button>
      </div>
    {:else}
      <div class="grid">
        {#each items as p, i (p.id)}
          <div class="pcard" in:fly={{ y: 8, duration: 200, delay: Math.min(i * 25, 200) }}>
            <button class="body" on:click={() => openPage(p.id)} aria-label={`Open page ${p.title}`}>
              <i class="ti ti-file-text"></i>
              <span class="name">{p.title || "Untitled"}</span>
              {#if fmtDate(p.updated_at || p.created_at)}
                <span class="date">Updated {fmtDate(p.updated_at || p.created_at)}</span>
              {/if}
            </button>
            <button class="del" on:click={() => remove(p.id)} aria-label={`Delete page ${p.title}`}>
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
    position: relative;
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
  .body {
    display: flex; flex-direction: column; align-items: flex-start; gap: 8px;
    width: 100%; padding: 18px; text-align: left; cursor: pointer;
    border-radius: inherit;
  }
  .body i { font-size: 22px; color: var(--accent-ink); }
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
  .editor { max-width: 760px; margin: 0 auto; display: flex; flex-direction: column; }
  .back { align-self: flex-start; margin-bottom: 20px; cursor: pointer; }
  .ttl {
    width: 100%; font-size: 26px; font-weight: 600; letter-spacing: -0.02em;
    border: none; outline: none; background: none; color: var(--text);
    padding: 0; margin-bottom: 16px;
  }
  .ttl::placeholder { color: var(--text-3); }
  .bdy {
    width: 100%; min-height: 55vh; border: none; outline: none; resize: vertical;
    font-size: 16px; line-height: 1.7; color: var(--text); background: none; font-family: inherit;
    padding: 0;
  }
  .bdy::placeholder { color: var(--text-3); }
</style>
