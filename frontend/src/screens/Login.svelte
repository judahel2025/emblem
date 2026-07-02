<script>
  import { createEventDispatcher } from "svelte";
  import { auth } from "../lib/supabase.js";
  const dispatch = createEventDispatcher();

  let mode = "signin"; // "signin" | "signup"
  let email = "", password = "", busy = false, error = "";

  async function submit() {
    error = ""; busy = true;
    try {
      if (mode === "signup") await auth.signUp(email.trim(), password);
      else await auth.signIn(email.trim(), password);
      if (auth.isLoggedIn()) dispatch("done");
      else error = "Check your email to confirm your account, then sign in.";
    } catch (e) {
      error = e.message || "Something went wrong.";
    } finally { busy = false; }
  }
</script>

<div class="wrap">
  <div class="card">
    <div class="brand"><span class="mark">V</span> Veyra</div>
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
      {#if error}<div class="err">{error}</div>{/if}
      <button class="lemon" type="submit" disabled={busy}>
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
  .wrap { min-height: 100vh; display: grid; place-items: center; background: #fff; padding: 24px; }
  .card { width: 100%; max-width: 400px; background: var(--s1); border: 1px solid var(--border);
    border-radius: 20px; padding: 34px 30px; }
  .brand { display: flex; align-items: center; gap: 9px; font-size: 18px; font-weight: 700; margin-bottom: 22px; }
  .mark { width: 26px; height: 26px; border-radius: 8px; background: var(--accent); color: var(--accent-t);
    display: grid; place-items: center; font-weight: 800; font-size: 15px; }
  h1 { font-size: 24px; font-weight: 800; letter-spacing: -0.02em; margin: 0 0 6px; color: var(--text); }
  .sub { color: var(--text-2); font-size: 14px; margin: 0 0 24px; }
  form { display: flex; flex-direction: column; gap: 14px; }
  label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 600; color: var(--text-2); }
  input { background: #fff; border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px;
    font-size: 15px; color: var(--text); outline: none; transition: border-color .15s; }
  input:focus { border-color: var(--accent-2); }
  .lemon { background: var(--accent); color: var(--accent-t); border: none; padding: 13px; border-radius: 12px;
    font-size: 15px; font-weight: 700; cursor: pointer; margin-top: 4px; transition: background .15s; }
  .lemon:hover:not(:disabled) { background: var(--accent-h); }
  .lemon:disabled { opacity: .6; cursor: default; }
  .google { width: 100%; display: flex; align-items: center; justify-content: center; gap: 9px;
    background: #fff; border: 1px solid var(--border-strong); border-radius: 12px; padding: 12px;
    font-size: 14px; font-weight: 600; color: var(--text); cursor: pointer; transition: background .15s; }
  .google:hover { background: var(--s2); }
  .google i { font-size: 18px; }
  .or { display: flex; align-items: center; gap: 12px; margin: 16px 0; color: var(--text-3); font-size: 12px; }
  .or::before, .or::after { content: ""; flex: 1; height: 1px; background: var(--border); }
  .err { background: var(--danger-bg); color: var(--danger); font-size: 13px; padding: 9px 12px; border-radius: 10px; }
  .alt { margin-top: 20px; font-size: 13px; color: var(--text-2); text-align: center; }
  .link { background: none; border: none; color: var(--accent-t); font-weight: 700; cursor: pointer; font-size: 13px; }
</style>
