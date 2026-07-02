<script>
  import { onMount } from "svelte";
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
  onMount(load);
</script>

<div class="page">
  <div class="head"><h1>Pages</h1><button class="lemon" on:click={create}><i class="ti ti-plus"></i> New page</button></div>
  {#if loading}<div class="empty">Loading…</div>
  {:else if open}
    <div class="editor">
      <button class="back" on:click={() => { open = null; }}><i class="ti ti-arrow-left"></i> All pages</button>
      <input class="ttl" bind:value={title} on:blur={save} placeholder="Untitled" />
      <textarea class="bdy" bind:value={body} on:blur={save} placeholder="Start writing, or ask Veyra to draft this page for you…"></textarea>
    </div>
  {:else if items.length === 0}
    <div class="empty">No pages yet. Create one, or say "make a page about…" in chat.</div>
  {:else}
    <div class="list">
      {#each items as p}
        <div class="row">
          <button class="rowmain" on:click={() => openPage(p.id)}><i class="ti ti-file-text"></i> {p.title}</button>
          <button class="del" on:click={() => remove(p.id)}><i class="ti ti-trash"></i></button>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .page { max-width: 760px; margin: 0 auto; padding: 28px 24px; }
  .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
  h1 { font-size: 26px; font-weight: 800; letter-spacing: -0.02em; margin: 0; color: var(--text); }
  .lemon { background: var(--accent); color: var(--accent-t); border: none; padding: 9px 16px; border-radius: 10px;
    font-size: 14px; font-weight: 700; cursor: pointer; display: inline-flex; gap: 6px; align-items: center; }
  .list { display: flex; flex-direction: column; gap: 8px; }
  .row { display: flex; align-items: center; background: var(--s1); border: 1px solid var(--border); border-radius: 12px; }
  .rowmain { flex: 1; text-align: left; background: none; border: none; padding: 14px 16px; font-size: 15px;
    color: var(--text); cursor: pointer; display: flex; gap: 10px; align-items: center; }
  .rowmain i { color: var(--accent-t); }
  .del { background: none; border: none; color: var(--text-3); padding: 0 14px; cursor: pointer; }
  .back { background: none; border: none; color: var(--text-2); font-size: 13px; cursor: pointer; margin-bottom: 14px;
    display: inline-flex; gap: 6px; align-items: center; }
  .ttl { width: 100%; font-size: 28px; font-weight: 800; border: none; outline: none; color: var(--text); margin-bottom: 12px; background: none; }
  .bdy { width: 100%; min-height: 340px; border: none; outline: none; resize: vertical; font-size: 16px;
    line-height: 1.7; color: var(--text); background: none; font-family: inherit; }
  .empty { text-align: center; color: var(--text-3); padding: 60px; }
</style>
