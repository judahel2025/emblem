<script>
  // Emblem landing — AURORA (Judah's reference): full-dark navy page with twin
  // blue/red blooms, halftone dot patches, glass nav, white pill CTA, a red-
  // highlighted hero headline (weight contrast 300/600), a grey logo trust
  // strip, and twin glow-edged glass showcase cards. Says nothing about which
  // AI or providers power it — that stays in the backend.
  import { createEventDispatcher } from "svelte";
  import Logo from "../components/Logo.svelte";
  import Orb from "../components/Orb.svelte";
  import LandingShader from "../components/LandingShader.svelte";
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
    { i: "ti-microphone", t: "Real voice mode", d: "Hands-free conversation: it listens, thinks, and speaks back naturally." },
    { i: "ti-plug-connected", t: "20,000+ tools", d: "Gmail, Calendar, GitHub, your socials and more — each account stays yours." },
    { i: "ti-brain", t: "Memory that grows", d: "It learns your people, preferences and projects, and every session builds on the last." },
    { i: "ti-bolt", t: "Works while you rest", d: "Set an automation once — a morning brief, an inbox sweep — and it keeps running on its own." },
    { i: "ti-file-text", t: "Notes & calendar", d: "Turn a conversation into a note or an event with one line. Your workspace, built as you talk." },
  ];

  const year = new Date().getFullYear();
</script>

