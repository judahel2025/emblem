<script>
  // Account settings — layout from stitch_emblem_core_ui/account_settings:
  // display header, horizontal sub-tabs, bento split (profile + interface cards
  // left, status rail right), underline inputs, glass panels.
  import { onMount } from "svelte";
  import { fly } from "svelte/transition";
  import { api } from "../lib/api.js";
  import { appView, connectedApps, notify, loadMe } from "../lib/store.js";
  import ThemeToggle from "../components/ThemeToggle.svelte";

  let tab = "profile";   // profile | preferences
  let profile = { display_name: "", role: "", tone: "", comm_style: "" };
  let quiet = { quiet_start: "22:00", quiet_end: "07:00" };
  let email = "";
  let saving = false;
  let savedAt = 0;

  onMount(async () => {
    try {
      const p = await api.profile();
      profile = { display_name: p.display_name || "", role: p.role || "", tone: p.tone || "",
                  comm_style: p.comm_style || "" };
      if (p.quiet_start) quiet.quiet_start = p.quiet_start;
      if (p.quiet_end) quiet.quiet_end = p.quiet_end;
    } catch (e) { console.error("profile load failed:", e); }
    try { email = localStorage.getItem("emblem_email") || ""; } catch {}
  });

  async function save() {
    saving = true;
    try {
      await api.profileSet({ ...profile, ...quiet });
      loadMe(true);
      savedAt = Date.now();
      notify("Saved", "safe");
    } catch (e) { notify(`Couldn't save: ${e.message}`, "danger"); }
    saving = false;
  }

  function signOut() {
    window.dispatchEvent(new CustomEvent("emblem:session-expired"));
  }
</script>

