<script>
  // Repo workspace: list → file tree → editor → commit. All data flows
  // through runConnected; writes pause on the shared approval surface.
  import { onMount } from "svelte";
  import { fly } from "svelte/transition";
  import { runConnected } from "../../lib/workspaces.js";
  import MonacoEditor from "../../components/MonacoEditor.svelte";

  export let onApproval;

  const MAX_EDIT_BYTES = 1_000_000;
  const FLY_IN = { x: 16, duration: 180 };

  // ── pane: repos → tree → editor ─────────────────────────────────
  let pane = "repos";

  // repos
  let repos = [];
  let reposLoading = false;
  let reposError = "";
  let search = "";
  let loggedShape = false;

  // repo + branches
  let owner = "";
  let repo = "";
  let branch = "";
  let branches = [];

  // tree
  let treeRoot = null;
  let treeLoading = false;
  let treeError = "";
  let treeTruncated = false;
  let expanded = new Set();

  // file
  let filePath = "";
  let fileSha = "";
  let fileSize = 0;
  let original = "";
  let text = "";
  let fileLanguage = "plaintext";
  let fileLoading = false;
  let fileError = "";
  let fileBinary = false;
  let fileTooBig = false;

  // commit
  let showCommit = false;
  let commitMsg = "";
  let newBranchName = "";
  let committing = false;
  let commitError = "";
  let committedSha = "";
  let staleFile = false;

  $: dirty = text !== original && !fileLoading && !fileBinary && !fileTooBig;

  const LANG_BY_EXT = {
    js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
    ts: "typescript", tsx: "typescript",
    svelte: "html",
    py: "python",
    json: "json",
    md: "markdown",
    css: "css",
    html: "html", htm: "html",
    yaml: "yaml", yml: "yaml",
    toml: "ini",
    rs: "rust",
    go: "go",
  };

  // ── response helpers (payload can arrive nested; unwrap defensively) ──
  function payload(res) {
    let p = res && res.details !== undefined && res.details !== null ? res.details : res;
    if (p && typeof p === "object" && !Array.isArray(p) && p.data !== undefined) p = p.data;
    return p;
  }
  function asArray(p, ...keys) {
    if (Array.isArray(p)) return p;
    for (const k of keys) {
      if (Array.isArray(p?.[k])) return p[k];
    }
    return [];
  }

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const days = (Date.now() - d.getTime()) / 86400000;
    if (days < 1) return "today";
    if (days < 2) return "yesterday";
    if (days < 30) return `${Math.floor(days)}d ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function toBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  // ── repos ───────────────────────────────────────────────────────
  function normalizeRepo(r) {
    if (!r || typeof r !== "object") return null;
    const full = r.full_name ||
      (r.owner?.login && r.name ? `${r.owner.login}/${r.name}` : r.name || "");
    if (!full) return null;
    const [own, nm] = full.includes("/") ? full.split("/") : [r.owner?.login || "", full];
    return {
      owner: r.owner?.login || own,
      name: r.name || nm,
      full,
      description: r.description || "",
      isPrivate: Boolean(r.private),
      pushedAt: r.pushed_at || "",
      defaultBranch: r.default_branch || "",
    };
  }

  async function loadRepos() {
    reposLoading = true;
    reposError = "";
    try {
      const res = await runConnected(
        "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER",
        { per_page: 100, sort: "pushed" }
      );
      if (!loggedShape) {
        console.debug("[workspace] repo list response shape:", res);
        loggedShape = true;
      }
      const p = payload(res);
      repos = asArray(p, "repositories", "items", "repos")
        .map(normalizeRepo)
        .filter(Boolean);
    } catch (e) {
      reposError = e?.message || "Couldn't load repositories.";
    } finally {
      reposLoading = false;
    }
  }

  $: q = search.trim().toLowerCase();
  $: filtered = q
    ? repos.filter((r) => `${r.full} ${r.description}`.toLowerCase().includes(q))
    : repos;

  // ── tree ────────────────────────────────────────────────────────
  async function openRepo(r) {
    pane = "tree";
    owner = r.owner;
    repo = r.name;
    branch = "";
    branches = [];
    treeRoot = null;
    treeError = "";
    treeTruncated = false;
    expanded = new Set();
    treeLoading = true;
    try {
      const [repoRes, brRes] = await Promise.all([
        runConnected("GITHUB_GET_A_REPOSITORY", { owner, repo }),
        runConnected("GITHUB_LIST_BRANCHES", { owner, repo, per_page: 100 }),
      ]);
      const def = payload(repoRes)?.default_branch || r.defaultBranch || "main";
      branches = asArray(payload(brRes), "branches")
        .map((b) => ({ name: b?.name || "", sha: b?.commit?.sha || "" }))
        .filter((b) => b.name);
      if (!branches.length) branches = [{ name: def, sha: "" }];
      branch = branches.some((b) => b.name === def) ? def : branches[0].name;
      await loadTree();
    } catch (e) {
      treeError = e?.message || "Couldn't open this repository.";
      treeLoading = false;
    }
  }

  async function loadTree() {
    treeLoading = true;
    treeError = "";
    treeRoot = null;
    expanded = new Set();
    try {
      const res = await runConnected("GITHUB_GET_A_TREE", {
        owner, repo, tree_sha: branch, recursive: "1",
      });
      const p = payload(res);
      treeTruncated = Boolean(p?.truncated);
      treeRoot = buildTree(asArray(p, "tree"));
    } catch (e) {
      treeError = e?.message || "Couldn't load the file tree.";
    } finally {
      treeLoading = false;
    }
  }

  function buildTree(items) {
    const root = { dirs: new Map(), files: [] };
    for (const it of items) {
      if (!it || typeof it.path !== "string" || !it.path) continue;
      const parts = it.path.split("/");
      let node = root;
      for (let i = 0; i < parts.length - 1; i++) {
        let d = node.dirs.get(parts[i]);
        if (!d) {
          d = { dirs: new Map(), files: [] };
          node.dirs.set(parts[i], d);
        }
        node = d;
      }
      const name = parts[parts.length - 1];
      if (it.type === "tree") {
        if (!node.dirs.has(name)) node.dirs.set(name, { dirs: new Map(), files: [] });
      } else if (it.type === "blob") {
        node.files.push({ name, path: it.path, size: Number(it.size) || 0 });
      }
    }
    return root;
  }

  function flatten(node, prefix, depth, out, exp) {
    for (const name of [...node.dirs.keys()].sort((a, b) => a.localeCompare(b))) {
      const path = prefix ? `${prefix}/${name}` : name;
      const open = exp.has(path);
      out.push({ kind: "dir", name, path, depth, open });
      if (open) flatten(node.dirs.get(name), path, depth + 1, out, exp);
    }
    for (const f of [...node.files].sort((a, b) => a.name.localeCompare(b.name))) {
      out.push({ kind: "file", name: f.name, path: f.path, size: f.size, depth });
    }
  }

  $: visibleTree = (() => {
    if (!treeRoot) return [];
    const out = [];
    flatten(treeRoot, "", 0, out, expanded);
    return out;
  })();

  function toggleDir(path) {
    if (expanded.has(path)) expanded.delete(path);
    else expanded.add(path);
    expanded = new Set(expanded);
  }

  // ── file ────────────────────────────────────────────────────────
  async function openFile(item) {
    pane = "editor";
    filePath = item.path;
    fileSize = item.size || 0;
    fileSha = "";
    original = "";
    text = "";
    fileError = "";
    fileBinary = false;
    fileTooBig = fileSize > MAX_EDIT_BYTES;
    showCommit = false;
    commitMsg = "";
    newBranchName = "";
    commitError = "";
    committedSha = "";
    staleFile = false;

    const ext = item.name.includes(".") ? item.name.split(".").pop().toLowerCase() : "";
    fileLanguage = LANG_BY_EXT[ext] || "plaintext";

    if (fileTooBig) return; // read-only notice; don't fetch

    fileLoading = true;
    try {
      const res = await runConnected("GITHUB_GET_REPOSITORY_CONTENT", {
        owner, repo, path: item.path, ref: branch,
      });
      const p = payload(res);
      fileSha = p?.sha || "";
      const b64 = typeof p?.content === "string" ? p.content : "";
      const decoded = new TextDecoder().decode(
        Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0))
      );
      if (decoded.includes("0000")) {
        fileBinary = true;
      } else {
        original = decoded;
        text = decoded;
      }
    } catch (e) {
      fileError = e?.message || "Couldn't open this file.";
    } finally {
      fileLoading = false;
    }
  }

  function reloadFile() {
    const name = filePath.split("/").pop() || filePath;
    openFile({ path: filePath, name, size: fileSize });
  }

  // ── commit ──────────────────────────────────────────────────────
  async function commit() {
    const message = commitMsg.trim();
    if (!message || committing) return;
    committing = true;
    commitError = "";
    committedSha = "";
    try {
      let target = branch;
      const newName = newBranchName.trim();
      if (newName) {
        const head = branches.find((b) => b.name === branch)?.sha;
        if (!head) throw new Error("Couldn't resolve the current branch head.");
        await runConnected(
          "GITHUB_CREATE_A_REFERENCE",
          { owner, repo, ref: `refs/heads/${newName}`, sha: head },
          { act: true, onApproval }
        );
        target = newName;
      }
      const res = await runConnected(
        "GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS",
        {
          owner, repo, path: filePath, message,
          branch: target, content: toBase64(text), sha: fileSha,
        },
        { act: true, onApproval }
      );
      const p = payload(res);
      committedSha = p?.commit?.sha || "";
      fileSha = p?.content?.sha || fileSha;
      original = text;
      if (newName) {
        branches = [...branches, { name: newName, sha: committedSha }];
        branch = newName;
      }
      showCommit = false;
      commitMsg = "";
      newBranchName = "";
    } catch (e) {
      const msg = e?.message || "The commit failed.";
      if (/\bsha\b|409|does not match|conflict/i.test(msg)) staleFile = true;
      commitError = msg;
    } finally {
      committing = false;
    }
  }

  onMount(loadRepos);
</script>

<div class="gh">
  {#if pane === "repos"}
    <section class="pane" in:fly={FLY_IN}>
      <div class="pane-bar">
        <div class="search">
          <i class="ti ti-search"></i>
          <input placeholder="Search repositories" bind:value={search} aria-label="Search repositories" />
        </div>
        <button class="icon-btn" on:click={loadRepos} disabled={reposLoading} aria-label="Refresh repositories">
          <i class="ti ti-refresh"></i>
        </button>
      </div>

      {#if reposLoading}
        <div class="center"><span class="spin"></span> Loading repositories…</div>
      {:else if reposError}
        <div class="empty">
          {reposError}
          <div class="empty-act"><button class="btn" on:click={loadRepos}>Retry</button></div>
        </div>
      {:else if !filtered.length}
        <div class="empty">{repos.length ? "No repositories match your search." : "No repositories found."}</div>
      {:else}
        <ul class="repo-list">
          {#each filtered as r (r.full)}
            <li>
              <button class="repo" on:click={() => openRepo(r)}>
                <i class="ti ti-book-2 repo-ic"></i>
                <span class="repo-main">
                  <span class="repo-name">
                    <span class="repo-owner">{r.owner}/</span><b>{r.name}</b>
                    {#if r.isPrivate}<span class="badge">Private</span>{/if}
                  </span>
                  {#if r.description}<span class="repo-desc">{r.description}</span>{/if}
                </span>
                <span class="repo-when">{fmtDate(r.pushedAt)}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

  {:else if pane === "tree"}
    <section class="pane" in:fly={FLY_IN}>
      <div class="pane-bar">
        <button class="icon-btn" on:click={() => (pane = "repos")} aria-label="Back to repositories">
          <i class="ti ti-arrow-left"></i>
        </button>
        <span class="crumb" title="{owner}/{repo}"><b>{owner}/{repo}</b></span>
        <span class="grow"></span>
        <label class="branch-pick">
          <i class="ti ti-git-branch"></i>
          <select bind:value={branch} on:change={loadTree} disabled={treeLoading} aria-label="Branch">
            {#each branches as b (b.name)}
              <option value={b.name}>{b.name}</option>
            {/each}
          </select>
        </label>
      </div>

      {#if treeLoading}
        <div class="center"><span class="spin"></span> Loading files…</div>
      {:else if treeError}
        <div class="empty">
          {treeError}
          <div class="empty-act"><button class="btn" on:click={loadTree}>Retry</button></div>
        </div>
      {:else if !visibleTree.length}
        <div class="empty">This branch looks empty.</div>
      {:else}
        <div class="tree">
          {#if treeTruncated}
            <p class="notice">This repository is large — the file list may be incomplete.</p>
          {/if}
          {#each visibleTree as n (n.path)}
            {#if n.kind === "dir"}
              <button
                class="node"
                style="padding-left: {12 + n.depth * 16}px"
                on:click={() => toggleDir(n.path)}
                aria-expanded={n.open}
                aria-label="{n.open ? 'Collapse' : 'Expand'} folder {n.name}"
              >
                <i class="ti chev {n.open ? 'ti-chevron-down' : 'ti-chevron-right'}"></i>
                <i class="ti folder-ic {n.open ? 'ti-folder-open' : 'ti-folder'}"></i>
                <span class="node-name">{n.name}</span>
              </button>
            {:else}
              <button
                class="node"
                style="padding-left: {30 + n.depth * 16}px"
                on:click={() => openFile(n)}
              >
                <i class="ti ti-file file-ic"></i>
                <span class="node-name">{n.name}</span>
                {#if n.size > MAX_EDIT_BYTES}<span class="badge caution">Too large</span>{/if}
              </button>
            {/if}
          {/each}
        </div>
      {/if}
    </section>

  {:else if pane === "editor"}
    <section class="pane" in:fly={FLY_IN}>
      <div class="pane-bar">
        <button class="icon-btn" on:click={() => (pane = "tree")} aria-label="Back to files">
          <i class="ti ti-arrow-left"></i>
        </button>
        <span class="crumb file-crumb" title={filePath}>
          <i class="ti ti-file"></i>
          <span class="crumb-path">{filePath}</span>
          {#if dirty}<span class="dot" role="status" aria-label="Unsaved changes" title="Unsaved changes"></span>{/if}
        </span>
        <span class="grow"></span>
        <span class="branch-chip"><i class="ti ti-git-branch"></i> {branch}</span>
        <button
          class="btn primary commit-btn"
          disabled={!dirty || staleFile || committing}
          on:click={() => { showCommit = !showCommit; commitError = ""; }}
        >
          Commit changes
        </button>
      </div>

      {#if committedSha}
        <div class="flash safe" transition:fly={{ y: -8, duration: 150 }}>
          <i class="ti ti-check"></i>
          <span>Committed <code>{committedSha.slice(0, 7)}</code> on <b>{branch}</b>.</span>
          <span class="grow"></span>
          <button class="icon-btn" on:click={() => (committedSha = "")} aria-label="Dismiss">
            <i class="ti ti-x"></i>
          </button>
        </div>
      {/if}

      {#if staleFile}
        <div class="flash danger" transition:fly={{ y: -8, duration: 150 }}>
          <i class="ti ti-alert-triangle"></i>
          <span>This file changed upstream — reload it before committing.</span>
          <span class="grow"></span>
          <button class="btn" on:click={reloadFile}>Reload</button>
        </div>
      {/if}

      {#if showCommit}
        <div class="commit-panel" transition:fly={{ y: -10, duration: 160 }}>
          <div class="field">
            <span>Commit message</span>
            <input bind:value={commitMsg} placeholder="Describe this change" maxlength="250" />
          </div>
          <div class="commit-row">
            <span class="commit-target">
              <i class="ti ti-git-branch"></i> Committing to <b>{newBranchName.trim() || branch}</b>
            </span>
            <input
              class="nb-input"
              bind:value={newBranchName}
              placeholder="New branch (optional)"
              aria-label="New branch name"
            />
          </div>
          {#if commitError && !staleFile}
            <p class="commit-err">{commitError}</p>
          {/if}
          <div class="commit-btns">
            <button class="btn primary" disabled={!commitMsg.trim() || committing} on:click={commit}>
              {#if committing}<span class="spin"></span>{/if}
              {committing ? "Committing…" : "Commit"}
            </button>
            <button class="btn ghost" disabled={committing} on:click={() => (showCommit = false)}>
              Cancel
            </button>
          </div>
        </div>
      {/if}

      <div class="editor-body">
        {#if fileLoading}
          <div class="center"><span class="spin"></span> Opening file…</div>
        {:else if fileError}
          <div class="empty">
            {fileError}
            <div class="empty-act"><button class="btn" on:click={reloadFile}>Retry</button></div>
          </div>
        {:else if fileTooBig}
          <div class="empty">This file is over 1 MB, so it's read-only here and too large to open.</div>
        {:else if fileBinary}
          <div class="empty">This looks like a binary file — it can't be edited here.</div>
        {:else}
          <MonacoEditor value={text} language={fileLanguage} on:change={(e) => (text = e.detail)} />
        {/if}
      </div>
    </section>
  {/if}
</div>

<style>
  .gh {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .pane {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .pane-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 20px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .grow { flex: 1; }

  .icon-btn {
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    border-radius: 9px;
    display: grid;
    place-items: center;
    color: var(--text-3);
    font-size: 16px;
    cursor: pointer;
    transition: background var(--t-fast), color var(--t-fast);
  }
  .icon-btn:hover { background: var(--s2); color: var(--text); }
  .icon-btn:disabled { opacity: 0.4; cursor: default; }

  .center {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--text-3);
    font-size: 14px;
  }
  .empty-act { margin-top: 12px; }

  /* ── repos ── */
  .search {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--s2);
    border: 1px solid var(--border);
    border-radius: var(--r-pill);
    padding: 7px 14px;
    color: var(--text-3);
    transition: border-color var(--t-fast), box-shadow var(--t-fast);
  }
  .search:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-bg);
  }
  .search input {
    flex: 1;
    border: none;
    background: none;
    outline: none;
    font-size: 14px;
    color: var(--text);
  }
  .repo-list {
    flex: 1;
    overflow-y: auto;
    margin: 0;
    padding: 8px 12px 24px;
    list-style: none;
  }
  .repo {
    width: 100%;
    display: flex;
    align-items: flex-start;
    gap: 12px;
    text-align: left;
    padding: 12px;
    border-radius: var(--r-md);
    cursor: pointer;
    transition: background var(--t-fast);
  }
  .repo:hover { background: var(--s1); }
  .repo-ic { color: var(--text-3); font-size: 18px; margin-top: 2px; }
  .repo-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .repo-name { display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--text); }
  .repo-owner { color: var(--text-3); }
  .repo-desc {
    font-size: 12.5px;
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .repo-when { font-size: 12px; color: var(--text-3); white-space: nowrap; margin-top: 3px; }

  /* ── tree ── */
  .crumb {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-size: 14px;
    color: var(--text);
    min-width: 0;
  }
  .crumb-path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .file-crumb { flex-shrink: 1; }
  .branch-pick {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    color: var(--text-2);
    font-size: 14px;
  }
  .branch-pick select {
    background: var(--s1);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    padding: 6px 10px;
    max-width: 200px;
    cursor: pointer;
    transition: border-color var(--t-fast), box-shadow var(--t-fast);
  }
  .branch-pick select:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-bg);
    outline: none;
  }
  .tree { flex: 1; overflow: auto; padding: 8px 12px 24px; }
  .notice { margin: 4px 8px 10px; font-size: 12px; color: var(--text-3); }
  .node {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 7px;
    padding: 5px 10px;
    font-size: 13px;
    border-radius: 8px;
    cursor: pointer;
    text-align: left;
    color: var(--text-2);
    transition: background var(--t-fast), color var(--t-fast);
  }
  .node:hover { background: var(--s1); color: var(--text); }
  .chev { font-size: 13px; color: var(--text-3); }
  .folder-ic { color: var(--accent-ink); font-size: 15px; }
  .file-ic { color: var(--text-3); font-size: 15px; }
  .node-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── editor ── */
  .branch-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12.5px;
    color: var(--text-2);
    background: var(--s1);
    border: 1px solid var(--border);
    border-radius: var(--r-pill);
    padding: 4px 12px;
    white-space: nowrap;
  }
  .commit-btn { white-space: nowrap; }
  .dot {
    width: 8px;
    height: 8px;
    flex-shrink: 0;
    border-radius: 50%;
    background: var(--caution);
    display: inline-block;
  }
  .flash {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 20px;
    font-size: 13px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .flash.safe { color: var(--safe); background: var(--safe-bg); }
  .flash.danger { color: var(--danger); background: var(--danger-bg); }
  .flash code {
    font-size: 12px;
    background: var(--s2);
    color: var(--text);
    border-radius: 5px;
    padding: 1px 6px;
  }
  .commit-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 20px;
    background: var(--s1);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .commit-row {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .commit-target {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--text-2);
  }
  .nb-input {
    flex: 1;
    min-width: 180px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    padding: 8px 12px;
    font-size: 13px;
    color: var(--text);
    transition: border-color var(--t-fast), box-shadow var(--t-fast);
  }
  .nb-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-bg);
    outline: none;
  }
  .commit-err { margin: 0; font-size: 12.5px; color: var(--danger); }
  .commit-btns { display: flex; gap: 10px; }
  .editor-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
</style>