<div class="lp">
  <!-- Nav — glass on navy, white pill CTA (the reference's "Add to chrome") -->
  <header class="nav glass">
    <div class="brand"><span class="mark"><Logo size={26} /></span> <span class="word">Emblem</span> <span class="byline">by Quaniac</span></div>
    <nav class="links">
      <a href="#features">Product</a>
      <a href="#connect">Connections</a>
      <a href="#voice">Voice</a>
      <a href="#principles">Principles</a>
    </nav>
    <div class="nav-cta">
      <button class="ghost" on:click={enter}>Sign in</button>
      <button class="whitepill" on:click={enter}>Open workspace</button>
      <button class="burger" on:click={() => (menuOpen = !menuOpen)} aria-label="Menu"
              aria-expanded={menuOpen}>
        <i class="ti {menuOpen ? 'ti-x' : 'ti-menu-2'}"></i>
      </button>
    </div>
    {#if menuOpen}
      <nav class="mobile-menu glass" on:click={closeMenu}>
        <a href="#features">Product</a>
        <a href="#connect">Connections</a>
        <a href="#voice">Voice</a>
        <a href="#principles">Principles</a>
        <button class="ghost" on:click={enter}>Sign in</button>
        <button class="whitepill" on:click={enter}>Open workspace</button>
      </nav>
    {/if}
  </header>

  <!-- Hero — aurora blooms + shader + dot patches + the red-highlighted headline -->
  <section class="hero">
    <LandingShader alwaysDark />
    <span class="dotfield df1" aria-hidden="true"></span>
    <span class="dotfield df2" aria-hidden="true"></span>
    <div class="hero-inner" use:reveal>
      <div class="eyebrow"><i class="ti ti-sparkles"></i> Voice-first · personalized · yours</div>
      <h1><span class="quiet">Your all-in-one</span> <span class="red">AI workspace</span><br/>
        <span class="loud">personalized, fast and yours.</span></h1>
      <p class="sub">Emblem connects to the tools you already use, remembers what matters,
        and quietly gets things done — chat it, speak it, or let it run on its own.</p>
      <div class="hero-cta">
        <button class="whitepill big" on:click={enter}>Start free <i class="ti ti-arrow-right"></i></button>
        <button class="glasspill big" on:click={enter}><i class="ti ti-player-play"></i> Meet Emblem</button>
      </div>
      <div class="hero-note">No card needed · your accounts stay private to you</div>
    </div>

    <!-- Trust strip — quiet grey logos, like the reference's brand row -->
    <div id="connect" class="loganchor" use:reveal>
      <div class="logorow">
        {#each tools as t}
          <span class="logoitem"><i class="ti {t.i}"></i>{t.n}</span>
        {/each}
        <span class="logoitem dim2">+20k more</span>
      </div>
    </div>

    <!-- Twin showcase cards — glow-edged glass, red left / blue right -->
    <div class="show" use:reveal>
      <div class="showcard left glass gloss edge-red" use:tilt>
        <div class="q-pill"><i class="ti ti-sparkles"></i> What can Emblem do for me?</div>
        <div class="mini glass">
          <div class="mini-head">Approval needed <span class="mini-chip">waiting</span></div>
          <div class="mini-line">Send the launch email to Sarah</div>
          <div class="mini-btns"><span class="ok"><i class="ti ti-check"></i> Approve</span><span class="no">Decline</span></div>
        </div>
        <div class="mini glass rows">
          <div class="skel w80"></div>
          <div class="skel w60"></div>
          <div class="skel w70"></div>
        </div>
      </div>

      <div class="showcard right glass gloss edge-blue" use:tilt>
        <div class="orbseat"><Orb size={72} state="idle" /></div>
        <div class="ask glass">
          <span class="ask-ph">Ask me anything — or just say it</span>
          <span class="ask-send"><i class="ti ti-arrow-up"></i></span>
        </div>
        <div class="ask-row">
          <span class="ask-ic"><i class="ti ti-paperclip"></i></span>
          <span class="ask-ic"><i class="ti ti-microphone"></i></span>
          <span class="ask-ic"><i class="ti ti-bolt"></i></span>
          <span class="duo-toggle" aria-hidden="true"><span class="duo-knob"></span></span>
        </div>
      </div>
    </div>
  </section>

  <!-- Features bento -->
  <section id="features" class="features" use:reveal>
    <h2>A workspace that <span class="red">works back</span>.</h2>
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
    <div class="v-orb"><Orb size={84} state="speaking" /></div>
    <h2>Talk to it. <span class="red">It does the rest.</span></h2>
    <p class="sub">Say "reply to Sarah and put a follow-up on Friday." It drafts the email, stages the
      event, and shows you both to approve — out loud or on screen.</p>
    <button class="whitepill big" on:click={enter}>Try the voice mode <i class="ti ti-arrow-right"></i></button>
  </section>

  <!-- Big CTA -->
  <section class="cta" use:reveal>
    <span class="dotfield df3" aria-hidden="true"></span>
    <h2>Meet the assistant that <span class="red">has your back</span>.</h2>
    <p class="cta-sub">Personalized from day one — and better every day you use it.</p>
    <button class="whitepill big" on:click={enter}>Open your workspace <i class="ti ti-arrow-right"></i></button>
  </section>

  <!-- Footer — brand + link columns + legal bar -->
  <footer class="foot">
    <div class="foot-grid">
      <div class="foot-brand">
        <div class="brand"><span class="mark"><Logo size={26} /></span> <span class="word">Emblem</span> <span class="byline">by Quaniac</span></div>
        <p class="tagline">The workspace you talk to. It connects to your tools, remembers what
          matters, and quietly gets things done.</p>
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
  /* The whole landing lives in the reference's dark navy world in BOTH themes —
     the aurora scope re-declares the dark tokens locally. */
  .lp {
    --bg: #0b1020; --bg-2: #0e142a; --s1: #121a33; --s2: #1a2340; --s3: #232d4f;
    --text: #edf0fa; --text-2: #9aa3bf; --text-3: #5f6885;
    --border: rgba(237,240,250,0.10); --border-strong: rgba(237,240,250,0.20);
    --divider: rgba(237,240,250,0.09);
    --surface: rgba(18,26,51,0.55);
    --accent: #e5484d; --accent-h: #f05a5e; --accent-ink: #f27b7e; --accent-t: #ffffff;
    --accent-bg: rgba(229,72,77,0.14); --accent-glow: rgba(229,72,77,0.38);
    --accent-grad: linear-gradient(135deg,#f05a5e,#c93a44); --accent-2: #3e63dd;
    --blue: #3e63dd; --blue-glow: rgba(62,99,221,0.40);
    --glow-core: rgba(255,235,240,0.95); --glow-soft: rgba(229,72,77,0.40);
    --glow-rim: rgba(62,99,221,0.30);
    --aurora: radial-gradient(1000px 700px at 10% -5%, rgba(62,99,221,0.24), transparent 60%),
              radial-gradient(1000px 700px at 92% 8%, rgba(229,72,77,0.18), transparent 60%);
    --edge-blue: 0 0 28px rgba(62,99,221,0.28), inset 0 0 0 1px rgba(90,124,240,0.24);
    --edge-red:  0 0 28px rgba(229,72,77,0.24), inset 0 0 0 1px rgba(240,90,94,0.24);
    --dots: radial-gradient(rgba(237,240,250,0.13) 1px, transparent 1.4px);
    background: var(--aurora), #0b1020;
    color: var(--text);
    min-height: 100vh; overflow-x: hidden; scroll-behavior: smooth;
  }
  .lp :global(h1), .lp :global(h2) { color: var(--text); margin: 0; }
  .red { color: var(--accent); }

  .lp :global(.reveal) {
    opacity: 0;
    transform: translateY(14px);
    transition: opacity var(--t-slow) ease, transform var(--t-slow) ease;
  }
  .lp :global(.reveal.reveal-in) { opacity: 1; transform: translateY(0); }

  .dotfield {
    position: absolute; pointer-events: none; z-index: 0;
    background-image: var(--dots); background-size: 12px 12px;
    -webkit-mask-image: radial-gradient(closest-side, #000, transparent);
    mask-image: radial-gradient(closest-side, #000, transparent);
  }
  .df1 { top: 40px; left: -60px; width: 420px; height: 380px; }
  .df2 { top: 220px; right: -80px; width: 460px; height: 420px; }
  .df3 { top: 0; right: 6%; width: 340px; height: 300px; }

  /* ── Nav ── */
  .nav { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; justify-content: space-between;
    padding: 14px 40px; border-left: none; border-right: none; border-top: none; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .word { font-size: 17px; font-weight: 600; letter-spacing: -0.01em; color: var(--text); }
  .byline { font-size: 11px; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase;
    color: var(--text-3); align-self: flex-end; margin: 0 0 2px 2px; }
  .mark { display: grid; place-items: center; }
  .links { display: flex; gap: 30px; }
  .links a { color: var(--text-2); font-size: 14px; font-weight: 500; text-decoration: none; transition: color var(--t-fast); }
  .links a:hover { color: var(--text); }
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
  .mobile-menu .ghost, .mobile-menu .whitepill { margin-top: 10px; justify-content: center; display: flex; }

  .ghost { background: transparent; border: 1px solid transparent; color: var(--text-2); padding: 9px 14px;
    border-radius: var(--r-pill); font-size: 14px; font-weight: 500; cursor: pointer;
    transition: color var(--t-fast), background var(--t-fast); }
  .ghost:hover { color: var(--text); background: rgba(255,255,255,0.06); }

  /* The reference's white pill CTA */
  .whitepill {
    display: inline-flex; align-items: center; gap: 8px;
    background: #ffffff; color: #0b1020; border: none;
    padding: 10px 20px; border-radius: var(--r-pill);
    font-size: 14px; font-weight: 600; cursor: pointer;
    box-shadow: 0 0 22px rgba(255,255,255,0.22), 0 4px 14px rgba(0,0,0,0.3);
    transition: filter var(--t-fast), transform var(--t-fast), box-shadow var(--t-fast);
  }
  .whitepill:hover { filter: brightness(0.97); transform: scale(1.03);
    box-shadow: 0 0 32px rgba(255,255,255,0.3), 0 4px 14px rgba(0,0,0,0.3); }
  .glasspill {
    display: inline-flex; align-items: center; gap: 8px;
    background: var(--surface); color: var(--text);
    border: 1px solid var(--border-strong); border-radius: var(--r-pill);
    padding: 10px 20px; font-size: 14px; font-weight: 500; cursor: pointer;
    -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur);
    transition: border-color var(--t-fast), transform var(--t-fast);
  }
  .glasspill:hover { border-color: var(--blue); transform: scale(1.02); }
  .whitepill.big, .glasspill.big { padding: 14px 28px; font-size: 15.5px; }

  /* ── Hero ── */
  .hero { position: relative; text-align: center; padding: 56px 24px 80px; overflow: hidden; }
  .hero-inner { position: relative; z-index: 1; max-width: 860px; margin: 0 auto;
    display: flex; flex-direction: column; align-items: center; gap: 20px; }
  .eyebrow { display: inline-flex; align-items: center; gap: 8px;
    padding: 7px 16px; border-radius: var(--r-pill);
    background: var(--surface); border: 1px solid var(--border);
    -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur);
    font-size: 12.5px; font-weight: 500; color: var(--text-2); }
  .eyebrow i { color: var(--accent-ink); }
  .hero h1 { font-size: clamp(40px, 6.8vw, 72px); line-height: 1.06; letter-spacing: -0.03em; }
  .hero h1 .quiet { font-weight: 300; }
  .hero h1 .loud { font-weight: 600; }
  .hero h1 .red { font-weight: 600; }
  .hero .sub { max-width: 600px; margin: 0; color: var(--text-2); font-size: 17px; line-height: 1.65; font-weight: 400; }
  .hero-cta { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; margin-top: 6px; }
  .hero-note { font-size: 12.5px; color: var(--text-3); }

  /* ── Trust strip ── */
  .loganchor { position: relative; z-index: 1; margin-top: 56px; }
  .logorow { display: flex; flex-wrap: wrap; gap: 26px 34px; justify-content: center; align-items: center;
    max-width: 900px; margin: 0 auto; }
  .logoitem { display: inline-flex; align-items: center; gap: 7px;
    color: var(--text-3); font-size: 14px; font-weight: 500; letter-spacing: 0.01em;
    transition: color var(--t-fast); }
  .logoitem:hover { color: var(--text-2); }
  .logoitem i { font-size: 19px; }
  .dim2 { opacity: 0.7; }

  /* ── Twin showcase cards ── */
  .show { position: relative; z-index: 1; margin: 64px auto 0; max-width: 980px;
    display: grid; grid-template-columns: 0.9fr 1.1fr; gap: 22px; text-align: left; }
  @media (max-width: 820px) { .show { grid-template-columns: 1fr; } }
  .showcard { border-radius: var(--r-xl); padding: 22px; display: flex; flex-direction: column; gap: 14px; }
  .edge-red  { box-shadow: var(--edge-red),  var(--shadow-lg); }
  .edge-blue { box-shadow: var(--edge-blue), var(--shadow-lg); }

  .q-pill { display: inline-flex; align-items: center; gap: 9px; align-self: flex-start;
    padding: 11px 18px; border-radius: var(--r-pill);
    background: rgba(229,72,77,0.12); border: 1px solid rgba(240,90,94,0.35);
    color: var(--text); font-size: 14px; font-weight: 500;
    box-shadow: 0 0 18px rgba(229,72,77,0.25); }
  .q-pill i { color: var(--accent-ink); }
  .mini { border-radius: var(--r-md); padding: 14px 16px; display: flex; flex-direction: column; gap: 9px; }
  .mini-head { font-size: 11.5px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--text-3); display: flex; align-items: center; gap: 8px; }
  .mini-chip { font-size: 10px; padding: 2px 8px; border-radius: var(--r-pill);
    background: var(--caution-bg, rgba(245,166,35,0.12)); color: #f5a623; border: 1px solid rgba(245,166,35,0.4);
    text-transform: none; letter-spacing: 0; }
  .mini-line { font-size: 14px; color: var(--text); font-weight: 500; }
  .mini-btns { display: flex; gap: 8px; }
  .mini-btns .ok { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 600;
    padding: 6px 14px; border-radius: var(--r-pill); background: var(--accent-grad); color: #fff;
    box-shadow: 0 0 12px var(--accent-glow); }
  .mini-btns .no { font-size: 12.5px; color: var(--text-3); padding: 6px 10px; }
  .mini.rows { gap: 8px; }
  .skel { height: 9px; border-radius: 5px; background: var(--s3); opacity: 0.8; }
  .skel.w80 { width: 80%; } .skel.w60 { width: 60%; } .skel.w70 { width: 70%; }

  .showcard.right { align-items: center; justify-content: center; gap: 20px; padding: 30px 24px; }
  .orbseat { padding: 8px 0 2px; }
  .ask { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 10px;
    border-radius: var(--r-pill); padding: 13px 8px 13px 18px; border: 1px solid var(--border-strong); }
  .ask-ph { color: var(--text-3); font-size: 14.5px; }
  .ask-send { width: 34px; height: 34px; border-radius: 50%; background: var(--accent-grad);
    color: #fff; display: grid; place-items: center; font-size: 15px;
    box-shadow: 0 0 14px var(--accent-glow); flex-shrink: 0; }
  .ask-row { width: 100%; display: flex; align-items: center; gap: 12px; padding: 0 6px; }
  .ask-ic { width: 32px; height: 32px; border-radius: 8px; display: grid; place-items: center;
    color: var(--text-3); font-size: 16px; background: var(--s1); border: 1px solid var(--border); }
  .duo-toggle { margin-left: auto; width: 46px; height: 24px; border-radius: 99px;
    background: linear-gradient(90deg, #3e63dd, #e5484d); position: relative;
    box-shadow: 0 0 12px rgba(62,99,221,0.35); }
  .duo-knob { position: absolute; top: 3px; right: 3px; width: 18px; height: 18px;
    border-radius: 50%; background: #fff; }

  /* ── Features ── */
  .features { position: relative; padding: 96px 24px; max-width: 1080px; margin: 0 auto; }
  .features h2 { font-size: clamp(26px, 4vw, 38px); text-align: center; margin-bottom: 44px; letter-spacing: -0.02em; }
  .bento { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
  @media (max-width: 860px) { .bento { grid-template-columns: 1fr; } }
  .fcard { border-radius: var(--r-lg); padding: 26px; box-shadow: var(--shadow-sm);
    transition: box-shadow var(--t-fast), border-color var(--t-fast); }
  .fcard:hover { box-shadow: var(--edge-blue); border-color: var(--border-strong); }
  .fcard.wide { grid-column: span 3; }
  @media (max-width: 860px) { .fcard.wide { grid-column: span 1; } }
  .ficon { width: 42px; height: 42px; border-radius: 10px;
    background: var(--blue-bg, rgba(62,99,221,0.14)); color: #5a7cf0;
    display: grid; place-items: center; font-size: 21px; margin-bottom: 16px; }
  .ftitle { font-size: 17px; font-weight: 600; margin-bottom: 6px; color: var(--text); }
  .fdesc { font-size: 14px; line-height: 1.6; color: var(--text-2); }

  /* ── Voice ── */
  .voice { padding: 80px 24px; text-align: center; border-top: 1px solid var(--border);
    display: flex; flex-direction: column; align-items: center; gap: 18px; }
  .voice h2 { font-size: clamp(26px, 4vw, 36px); letter-spacing: -0.02em; }
  .voice .sub { max-width: 520px; margin: 0; color: var(--text-2); font-size: 15.5px; line-height: 1.65; }
  .v-orb { animation: float-y 4.5s ease-in-out infinite; }

  /* ── CTA ── */
  .cta { position: relative; padding: 96px 24px; text-align: center; border-top: 1px solid var(--border);
    display: flex; flex-direction: column; align-items: center; gap: 18px; overflow: hidden; }
  .cta h2 { position: relative; font-size: clamp(26px, 4.5vw, 42px); letter-spacing: -0.02em; }
  .cta-sub { position: relative; margin: 0; color: var(--text-2); font-size: 15.5px; max-width: 480px; line-height: 1.6; }

  /* ── Footer ── */
  .foot { border-top: 1px solid var(--border); background: var(--bg-2); }
  .foot-grid { max-width: 1080px; margin: 0 auto; padding: 56px 24px 40px;
    display: grid; grid-template-columns: 1.6fr 1fr 1fr 1.3fr; gap: 32px; }
  @media (max-width: 860px) { .foot-grid { grid-template-columns: 1fr 1fr; } }
  @media (max-width: 560px) { .foot-grid { grid-template-columns: 1fr; } }
  .foot-brand .tagline { margin: 14px 0 0; font-size: 13.5px; line-height: 1.6; color: var(--text-2); max-width: 300px; }
  .nl { margin-top: 20px; display: flex; flex-direction: column; gap: 7px; max-width: 300px; }
  .nl h5 { margin: 0; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-3); }
  .nl-form { display: flex; gap: 7px; }
  .nl-form input { flex: 1; min-width: 0; background: var(--s1); border: 1px solid var(--border);
    border-radius: var(--r-pill); padding: 9px 14px; font-size: 13px; color: var(--text); outline: none;
    transition: border-color var(--t-fast); }
  .nl-form input:focus { border-color: var(--blue); }
  .nl-btn { padding: 9px 18px; border-radius: var(--r-pill); background: var(--accent-grad); color: #fff;
    font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap;
    box-shadow: 0 0 12px var(--accent-glow);
    transition: filter var(--t-fast); }
  .nl-btn:hover:not(:disabled) { filter: brightness(1.06); }
  .nl-btn:disabled { opacity: 0.6; cursor: default; }
  .nl-done { display: inline-flex; align-items: center; gap: 7px; color: #46a758; font-size: 13.5px; font-weight: 500; }
  .nl-err { color: var(--accent-ink); font-size: 12px; }
  .foot-col { display: flex; flex-direction: column; gap: 10px; }
  .foot-col h5 { margin: 0 0 4px; font-size: 11px; font-weight: 600;
    letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-3); }
  .foot-col a, .flink { font-size: 13.5px; color: var(--text-2); text-decoration: none;
    text-align: left; padding: 0; cursor: pointer; transition: color var(--t-fast); }
  .foot-col a:hover, .flink:hover { color: var(--text); }
  .fnote { font-size: 13px; color: var(--text-3); line-height: 1.5; }
  .foot-bar { border-top: 1px solid var(--border); }
  .foot-bar { max-width: 1080px; margin: 0 auto; padding: 18px 24px;
    display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap;
    font-size: 12.5px; color: var(--text-3); }

  @media (max-width: 760px) {
    .links { display: none; }
    .nav { padding: 12px 20px; }
    .nav-cta .ghost, .nav-cta .whitepill { display: none; }
    .mobile-menu .ghost, .mobile-menu .whitepill { display: flex; }
    .burger { display: grid; }
  }
</style>
