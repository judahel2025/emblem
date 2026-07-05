<script>
  // A neat little rich-text surface: contenteditable + a slim glass toolbar.
  // Formatting via document.execCommand (deprecated on paper, universal in
  // practice) with live active-state highlighting. Emits "change" with HTML.
  import { createEventDispatcher, onMount, onDestroy } from "svelte";

  export let html = "";
  export let placeholder = "Start writing…";

  const dispatch = createEventDispatcher();
  let surface;
  let active = {};

  const TOOLS = [
    { cmd: "bold",          icon: "ti-bold",          label: "Bold (Ctrl+B)" },
    { cmd: "italic",        icon: "ti-italic",        label: "Italic (Ctrl+I)" },
    { cmd: "underline",     icon: "ti-underline",     label: "Underline (Ctrl+U)" },
    { cmd: "strikeThrough", icon: "ti-strikethrough", label: "Strikethrough" },
    { sep: true },
    { cmd: "formatBlock", arg: "h1",         icon: "ti-h-1",    label: "Heading 1", block: "h1" },
    { cmd: "formatBlock", arg: "h2",         icon: "ti-h-2",    label: "Heading 2", block: "h2" },
    { cmd: "formatBlock", arg: "blockquote", icon: "ti-quote",  label: "Quote",     block: "blockquote" },
    { sep: true },
    { cmd: "insertUnorderedList", icon: "ti-list",         label: "Bullet list" },
    { cmd: "insertOrderedList",   icon: "ti-list-numbers", label: "Numbered list" },
    { sep: true },
    { cmd: "removeFormat", icon: "ti-clear-formatting", label: "Clear formatting" },
  ];

  function run(t) {
    surface?.focus();
    if (t.block) {
      // Toggle block formats back to paragraphs.
      const cur = (document.queryCommandValue("formatBlock") || "").toLowerCase();
      document.execCommand("formatBlock", false, cur === t.block ? "p" : t.arg);
    } else {
      document.execCommand(t.cmd, false, t.arg ?? null);
    }
    emit();
    readState();
  }

  function readState() {
    const block = (document.queryCommandValue("formatBlock") || "").toLowerCase();
    active = {
      bold: document.queryCommandState("bold"),
      italic: document.queryCommandState("italic"),
      underline: document.queryCommandState("underline"),
      strikeThrough: document.queryCommandState("strikeThrough"),
      insertUnorderedList: document.queryCommandState("insertUnorderedList"),
      insertOrderedList: document.queryCommandState("insertOrderedList"),
      h1: block === "h1",
      h2: block === "h2",
      blockquote: block === "blockquote",
    };
  }

  const isActive = (t) => t.block ? active[t.block] : active[t.cmd];

  function emit() {
    dispatch("change", surface?.innerHTML ?? "");
  }

  function onSelection() {
    if (surface && document.activeElement === surface) readState();
  }

  onMount(() => {
    surface.innerHTML = html || "";
    document.addEventListener("selectionchange", onSelection);
  });
  onDestroy(() => document.removeEventListener("selectionchange", onSelection));

  /** Replace content from outside (e.g. opening another note). */
  export function setHTML(v) {
    if (surface) surface.innerHTML = v || "";
  }
  export function focus() { surface?.focus(); }
</script>

<div class="re">
  <div class="toolbar glass" role="toolbar" aria-label="Text formatting">
    {#each TOOLS as t}
      {#if t.sep}
        <span class="sep" aria-hidden="true"></span>
      {:else}
        <button class="tbtn" class:on={isActive(t)}
                title={t.label} aria-label={t.label} aria-pressed={isActive(t)}
                on:mousedown|preventDefault={() => run(t)}>
          <i class="ti {t.icon}"></i>
        </button>
      {/if}
    {/each}
  </div>

  <!-- svelte-ignore a11y-no-noninteractive-tabindex -->
  <div class="surface"
       bind:this={surface}
       contenteditable="true"
       data-placeholder={placeholder}
       role="textbox" aria-multiline="true" aria-label="Note body" tabindex="0"
       on:input={emit}
       on:keyup={readState}
       on:mouseup={readState}
       on:blur={() => dispatch("blur")}></div>
</div>

<style>
  .re { display: flex; flex-direction: column; gap: 14px; }

  .toolbar {
    display: flex; align-items: center; gap: 2px; flex-wrap: wrap;
    padding: 5px 7px; border-radius: var(--r-md);
    position: sticky; top: 8px; z-index: 5;
    box-shadow: var(--shadow-sm);
    align-self: flex-start;
  }
  .tbtn {
    width: 30px; height: 30px; border-radius: var(--r-sm);
    display: grid; place-items: center;
    color: var(--text-2); font-size: 16px; cursor: pointer;
    transition: background var(--t-fast), color var(--t-fast);
  }
  .tbtn:hover { background: var(--s2); color: var(--text); }
  .tbtn.on { background: var(--s4); color: var(--bg); }
  .sep { width: 1px; height: 18px; background: var(--border-strong); margin: 0 5px; }

  .surface {
    min-height: 46vh;
    outline: none;
    font-size: 16px; line-height: 1.7; color: var(--text);
    padding-bottom: 20vh;   /* comfortable writing runway */
  }
  .surface:empty::before {
    content: attr(data-placeholder);
    color: var(--text-3);
    pointer-events: none;
  }
  .surface :global(h1) { font-size: 24px; font-weight: 500; letter-spacing: -0.02em; margin: 18px 0 8px; }
  .surface :global(h2) { font-size: 19px; font-weight: 500; letter-spacing: -0.01em; margin: 16px 0 6px; }
  .surface :global(p) { margin: 0 0 10px; }
  .surface :global(blockquote) {
    margin: 10px 0; padding: 4px 14px;
    border-left: 3px solid var(--border-strong); color: var(--text-2);
  }
  .surface :global(ul), .surface :global(ol) { padding-left: 22px; margin: 6px 0; }
  .surface :global(li) { margin: 3px 0; }
</style>
