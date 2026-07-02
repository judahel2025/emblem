<script>
  import { toast } from "../lib/store.js";
</script>

{#if $toast}
  <div class="toast {$toast.kind}">
    <i class="ti ti-bell"></i>{$toast.message}
  </div>
{/if}

<style>
  .toast {
    position: fixed; bottom: 20px; right: 20px;
    background: var(--s2);
    border: 1px solid var(--border-strong);
    border-left: 3px solid var(--accent-t);
    padding: 11px 16px;
    border-radius: var(--r-lg);
    font-size: 13px;
    display: flex; align-items: center; gap: 9px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    z-index: 999;
    color: var(--text);
    animation: spring-in 0.25s var(--spring);
    max-width: 320px;
  }
  .toast i { color: var(--accent-t); flex-shrink: 0; }
  .toast.safe    { border-left-color: var(--safe);    } .toast.safe i    { color: var(--safe); }
  .toast.caution { border-left-color: var(--caution); } .toast.caution i { color: var(--caution); }
  .toast.danger  { border-left-color: var(--danger);  } .toast.danger i  { color: var(--danger); }
  .toast.accent  { border-left-color: var(--accent-t);} .toast.accent i  { color: var(--accent-t); }
</style>
