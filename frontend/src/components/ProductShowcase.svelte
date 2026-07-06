<script>
  // "See Emblem in action" — an ambient, always-playing walkthrough of the
  // whole product (chat, memory, skills, connections, approvals, voice,
  // automations), built from real mockups of the actual screens.
  //
  // Honest note for whoever reads this next: there is no video-generation
  // tool available to build an actual .mp4 here, so this is a genuine
  // animated HTML/CSS sequence instead of a rendered video file. It's built
  // to the exact interaction spec Judah asked for: no play/pause, just an
  // expand/reduce toggle, and the expanded view is a glass popup, not a
  // full-page takeover.
  import { onMount, onDestroy } from "svelte";
  import { fly, fade } from "svelte/transition";
  import Orb from "./Orb.svelte";

  let expanded = false;
  let sceneIdx = 0;
  let timer = null;

  const SCENES = [
    "chat", "memory", "skills", "connect", "approve", "voice", "auto",
  ];
  const LABELS = {
    chat: "Say what you need",
    memory: "It remembers you",
    skills: "Teach it a skill",
    connect: "Connect your tools",
    approve: "It acts, you approve",
    voice: "Talk instead of type",
    auto: "It works while you rest",
  };
  const SCENE_MS = 3600;

  function startLoop() {
    stopLoop();
    const reduceMotion = typeof matchMedia !== "undefined" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;   // hold on scene 0, no forced motion
    timer = setInterval(() => { sceneIdx = (sceneIdx + 1) % SCENES.length; }, SCENE_MS);
  }
  function stopLoop() { if (timer) { clearInterval(timer); timer = null; } }

  function openExpanded() { expanded = true; }
  function closeExpanded() { expanded = false; }
  function onKey(e) { if (e.key === "Escape" && expanded) closeExpanded(); }

  onMount(startLoop);
  onDestroy(stopLoop);

  $: scene = SCENES[sceneIdx];
</script>

<svelte:window on:keydown={onKey} />

