<script>
  // Lazy code editor wrapper. The editor library loads only when this mounts
  // (dynamic import) so it stays out of the main bundle.
  import { onMount, onDestroy, createEventDispatcher } from "svelte";
  import { resolvedTheme } from "../lib/theme.js";

  export let value = "";
  export let language = "plaintext";
  export let readOnly = false;

  const dispatch = createEventDispatcher();

  let host;
  let editor = null;
  let monacoRef = null;
  let unsubTheme = null;
  let destroyed = false;

  onMount(async () => {
    self.MonacoEnvironment = {
      getWorker: () =>
        new Worker(
          new URL("monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url),
          { type: "module" }
        ),
    };

    const monaco = await import("monaco-editor");
    if (destroyed) return;
    monacoRef = monaco;

    monaco.editor.defineTheme("emblem-light", {
      base: "vs",
      inherit: true,
      rules: [],
      colors: { "editor.background": "#ffffff" },
    });
    monaco.editor.defineTheme("emblem-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: { "editor.background": "#0a0a0a" },
    });

    editor = monaco.editor.create(host, {
      value,
      language,
      readOnly,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
    });

    editor.onDidChangeModelContent(() => {
      dispatch("change", editor.getValue());
    });

    unsubTheme = resolvedTheme.subscribe((mode) => {
      monaco.editor.setTheme(mode === "dark" ? "emblem-dark" : "emblem-light");
    });
  });

  // External value changes. Comparing against the editor's current text guards
  // against the feedback loop from our own change events.
  $: if (editor && typeof value === "string" && value !== editor.getValue()) {
    editor.setValue(value);
  }

  $: if (editor && monacoRef && language) {
    const model = editor.getModel();
    if (model) monacoRef.editor.setModelLanguage(model, language);
  }

  $: if (editor) editor.updateOptions({ readOnly });

  onDestroy(() => {
    destroyed = true;
    if (unsubTheme) unsubTheme();
    if (editor) editor.dispose();
    editor = null;
  });
</script>

<div class="monaco-host" bind:this={host}></div>

<style>
  .monaco-host {
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }
</style>
