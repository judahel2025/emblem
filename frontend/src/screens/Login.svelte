<script>
  import { createEventDispatcher } from "svelte";
  import { fly } from "svelte/transition";
  import { auth } from "../lib/supabase.js";
  const dispatch = createEventDispatcher();

  let mode = "signin"; // "signin" | "signup"
  let email = "", password = "", busy = false, error = "";
  let shake = false;

  async function submit() {
    error = ""; busy = true;
    try {
      if (mode === "signup") await auth.signUp(email.trim(), password);
      else await auth.signIn(email.trim(), password);
      if (auth.isLoggedIn()) dispatch("done");
      else error = "Check your email to confirm your account, then sign in.";
    } catch (e) {
      error = e.message || "Something went wrong.";
      shake = true;
      setTimeout(() => shake = false, 450);
    } finally { busy = false; }
  }
</script>

<div class="wrap">
  <div class="card glass gloss" class:shake in:fly={{ y: 14, duration: 300 }}>
    <div class="brand"><span class="mark gloss">E</span> Emblem</div>
    <h1>{mode === "signup" ? "Create your workspace" : "Welcome back"}</h1>
    <p class="sub">{mode === "signup" ? "Your voice-first AI workspace, in one minute." : "Sign in to your workspace."}</p>

    <button class="google" on:click={() => auth.signInWithGoogle()}>
      <i class="ti ti-brand-google"></i> Continue with Google
    </button>
    <div class="or"><span>or</span></div>

    <form on:submit|preventDefault={submit}>
      <label>Email
        <input type="email" bind:value={email} placeholder="you@company.com" required autocomplete="email" />
      </label>
      <label>Password
        <input type="password" bind:value={password} placeholder="••••••••" required minlength="6"
               autocomplete={mode === "signup" ? "new-password" : "current-password"} />
      </label>
      {#if error}<div class="err" in:fly={{ y: -4, duration: 200 }}>{error}</div>{/if}
      <button class="primary" type="submit" disabled={busy}>
        {busy ? "One moment…" : mode === "signup" ? "Create workspace" : "Sign in"}
      </button>
    </form>

    <div class="alt">
      {#if mode === "signin"}
        New here? <button class="link" on:click={() => { mode = "signup"; error = ""; }}>Create an account</button>
      {:else}
        Already have one? <button class="link" on:click={() => { mode = "signin"; error = ""; }}>Sign in</button>
      {/if}
    </div>
  </div>
</div>

<style>
  .wrap {
    min-height: 100vh; display: grid; place-items: center; padding: 24px;
    background:
      radial-gradient(1200px 600px at 50% -10%, var(--accent-bg), transparent 60%),
      var(--bg);
  }
  .card {
    width: 100%; max-width: 400px;
    border-radius: var(--r-xl); padding: 34px 30px;
    box-shadow: var(--shadow-lg);
  }
  .card.shake { animation: shake 0.4s ease; }
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-6px); }
    50% { transform: translateX(5px); }
    75% { transform: translateX(-3px); }
  }
  .brand { display: flex; align-items: center; gap: 9px; font-size: 18px; font-weight: 700; margin-bottom: 22px; color: var(--text); }
  .mark { width: 26px; height: 26px; border-radius: 8px; background: var(--accent-grad); color: var(--accent-t);
    display: grid; place-items: center; font-weight: 800; font-size: 15px;
    box-shadow: 0 2px 10px var(--accent-glow); }
  h1 { font-size: 24px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 6px; color: var(--text); }
  .sub { color: var(--text-2); font-size: 14px; margin: 0 0 24px; }
  form { display: flex; flex-direction: column; gap: 14px; }
  label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 600; color: var(--text-2); }
  input { background: var(--bg); border: 1px solid var(--border); border-radius: var(--r-md); padding: 12px 14px;
    font-size: 15px; color: var(--text); outline: none;
    transition: border-color var(--t-fast), box-shadow var(--t-fast); }
  input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-bg); }
  .primary { background: var(--accent-grad); color: var(--accent-t); border: none; padding: 13px;
    border-radius: var(--r-pill); font-size: 15px; font-weight: 700; cursor: pointer; margin-top: 4px;
    box-shadow: 0 2px 12px var(--accent-glow);
    transition: filter var(--t-fast), box-shadow var(--t-fast); }
  .primary:hover:not(:disabled) { filter: brightness(1.07); box-shadow: 0 4px 18px var(--accent-glow); }
  .primary:disabled { opacity: .6; cursor: default; }
  .google { width: 100%; display: flex; align-items: center; justify-content: center; gap: 9px;
    background: var(--bg); border: 1px solid var(--border-strong); border-radius: var(--r-pill); padding: 12px;
    font-size: 14px; font-weight: 600; color: var(--text); cursor: pointer;
    transition: background var(--t-fast), border-color var(--t-fast); }
  .google:hover { background: var(--s1); border-color: var(--accent); }
  .google i { font-size: 18px; }
  .or { display: flex; align-items: center; gap: 12px; margin: 16px 0; color: var(--text-3); font-size: 12px; }
  .or::before, .or::after { content: ""; flex: 1; height: 1px; background: var(--border); }
  .err { background: var(--danger-bg); color: var(--danger); font-size: 13px; padding: 9px 12px; border-radius: var(--r-md); }
  .alt { margin-top: 20px; font-size: 13px; color: var(--text-2); text-align: center; }
  .link { background: none; border: none; color: var(--accent-ink); font-weight: 700; cursor: pointer; font-size: 13px; }
</style>
