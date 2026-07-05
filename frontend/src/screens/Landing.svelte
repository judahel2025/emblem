<script>
  // Emblem landing — Stitch emblem_1 language end to end:
  // liquid WebGL shader hero (stitch/shader) with the 3D orb (stitch/three.js),
  // display-type headline, glass nav, tilt cards, and a real multi-column footer.
  // Says nothing about which AI or providers power it — that stays in the backend.
  import { createEventDispatcher } from "svelte";
  import Logo from "../components/Logo.svelte";
  import LandingShader from "../components/LandingShader.svelte";
  import LandingOrb3D from "../components/LandingOrb3D.svelte";
  import { tilt } from "../lib/tilt.js";
  import { api } from "../lib/api.js";
  const dispatch = createEventDispatcher();
  const enter = () => dispatch("enter");
  let menuOpen = false;
  const closeMenu = () => (menuOpen = false);

  // Newsletter signup (public endpoint — works logged-out).
  let nlEmail = "", nlBusy = false, nlDone = false, nlErr = false;
  async function subscribe() {
    if (nlBusy || nlDone) return;
    nlBusy = true; nlErr = false;
    try {
      await api.newsletterSubscribe(nlEmail.trim());
      nlDone = true;
    } catch { nlErr = true; }
    nlBusy = false;
  }

  /** Scroll-reveal action: fades/slides content in the first time it enters view. */
  function reveal(node) {
    node.classList.add("reveal");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) { node.classList.add("reveal-in"); io.disconnect(); }
        }
      },
      { threshold: 0.15 }
    );
    io.observe(node);
    return { destroy: () => io.disconnect() };
  }

  const tools = [
    { i: "ti-brand-gmail", n: "Gmail" },
    { i: "ti-calendar", n: "Calendar" },
    { i: "ti-brand-github", n: "GitHub" },
    { i: "ti-brand-notion", n: "Notion" },
    { i: "ti-brand-slack", n: "Slack" },
    { i: "ti-brand-youtube", n: "YouTube" },
    { i: "ti-brand-instagram", n: "Instagram" },
    { i: "ti-brand-linkedin", n: "LinkedIn" },
  ];

  const features = [
    { i: "ti-message-2", t: "Chat that acts", d: "Say it in plain words. It drafts, sends, schedules, and files — answers are just the start." },
    { i: "ti-microphone", t: "Real voice mode", d: "Hold to talk, or go hands-free. It listens, thinks, and speaks back naturally." },
    { i: "ti-plug-connected", t: "20,000+ tools", d: "Gmail, Calendar, GitHub, your socials and more — each account stays rooted to you." },
    { i: "ti-brain", t: "Memory that grows", d: "It learns your people, preferences and projects, and every session builds on the last." },
    { i: "ti-bolt", t: "Works while you rest", d: "Plant an automation once — a morning brief, an inbox sweep — and it keeps running on its own." },
    { i: "ti-file-text", t: "Notes & calendar", d: "Turn a conversation into a note or an event with one line. Your workspace, grown as you talk." },
  ];

  const year = new Date().getFullYear();
</script>