<div class="page">
  <header class="head" in:fly={{ y: 10, duration: 250 }}>
    <h1>Settings</h1>
    <p class="sub">Manage your account, preferences and workspace.</p>
  </header>

  <div class="subtabs">
    <button class:active={tab === "profile"} on:click={() => tab = "profile"}>Profile</button>
    <button class:active={tab === "preferences"} on:click={() => tab = "preferences"}>Preferences</button>
  </div>

  <div class="bento">
    <div class="colmain">
      {#if tab === "profile"}
        <section class="panel glass gloss" in:fly={{ y: 10, duration: 200 }}>
          <h3><i class="ti ti-user"></i> Personal information</h3>
          <div class="idrow">
            <div class="avatar" aria-hidden="true">{(profile.display_name || email || "E").slice(0, 1).toUpperCase()}</div>
            <div>
              <p class="idname">{profile.display_name || "Set your name"}</p>
              <p class="idsub">{email}</p>
            </div>
          </div>
          <div class="formgrid">
            <label class="ufield">
              <span>Display name</span>
              <input bind:value={profile.display_name} placeholder="How Emblem addresses you" />
            </label>
            <label class="ufield">
              <span>What you do</span>
              <input bind:value={profile.role} placeholder="e.g. writer, founder, engineer" />
            </label>
            <label class="ufield wide">
              <span>How Emblem should speak to you</span>
              <input bind:value={profile.tone} placeholder="e.g. brief and direct" />
            </label>
          </div>
          <div class="actions">
            <button class="btn primary" on:click={save} disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
            {#if savedAt}<span class="savednote">Saved.</span>{/if}
          </div>
        </section>

        <section class="panel glass gloss" in:fly={{ y: 10, duration: 200, delay: 40 }}>
          <h3><i class="ti ti-message-2-cog"></i> Master instructions</h3>
          <p class="paneltext">A standing note for how you want Emblem to communicate with
             you — tone, language, how you like to be addressed, anything to always keep in
             mind. Emblem follows this in every conversation. You can change it anytime.</p>
          <label class="ufield wide">
            <span>How Emblem should talk to you</span>
            <textarea bind:value={profile.comm_style} rows="4"
              placeholder="e.g. Keep it warm but professional. Call me Judah. Short, direct answers — skip the pep talk. Use British spelling. Be candid when you disagree."></textarea>
          </label>
          <div class="actions">
            <button class="btn primary" on:click={save} disabled={saving}>
              {saving ? "Saving…" : "Save instructions"}
            </button>
            {#if savedAt}<span class="savednote">Saved.</span>{/if}
          </div>
        </section>
      {:else}
        <section class="panel glass gloss" in:fly={{ y: 10, duration: 200 }}>
          <h3><i class="ti ti-palette"></i> Interface</h3>
          <div class="prefgrid">
            <div class="prefrow">
              <div>
                <p class="pname">Theme</p>
                <p class="psub">Light, dark, or follow your system.</p>
              </div>
              <ThemeToggle />
            </div>
            <div class="prefrow">
              <div>
                <p class="pname">Quiet hours</p>
                <p class="psub">Automations hold non-urgent updates during these hours.</p>
              </div>
              <div class="quiet">
                <input bind:value={quiet.quiet_start} aria-label="Quiet hours start" placeholder="22:00" />
                <span>—</span>
                <input bind:value={quiet.quiet_end} aria-label="Quiet hours end" placeholder="07:00" />
              </div>
            </div>
          </div>
          <div class="actions">
            <button class="btn primary" on:click={save} disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </section>
      {/if}
    </div>

    <div class="colrail">
      <section class="panel glass" in:fly={{ y: 10, duration: 200, delay: 60 }}>
        <h4>Connected apps</h4>
        {#if $connectedApps.length}
          <p class="railtext">{$connectedApps.length} app{$connectedApps.length === 1 ? "" : "s"} linked to your account.</p>
        {:else}
          <p class="railtext">Nothing connected yet — link your Gmail, Calendar or GitHub so Emblem can act in your accounts.</p>
        {/if}
        <button class="link" on:click={() => appView.set("connect")}>
          Manage connections <i class="ti ti-arrow-right"></i>
        </button>
      </section>

      <section class="panel glass" in:fly={{ y: 10, duration: 200, delay: 120 }}>
        <h4>Help</h4>
        <p class="railtext">How approvals work, connecting apps, voice, privacy.</p>
        <button class="link" on:click={() => appView.set("help")}>
          Open the help center <i class="ti ti-arrow-right"></i>
        </button>
      </section>

      <section class="panel glass danger" in:fly={{ y: 10, duration: 200, delay: 180 }}>
        <h4>Session</h4>
        <p class="railtext">Sign out of Emblem on this device.</p>
        <button class="btn ghost signout" on:click={signOut}>
          <i class="ti ti-logout"></i> Sign out
        </button>
      </section>
    </div>
  </div>
</div>

<style>
  .page { max-width: 1100px; margin: 0 auto; padding: 32px 24px 60px; }
  .head { margin-bottom: 24px; }
  h1 { font-size: 36px; font-weight: 600; letter-spacing: -0.04em; margin: 0 0 6px; color: var(--text); }
  .sub { color: var(--text-2); font-size: 15px; margin: 0; }

  .subtabs { display: flex; gap: 28px; border-bottom: 1px solid var(--border); margin-bottom: 24px; }
  .subtabs button {
    padding: 0 0 13px; font-size: 13.5px; font-weight: 600; color: var(--text-2);
    border-bottom: 2px solid transparent; cursor: pointer;
    transition: color var(--t-fast), border-color var(--t-fast);
  }
  .subtabs button:hover { color: var(--text); }
  .subtabs button.active { color: var(--accent-ink); border-bottom-color: var(--accent); }

  .bento { display: grid; grid-template-columns: 1fr 320px; gap: 24px; align-items: start; }
  @media (max-width: 860px) { .bento { grid-template-columns: 1fr; } }
  .colmain, .colrail { display: flex; flex-direction: column; gap: 24px; }

  .panel { border-radius: var(--r-lg); padding: 24px; box-shadow: var(--shadow-sm); }
  .panel h3 {
    display: flex; align-items: center; gap: 8px; margin: 0 0 20px;
    font-size: 18px; font-weight: 600; color: var(--text);
  }
  .panel h3 i { color: var(--accent-ink); font-size: 20px; }
  .panel h4 {
    margin: 0 0 8px; font-size: 12px; font-weight: 600;
    letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-3);
  }

  .idrow { display: flex; align-items: center; gap: 16px; padding-bottom: 20px; margin-bottom: 20px;
    border-bottom: 1px solid var(--border); }
  .avatar { width: 56px; height: 56px; border-radius: 50%;
    background: var(--accent); color: var(--accent-t);
    display: grid; place-items: center; font-size: 22px; font-weight: 700; }
  .idname { margin: 0; font-size: 15px; font-weight: 600; color: var(--text); }
  .idsub { margin: 2px 0 0; font-size: 12.5px; color: var(--text-3); }

  .formgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  @media (max-width: 640px) { .formgrid { grid-template-columns: 1fr; } }
  .ufield { display: flex; flex-direction: column; gap: 6px; }
  .ufield.wide { grid-column: 1 / -1; }
  .ufield span { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-3); }
  .ufield input {
    background: transparent; border: none; border-bottom: 2px solid var(--border-strong);
    padding: 8px 0; font-size: 15px; color: var(--text); outline: none;
    transition: border-color var(--t-fast);
  }
  .ufield input:focus { border-bottom-color: var(--accent); }
  .ufield textarea {
    background: var(--s1); border: 1px solid var(--border); border-radius: var(--r-md);
    padding: 12px 14px; font-size: 15px; line-height: 1.55; color: var(--text);
    outline: none; resize: vertical; min-height: 92px; font-family: inherit;
    transition: border-color var(--t-fast), box-shadow var(--t-fast);
  }
  .ufield textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-bg); }
  .paneltext { font-size: 13px; color: var(--text-2); line-height: 1.55; margin: 0 0 16px; }

  .actions { display: flex; align-items: center; gap: 12px; margin-top: 22px; }
  .savednote { font-size: 12.5px; color: var(--safe); }

  .prefgrid { display: flex; flex-direction: column; gap: 12px; }
  .prefrow {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 14px 16px; background: var(--s1);
    border: 1px solid var(--border); border-radius: var(--r-md);
  }
  .pname { margin: 0; font-size: 14px; font-weight: 600; color: var(--text); }
  .psub { margin: 2px 0 0; font-size: 12.5px; color: var(--text-3); }
  .quiet { display: flex; align-items: center; gap: 6px; color: var(--text-3); }
  .quiet input {
    width: 64px; text-align: center; background: var(--bg);
    border: 1px solid var(--border); border-radius: var(--r-sm);
    padding: 7px 4px; font-size: 13px; color: var(--text); outline: none;
    transition: border-color var(--t-fast);
  }
  .quiet input:focus { border-color: var(--accent); }

  .railtext { margin: 0 0 12px; font-size: 13px; line-height: 1.55; color: var(--text-2); }
  .link {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 13px; font-weight: 600; color: var(--accent-ink); cursor: pointer;
    transition: opacity var(--t-fast);
  }
  .link:hover { opacity: 0.8; }
  .signout { width: 100%; justify-content: center; }
  .panel.danger .signout:hover { color: var(--danger); border-color: var(--danger); background: transparent; }
</style>
