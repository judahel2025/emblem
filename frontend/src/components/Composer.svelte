<script>
  // The ChatGPT-style composer pill: attach + textarea + mic + send.
  // Pure input component — the parent owns submit/attach/mic behavior.
  import { createEventDispatcher } from "svelte";

  export let disabled = false;
  export let uploading = false;
  export let placeholder = "Ask anything";

  const dispatch = createEventDispatcher();
  let text = "";
  let ta;
  let fileInput;

  function autogrow() {
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 180) + "px";
  }

  function submit() {
    const v = text.trim();
    if (!v || disabled) return;
    text = "";
    autogrow();
    dispatch("submit", v);
  }

  function onKey(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  }

  function onFile(e) {
    const file = e.target.files?.[0];
    if (file) dispatch("attach", file);
    fileInput.value = "";
  }

  export function setText(v) { text = v; autogrow(); }
</script>

<div class="composer glass gloss" data-tour="composer">
  <button class="icon-btn" on:click={() => fileInput.click()} disabled={uploading || disabled}
          aria-label="Attach a file" title="Attach a file">
    {#if uploading}<span class="spin-sm"></span>{:else}<i class="ti ti-paperclip"></i>{/if}
  </button>
  <input bind:this={fileInput} type="file"
    accept="image/*,.pdf,.txt,.docx,.pptx,.xlsx,.doc,.md,.csv,.json,.py,.js,.ts,.html,.css,.sql"
    style="display:none" on:change={onFile} />

  <textarea
    bind:this={ta}
    bind:value={text}
    on:input={autogrow}
    on:keydown={onKey}
    {placeholder}
    rows="1"
    aria-label="Message Emblem"
    {disabled}
  ></textarea>

  <button class="icon-btn" on:click={() => dispatch("mic")}
          aria-label="Talk to Emblem" title="Talk to Emblem">
    <i class="ti ti-microphone"></i>
  </button>

  <button class="send" on:click={submit} disabled={!text.trim() || disabled}
          aria-label="Send message" title="Send">
    {#if disabled}<span class="spin-sm on-accent"></span>{:else}<i class="ti ti-arrow-up"></i>{/if}
  </button>
</div>

<style>
  .composer {
    display: flex; align-items: flex-end; gap: 4px;
    border-radius: 26px;
    padding: 8px 8px 8px 10px;
    box-shadow: var(--shadow-md);
    transition: border-color var(--t-fast), box-shadow var(--t-fast);
  }
  .composer:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-bg), var(--shadow-md);
  }

  textarea {
    flex: 1; resize: none; border: none; background: transparent;
    color: var(--text); font-size: 15px; line-height: 1.5;
    padding: 7px 4px; outline: none;
    max-height: 180px; overflow-y: auto;
    scrollbar-width: none;
    font-family: inherit;
  }
  textarea::placeholder { color: var(--text-3); }

  .icon-btn {
    width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0;
    display: grid; place-items: center;
    color: var(--text-2); font-size: 18px;
    cursor: pointer;
    transition: background var(--t-fast), color var(--t-fast);
  }
  .icon-btn:hover:not(:disabled) { background: var(--s2); color: var(--text); }
  .icon-btn:disabled { opacity: 0.4; cursor: default; }

  .send {
    width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0;
    display: grid; place-items: center;
    background: var(--accent-grad); color: var(--accent-t); font-size: 18px;
    cursor: pointer;
    box-shadow: 0 2px 10px var(--accent-glow);
    transition: filter var(--t-fast), box-shadow var(--t-fast), opacity var(--t-fast);
  }
  .send:hover:not(:disabled) { filter: brightness(1.08); }
  .send:disabled { opacity: 0.35; cursor: default; box-shadow: none; }

  .spin-sm {
    width: 13px; height: 13px; border-radius: 50%;
    border: 2px solid var(--border-strong); border-top-color: var(--text-2);
    animation: spin 0.7s linear infinite; display: block;
  }
  .spin-sm.on-accent { border-color: rgba(0,20,22,0.3); border-top-color: var(--accent-t); }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