<div class="lp">
  <!-- Nav — rides on the black hero, so it's night-scoped too -->
  <header class="nav glass night">
    <div class="brand"><span class="mark"><Logo size={24} /></span> <span class="word">EMBLEM</span> <span class="byline">by Quaniac</span></div>
    <nav class="links">
      <a href="#features">Product</a>
      <a href="#connect">Connections</a>
      <a href="#voice">Voice</a>
      <a href="#principles">Principles</a>
    </nav>
    <div class="nav-cta">
      <button class="ghost" on:click={enter}>Sign in</button>
      <button class="primary" on:click={enter}>Open workspace</button>
      <button class="burger" on:click={() => (menuOpen = !menuOpen)} aria-label="Menu"
              aria-expanded={menuOpen}>
        <i class="ti {menuOpen ? 'ti-x' : 'ti-menu-2'}"></i>
      </button>
    </div>
    {#if menuOpen}
      <nav class="mobile-menu glass night" on:click={closeMenu}>
        <a href="#features">Product</a>
        <a href="#connect">Connections</a>
        <a href="#voice">Voice</a>
        <a href="#principles">Principles</a>
        <button class="ghost" on:click={enter}>Sign in</button>
        <button class="primary" on:click={enter}>Open workspace</button>
      </nav>
    {/if}
  </header>

  <!-- Hero — liquid shader field + the 3D orb. ALWAYS black, both themes. -->
  <section class="hero night">
    <LandingShader alwaysDark />
    <div class="hero-inner" use:reveal>
      <LandingOrb3D />
      <div class="eyebrow"><i class="ti ti-microphone"></i> Voice-first · grows with you</div>
      <h1>Say it once.<br/>Watch it take root.</h1>
      <p class="sub">Emblem is the AI workspace you talk to. It connects to the tools you already use,
        remembers what matters, and quietly grows into the way you work — so things get done
        while you stay in flow.</p>
      <div class="hero-cta">
        <button class="primary big" on:click={enter}>Start free <i class="ti ti-arrow-right"></i></button>
        <button class="ghost big glassy" on:click={enter}><i class="ti ti-player-play"></i> Meet Emblem</button>
      </div>
      <div class="hero-note">No card needed · your accounts stay private to you</div>
    </div>
  </section>

  <!-- Connections trust row -->
  <section id="connect" class="trust" use:reveal>
    <div class="trust-label">Rooted in everything you work in — 20,000+ tools</div>
    <div class="tiles stagger">
      {#each tools as t}
        <div class="tile gloss" use:tilt><i class="ti {t.i}"></i><span>{t.n}</span></div>
      {/each}
      <div class="tile more">+20k more</div>
    </div>
  </section>

  <!-- Features bento -->
  <section id="features" class="features" use:reveal>
    <h2>A workspace that grows back.</h2>
    <div class="bento stagger">
      {#each features as f, idx}
        <div class="fcard glass gloss" class:wide={idx === 0} use:tilt use:reveal>
          <div class="ficon"><i class="ti {f.i}"></i></div>
          <div class="ftitle">{f.t}</div>
          <div class="fdesc">{f.d}</div>
        </div>
      {/each}
    </div>
  </section>

  <!-- Voice section -->
  <section id="voice" class="voice" use:reveal>
    <div class="v-orb">
      <span class="ring r1"></span><span class="ring r2"></span>
      <span class="core"><i class="ti ti-microphone"></i></span>
    </div>
    <h2>Talk to it. It tends the rest.</h2>
    <p class="sub">Say "reply to Sarah and put a follow-up on Friday." It drafts the email, stages the
      event, and shows you both to approve — out loud or on screen.</p>
    <button class="primary big" on:click={enter}>Try the voice demo <i class="ti ti-arrow-right"></i></button>
  </section>

  <!-- Big CTA -->
  <section class="cta" use:reveal>
    <h2>Good work grows here.</h2>
    <p class="cta-sub">Meet the assistant that has your back — and gets better every day you use it.</p>
    <button class="primary big" on:click={enter}>Open your workspace <i class="ti ti-arrow-right"></i></button>
  </section>

  <!-- Footer — brand + link columns + legal bar -->
  <footer class="foot">
    <div class="foot-grid">
      <div class="foot-brand">
        <div class="brand"><span class="mark"><Logo size={26} /></span> <span class="word">EMBLEM</span> <span class="byline">by Quaniac</span></div>
        <p class="tagline">The workspace you talk to. It connects to your tools, remembers what
          matters, and quietly gets things done — growing into the way you work.</p>
        <div class="nl">
          <h5>Newsletter</h5>
          <p class="fnote">Product news, occasionally. One click to leave.</p>
          {#if nlDone}
            <div class="nl-done"><i class="ti ti-circle-check"></i> You're subscribed.</div>
          {:else}
            <form class="nl-form" on:submit|preventDefault={subscribe}>
              <input type="email" bind:value={nlEmail} placeholder="you@work.com" required
                     aria-label="Email for the newsletter" />
              <button class="nl-btn" disabled={nlBusy}>{nlBusy ? "…" : "Sign up"}</button>
            </form>
            {#if nlErr}<span class="nl-err">Couldn't subscribe — try again.</span>{/if}
          {/if}
        </div>
      </div>
      <div class="foot-col">
        <h5>Product</h5>
        <a href="#features">Chat & voice</a>
        <a href="#connect">Connections</a>
        <a href="#features">Automations</a>
        <a href="#features">Notes & calendar</a>
      </div>
      <div class="foot-col">
        <h5>Resources</h5>
        <button class="flink" on:click={enter}>Help center</button>
        <button class="flink" on:click={enter}>Open workspace</button>
        <button class="flink" on:click={enter}>Sign in</button>
      </div>
      <div class="foot-col" id="principles">
        <h5>Principles</h5>
        <span class="fnote">Your accounts stay yours.</span>
        <span class="fnote">Consequential actions always ask first.</span>
        <span class="fnote">Connections can be revoked anytime.</span>
      </div>
    </div>
    <div class="foot-bar">
      <span>© {year} Quaniac LLC. All rights reserved.</span>
      <span class="dim">Made for people who'd rather just say it.</span>
    </div>
  </footer>
</div>

<style>
  .lp { background: var(--bg); color: var(--text); min-height: 100vh; overflow-x: hidden; scroll-behavior: smooth; }

  /* The cinematic scope: hero + nav are INK in BOTH themes, with brass
     carrying the light. Re-declaring the tokens locally keeps every child
     component correct. */
  .night {
    --bg: #14151b; --bg-2: #181a21; --s1: #1c1e26; --s2: #242631; --s3: #2c2e3a;
    --text: #edeae0; --text-2: #9b9a93; --text-3: #6e6d66;
    --border: rgba(237,234,224,0.09); --border-strong: rgba(237,234,224,0.18);
    --divider: rgba(237,234,224,0.09);
    --surface: rgba(28,30,38,0.72);
    --accent: #b08a4e; --accent-h: #c09a5e; --accent-ink: #c4a06a; --accent-t: #14151b;
    --accent-bg: rgba(176,138,78,0.12); --accent-glow: rgba(176,138,78,0.30);
    --accent-grad: linear-gradient(180deg,#c09a5e,#a37f45); --accent-2: #4f8577;
    --glow-core: rgba(240,232,214,0.92); --glow-soft: rgba(176,138,78,0.34);
    --glow-rim: rgba(176,138,78,0.22);
    background: #14151b;
    color: var(--text);
  }
  .lp :global(h1), .lp :global(h2) { font-weight: 500; letter-spacing: -0.04em; color: var(--text); margin: 0; }

  .lp :global(.reveal) {
    opacity: 0;
    transform: translateY(14px);
    transition: opacity var(--t-slow) ease, transform var(--t-slow) ease;
  }
  .lp :global(.reveal.reveal-in) { opacity: 1; transform: translateY(0); }

  /* ── Nav ── */
  .nav { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; justify-content: space-between;
    padding: 14px 40px; border-left: none; border-right: none; border-top: none; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .word { font-size: 17px; font-weight: 500; letter-spacing: 0.01em; color: var(--text);
    font-family: var(--font-display); }
  .byline { font-size: 11px; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase;
    color: var(--text-3); align-self: flex-end; margin: 0 0 2px 2px; }
  .mark { display: grid; place-items: center; color: var(--accent-ink); }
  .links { display: flex; gap: 30px; }
  .links a { color: var(--text-2); font-size: 14px; font-weight: 500; text-decoration: none; transition: color var(--t-fast); }
  .links a:hover { color: var(--accent-ink); }
  .nav-cta { display: flex; gap: 10px; align-items: center; }
  .burger { display: none; width: 38px; height: 38px; border-radius: 10px;
    place-items: center; color: var(--text); font-size: 21px; cursor: pointer; }
  .mobile-menu {
    position: absolute; top: 100%; left: 0; right: 0;
    display: flex; flex-direction: column; gap: 4px;
    padding: 14px 20px 18px; border-top: none;
    animation: fade-up 0.22s var(--spring) both;
  }
  .mobile-menu a { color: var(--text-2); font-size: 15px; font-weight: 500; text-decoration: none;
    padding: 10px 4px; border-bottom: 1px solid var(--divider); }
  .mobile-menu a:hover { color: var(--text); }
  .mobile-menu .ghost, .mobile-menu .primary { margin-top: 10px; justify-content: center; display: flex; }

  .ghost { background: transparent; border: 1px solid transparent; color: var(--text-2); padding: 9px 14px;
    border-radius: var(--r-sm); font-size: 14px; font-weight: 500; cursor: pointer;
    transition: color var(--t-fast), background var(--t-fast); }
  .ghost:hover { color: var(--text); background: rgba(0,0,0,0.05); }
  :global([data-theme="dark"]) .ghost:hover { background: rgba(255,255,255,0.06); }
  .ghost.glassy { border: 1px solid var(--border-strong); background: var(--surface);
    -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); }
  .primary { background: var(--accent); color: var(--accent-t); border: none; padding: 9px 18px;
    border-radius: var(--r-sm); font-size: 14px; font-weight: 500; cursor: pointer;
    box-shadow: 0 4px 14px var(--accent-glow);
    transition: background var(--t-fast), box-shadow var(--t-fast), transform var(--t-fast);
    display: inline-flex; align-items: center; gap: 7px; }
  .primary:hover { background: var(--accent-h); box-shadow: 0 6px 20px var(--accent-glow); transform: scale(1.02); }
  .primary.big, .ghost.big { padding: 14px 26px; font-size: 15.5px; }

  /* ── Hero ── */
  .hero { position: relative; text-align: center; padding: 40px 24px 90px; overflow: hidden; }
  .hero-inner { position: relative; z-index: 1; max-width: 780px; margin: 0 auto;
    display: flex; flex-direction: column; align-items: center; gap: 18px; }
  .eyebrow { display: inline-flex; align-items: center; gap: 8px;
    padding: 7px 16px; border-radius: var(--r-pill);
    background: var(--surface); border: 1px solid var(--border);
    -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur);
    font-size: 12.5px; font-weight: 500; color: var(--accent-ink); }
  .hero h1 { font-size: clamp(38px, 6.5vw, 64px); line-height: 1.08; }
  .hero .sub { max-width: 560px; margin: 0; color: var(--text-2); font-size: 17px; line-height: 1.65; }
  .hero-cta { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; margin-top: 6px; }
  .hero-note { font-size: 12.5px; color: var(--text-3); }

  /* ── Trust row ── */
  .trust { padding: 60px 24px; text-align: center; border-top: 1px solid var(--border); }
  .trust-label { font-size: 12px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase;
    color: var(--text-3); margin-bottom: 26px; }
  .tiles { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; max-width: 900px; margin: 0 auto; }
  .tile { display: flex; align-items: center; gap: 9px; padding: 12px 18px;
    background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--r-md);
    font-size: 13.5px; font-weight: 500; color: var(--text-2); box-shadow: var(--shadow-sm);
    transition: box-shadow var(--t-fast), border-color var(--t-fast); }
  .tile:hover { box-shadow: var(--shadow-md); border-color: var(--border-strong); }
  .tile i { font-size: 19px; color: var(--accent-ink); }
  .tile.more { color: var(--text-3); border-style: dashed; }

  /* ── Features ── */
  .features { padding: 80px 24px; max-width: 1080px; margin: 0 auto; }
  .features h2 { font-size: clamp(26px, 4vw, 36px); text-align: center; margin-bottom: 44px; }
  .bento { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
  @media (max-width: 860px) { .bento { grid-template-columns: 1fr; } }
  .fcard { border-radius: var(--r-md); padding: 26px; box-shadow: var(--shadow-sm);
    transition: box-shadow var(--t-fast), border-color var(--t-fast); }
  .fcard:hover { box-shadow: var(--shadow-md); border-color: var(--border-strong); }
  .fcard.wide { grid-column: span 3; }
  @media (max-width: 860px) { .fcard.wide { grid-column: span 1; } }
  .ficon { width: 42px; height: 42px; border-radius: var(--r-sm);
    background: var(--accent-bg); color: var(--accent-ink);
    display: grid; place-items: center; font-size: 21px; margin-bottom: 16px; }
  .ftitle { font-size: 17px; font-weight: 500; margin-bottom: 6px; color: var(--text); }
  .fdesc { font-size: 14px; line-height: 1.6; color: var(--text-2); }

  /* ── Voice ── */
  .voice { padding: 80px 24px; text-align: center; border-top: 1px solid var(--border);
    display: flex; flex-direction: column; align-items: center; gap: 18px; }
  .voice h2 { font-size: clamp(26px, 4vw, 36px); }
  .voice .sub { max-width: 520px; margin: 0; color: var(--text-2); font-size: 15.5px; line-height: 1.65; }
  .v-orb { position: relative; width: 110px; height: 110px; display: grid; place-items: center;
    animation: float-y 4.5s ease-in-out infinite; }
  .v-orb .core { width: 72px; height: 72px; border-radius: 50%;
    background: var(--accent); color: var(--accent-t);
    display: grid; place-items: center; font-size: 27px;
    box-shadow: 0 0 34px var(--accent-glow); }
  .v-orb .ring { position: absolute; inset: 0; border-radius: 50%;
    border: 1px solid var(--accent); opacity: 0.4;
    animation: pulse-ring 2.4s ease-out infinite; }
  .v-orb .r2 { animation-delay: 1.2s; }

  /* ── CTA ── */
  .cta { padding: 90px 24px; text-align: center; border-top: 1px solid var(--border);
    display: flex; flex-direction: column; align-items: center; gap: 18px; }
  .cta h2 { font-size: clamp(26px, 4.5vw, 40px); }
  .cta-sub { margin: 0; color: var(--text-2); font-size: 15.5px; max-width: 480px; line-height: 1.6; }

  /* ── Footer ── */
  .foot { border-top: 1px solid var(--border); background: var(--s1); }
  .foot-grid { max-width: 1080px; margin: 0 auto; padding: 56px 24px 40px;
    display: grid; grid-template-columns: 1.6fr 1fr 1fr 1.3fr; gap: 32px; }
  @media (max-width: 860px) { .foot-grid { grid-template-columns: 1fr 1fr; } }
  @media (max-width: 560px) { .foot-grid { grid-template-columns: 1fr; } }
  .foot-brand .tagline { margin: 14px 0 0; font-size: 13.5px; line-height: 1.6; color: var(--text-2); max-width: 300px; }
  .nl { margin-top: 20px; display: flex; flex-direction: column; gap: 7px; max-width: 300px; }
  .nl h5 { margin: 0; font-size: 11px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-3); }
  .nl-form { display: flex; gap: 7px; }
  .nl-form input { flex: 1; min-width: 0; background: var(--bg-2); border: 1px solid var(--border);
    border-radius: var(--r-sm); padding: 9px 12px; font-size: 13px; color: var(--text); outline: none;
    transition: border-color var(--t-fast); }
  .nl-form input:focus { border-color: var(--accent); }
  .nl-btn { padding: 9px 16px; border-radius: var(--r-sm); background: var(--accent); color: var(--accent-t);
    font-size: 13px; font-weight: 500; cursor: pointer; white-space: nowrap;
    transition: filter var(--t-fast); }
  .nl-btn:hover:not(:disabled) { filter: brightness(1.06); }
  .nl-btn:disabled { opacity: 0.6; cursor: default; }
  .nl-done { display: inline-flex; align-items: center; gap: 7px; color: var(--safe); font-size: 13.5px; font-weight: 500; }
  .nl-err { color: var(--danger); font-size: 12px; }
  .foot-col { display: flex; flex-direction: column; gap: 10px; }
  .foot-col h5 { margin: 0 0 4px; font-size: 11px; font-weight: 500;
    letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-3); }
  .foot-col a, .flink { font-size: 13.5px; color: var(--text-2); text-decoration: none;
    text-align: left; padding: 0; cursor: pointer; transition: color var(--t-fast); }
  .foot-col a:hover, .flink:hover { color: var(--accent-ink); }
  .fnote { font-size: 13px; color: var(--text-3); line-height: 1.5; }
  .foot-bar { border-top: 1px solid var(--border); }
  .foot-bar { max-width: 1080px; margin: 0 auto; padding: 18px 24px;
    display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap;
    font-size: 12.5px; color: var(--text-3); }

  @media (max-width: 760px) {
    .links { display: none; }
    .nav { padding: 12px 20px; }
    .nav-cta .ghost, .nav-cta .primary { display: none; }
    .burger { display: grid; }
  }
</style>