<!-- The ambient preview — always playing, sitting quietly on the page -->
<div class="preview glass gloss edge-blue">
  <div class="scene-host small">
    {#key sceneIdx}
      <div class="scene" in:fade={{ duration: 260 }}>
        {#if scene === "chat"}
          <div class="mock chat">
            <div class="bubble user">Draft a launch email to the team</div>
            <div class="bubble bot">Here's a draft, want me to send it once you've read it?</div>
          </div>
        {:else if scene === "memory"}
          <div class="mock memory">
            <span class="mchip"><i class="ti ti-user"></i> Runs a design studio</span>
            <span class="mchip"><i class="ti ti-message"></i> Prefers short, direct replies</span>
            <span class="mchip"><i class="ti ti-target-arrow"></i> Working on the Q3 launch</span>
          </div>
        {:else if scene === "skills"}
          <div class="mock skills">
            <div class="skillrow"><i class="ti ti-bulb"></i> "Save this as a skill"</div>
            <div class="skillcard"><b>Weekly report</b><span>Pull the numbers, draft the summary, save as a note</span></div>
          </div>
        {:else if scene === "connect"}
          <div class="mock connect">
            {#each ["ti-brand-gmail","ti-calendar","ti-brand-github","ti-brand-notion","ti-brand-slack"] as ic}
              <span class="capp"><i class="ti {ic}"></i><i class="ti ti-check tiny"></i></span>
            {/each}
          </div>
        {:else if scene === "approve"}
          <div class="mock approve">
            <div class="acard">
              <div class="ahead">Waiting on you</div>
              <div class="aline">Post the update to LinkedIn</div>
              <div class="abtns"><span class="ok"><i class="ti ti-check"></i> Approve</span><span class="no">Decline</span></div>
            </div>
          </div>
        {:else if scene === "voice"}
          <div class="mock voice">
            <Orb size={54} state="speaking" />
            <div class="vline">"Set a reminder for 2:15"</div>
          </div>
        {:else if scene === "auto"}
          <div class="mock auto">
            <div class="acard2"><i class="ti ti-bolt"></i> Every morning at 8, summarize unread email</div>
            <div class="abadge"><i class="ti ti-circle-check"></i> Ran quietly, no click needed</div>
          </div>
        {/if}
      </div>
    {/key}
  </div>
  <div class="preview-foot">
    <span class="scene-label">{LABELS[scene]}</span>
    <button class="expand-btn" on:click={openExpanded} aria-label="Expand the walkthrough">
      <i class="ti ti-arrows-maximize"></i> Expand
    </button>
  </div>
  <div class="dots" aria-hidden="true">
    {#each SCENES as _, i}<span class="dot" class:on={i === sceneIdx}></span>{/each}
  </div>
</div>

{#if expanded}
  <div class="popup-veil" on:click|self={closeExpanded} transition:fade={{ duration: 160 }} role="presentation">
    <div class="popup glass gloss edge-red" transition:fly={{ y: 14, duration: 220 }} role="dialog" aria-label="Product walkthrough, expanded">
      <div class="popup-head">
        <span class="popup-title"><i class="ti ti-sparkles"></i> Emblem, in action</span>
        <button class="reduce-btn" on:click={closeExpanded} aria-label="Reduce the walkthrough">
          <i class="ti ti-arrows-minimize"></i> Reduce
        </button>
      </div>
      <div class="scene-host big">
        {#key sceneIdx}
          <div class="scene" in:fade={{ duration: 280 }}>
            {#if scene === "chat"}
              <div class="mock chat big">
                <div class="bubble user">Draft a launch email to the team</div>
                <div class="bubble bot">Here's a draft, want me to send it once you've read it? I kept it short and put the link to the changelog at the bottom.</div>
              </div>
            {:else if scene === "memory"}
              <div class="mock memory big">
                <span class="mchip"><i class="ti ti-user"></i> Runs a design studio</span>
                <span class="mchip"><i class="ti ti-message"></i> Prefers short, direct replies</span>
                <span class="mchip"><i class="ti ti-target-arrow"></i> Working on the Q3 launch</span>
                <span class="mchip"><i class="ti ti-clock"></i> Quiet hours after 9pm</span>
              </div>
            {:else if scene === "skills"}
              <div class="mock skills big">
                <div class="skillrow"><i class="ti ti-bulb"></i> "Save this as a skill"</div>
                <div class="skillcard"><b>Weekly report</b><span>Pull the numbers, draft the summary, save as a note</span></div>
                <div class="skillcard"><b>Client follow-up</b><span>Draft a check-in email in my voice, three days after a call</span></div>
              </div>
            {:else if scene === "connect"}
              <div class="mock connect big">
                {#each ["ti-brand-gmail","ti-calendar","ti-brand-github","ti-brand-notion","ti-brand-slack","ti-brand-youtube"] as ic}
                  <span class="capp"><i class="ti {ic}"></i><i class="ti ti-check tiny"></i></span>
                {/each}
              </div>
            {:else if scene === "approve"}
              <div class="mock approve big">
                <div class="acard">
                  <div class="ahead">Waiting on you</div>
                  <div class="aline">Post the update to LinkedIn</div>
                  <div class="abtns"><span class="ok"><i class="ti ti-check"></i> Approve</span><span class="no">Decline</span></div>
                </div>
                <p class="apnote">Nothing goes out until you say so. Every send, post, or delete pauses here first.</p>
              </div>
            {:else if scene === "voice"}
              <div class="mock voice big">
                <Orb size={84} state="speaking" />
                <div class="vline">"Set a reminder for 2:15"</div>
                <p class="apnote">Hands-free, real conversation, immediate replies.</p>
              </div>
            {:else if scene === "auto"}
              <div class="mock auto big">
                <div class="acard2"><i class="ti ti-bolt"></i> Every morning at 8, summarize unread email</div>
                <div class="abadge"><i class="ti ti-circle-check"></i> Ran quietly, no click needed</div>
                <p class="apnote">Set it once in plain language. It keeps running until you change it.</p>
              </div>
            {/if}
          </div>
        {/key}
      </div>
      <div class="popup-foot">
        <span class="scene-label big">{LABELS[scene]}</span>
        <div class="dots" aria-hidden="true">
          {#each SCENES as _, i}<span class="dot" class:on={i === sceneIdx}></span>{/each}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .preview {
    width: 100%; max-width: 420px; margin: 0 auto;
    border-radius: var(--r-lg); padding: 16px 18px 14px;
    display: flex; flex-direction: column; gap: 10px;
  }
  .scene-host { position: relative; display: grid; place-items: center; }
  .scene-host.small { min-height: 110px; }
  .scene-host.big { min-height: 220px; }
  .scene { width: 100%; }

  .preview-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .scene-label { font-size: 12.5px; font-weight: 500; color: var(--text-2); }
  .scene-label.big { font-size: 14px; color: var(--text); }
  .expand-btn, .reduce-btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 7px 14px; border-radius: var(--r-pill);
    border: 1px solid var(--border-strong); background: var(--s1); color: var(--text-2);
    font-size: 12.5px; font-weight: 500; cursor: pointer;
    transition: color var(--t-fast), border-color var(--t-fast), background var(--t-fast);
  }
  .expand-btn:hover, .reduce-btn:hover { color: var(--text); border-color: var(--accent); background: var(--accent-bg); }

  .dots { display: flex; gap: 5px; justify-content: center; }
  .dot { width: 5px; height: 5px; border-radius: 50%; background: var(--border-strong); transition: background var(--t-fast), transform var(--t-fast); }
  .dot.on { background: var(--accent); transform: scale(1.4); }

  /* ── scene mockups ── */
  .mock { display: flex; flex-direction: column; gap: 10px; width: 100%; padding: 0 4px; }
  .mock.big { gap: 14px; }

  .mock.chat .bubble { padding: 9px 13px; border-radius: 14px; font-size: 13px; line-height: 1.45; max-width: 88%; }
  .mock.chat.big .bubble { font-size: 14.5px; padding: 11px 15px; }
  .bubble.user { align-self: flex-end; background: var(--s2); color: var(--text); border-bottom-right-radius: 4px; }
  .bubble.bot { align-self: flex-start; background: var(--accent-bg); color: var(--text); border-bottom-left-radius: 4px; }

  .mock.memory { flex-direction: row; flex-wrap: wrap; justify-content: center; }
  .mchip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: var(--r-pill);
    background: var(--blue-bg); border: 1px solid var(--blue); color: var(--blue); font-size: 11.5px; font-weight: 500; }
  .mock.memory.big .mchip { font-size: 13px; padding: 8px 14px; }

  .skillrow { font-size: 12.5px; color: var(--text-2); font-style: normal; }
  .mock.skills.big .skillrow { font-size: 14px; }
  .skillcard { padding: 10px 13px; border-radius: var(--r-md); background: var(--s1); border: 1px solid var(--border);
    display: flex; flex-direction: column; gap: 2px; }
  .skillcard b { font-size: 13px; color: var(--text); }
  .skillcard span { font-size: 11.5px; color: var(--text-2); }
  .mock.skills.big .skillcard b { font-size: 14.5px; }
  .mock.skills.big .skillcard span { font-size: 13px; }

  .mock.connect { flex-direction: row; justify-content: center; gap: 12px; }
  .capp { position: relative; width: 40px; height: 40px; border-radius: var(--r-md); background: var(--s1);
    border: 1px solid var(--border); display: grid; place-items: center; font-size: 18px; color: var(--text-2); }
  .mock.connect.big .capp { width: 52px; height: 52px; font-size: 22px; }
  .capp .tiny { position: absolute; bottom: -4px; right: -4px; font-size: 12px; color: var(--safe);
    background: var(--bg); border-radius: 50%; }

  .mock.approve { align-items: center; }
  .acard { width: 100%; max-width: 260px; padding: 12px 14px; border-radius: var(--r-md);
    background: var(--s1); border: 1px solid var(--caution); display: flex; flex-direction: column; gap: 8px; }
  .ahead { font-size: 11px; font-weight: 500; color: var(--caution); text-transform: uppercase; letter-spacing: .04em; }
  .aline { font-size: 13px; color: var(--text); }
  .mock.approve.big .aline { font-size: 14.5px; }
  .abtns { display: flex; gap: 10px; font-size: 12px; font-weight: 500; }
  .abtns .ok { color: var(--accent-ink); display: inline-flex; align-items: center; gap: 4px; }
  .abtns .no { color: var(--text-3); }

  .mock.voice { align-items: center; text-align: center; }
  .vline { font-size: 13px; color: var(--text-2); font-style: normal; }
  .mock.voice.big .vline { font-size: 15px; }

  .acard2 { padding: 10px 14px; border-radius: var(--r-md); background: var(--s1); border: 1px solid var(--border);
    display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--text); }
  .mock.auto.big .acard2 { font-size: 14px; }
  .abadge { display: inline-flex; align-items: center; gap: 6px; align-self: flex-start;
    font-size: 11.5px; color: var(--safe); }

  .apnote { margin: 0; font-size: 12.5px; color: var(--text-3); text-align: center; max-width: 340px; }

  /* ── the expanded glass popup ── */
  .popup-veil {
    position: fixed; inset: 0; z-index: 140;
    background: rgba(5, 8, 18, 0.6);
    -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
    display: grid; place-items: center; padding: 24px;
  }
  .popup {
    width: min(640px, 100%); max-height: min(560px, 90vh);
    border-radius: var(--r-tide); padding: 20px 24px 22px;
    display: flex; flex-direction: column; gap: 16px;
    box-shadow: var(--shadow-lg);
  }
  .popup-head { display: flex; align-items: center; justify-content: space-between; }
  .popup-title { display: inline-flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; color: var(--text); }
  .popup-foot { display: flex; flex-direction: column; align-items: center; gap: 10px; }
</style>
