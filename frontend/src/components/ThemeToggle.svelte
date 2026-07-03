<script>
  // Three-state segmented control: light / system / dark.
  import { theme, setTheme } from "../lib/theme.js";

  const OPTIONS = [
    { id: "light",  icon: "ti-sun",           label: "Light mode" },
    { id: "system", icon: "ti-device-desktop", label: "Match system" },
    { id: "dark",   icon: "ti-moon",          label: "Dark mode" },
  ];
</script>

<div class="seg" role="radiogroup" aria-label="Color theme">
  {#each OPTIONS as o}
    <button
      role="radio"
      aria-checked={$theme === o.id}
      aria-label={o.label}
      title={o.label}
      class:active={$theme === o.id}
      on:click={() => setTheme(o.id)}>
      <i class="ti {o.icon}"></i>
    </button>
  {/each}
</div>

<style>
  .seg {
    display: inline-flex; gap: 2px; padding: 3px;
    background: var(--s2); border: 1px solid var(--border);
    border-radius: var(--r-pill);
  }
  button {
    width: 28px; height: 24px; border-radius: 99px;
    display: grid; place-items: center;
    color: var(--text-3); font-size: 14px;
    cursor: pointer;
    transition: background var(--t-fast), color var(--t-fast), box-shadow var(--t-fast);
  }
  button:hover { color: var(--text); }
  button.active {
    background: var(--bg); color: var(--text);
    box-shadow: var(--shadow-sm);
  }
</style>
