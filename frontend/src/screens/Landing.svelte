<script>
  // Emblem landing — pure white/dark canvas, glossy glass surfaces,
  // ONE electric-blue accent used for fills/glows/focus only.
  // Says nothing about which AI or providers power it — that stays in the backend.
  import { createEventDispatcher } from "svelte";
  import Logo from "../components/Logo.svelte";
  const dispatch = createEventDispatcher();
  const enter = () => dispatch("enter");

  /** Scroll-reveal action: fades/slides content in the first time it enters view.
      Pure CSS transition (respects the global prefers-reduced-motion kill-switch). */
  function reveal(node) {
    node.classList.add("reveal");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            node.classList.add("reveal-in");
            io.disconnect();
          }
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
    { i: "ti-message-2", t: "Chat that acts", d: "Ask in plain words. It drafts, sends, schedules, and files — not just answers." },
    { i: "ti-microphone", t: "Real voice mode", d: "Hold to talk, or go hands-free. It listens, thinks, and speaks back naturally." },
    { i: "ti-plug-connected", t: "20,000+ tools", d: "Connect your Gmail, Calendar, GitHub, socials and more — each account stays yours." },
    { i: "ti-brain", t: "Remembers you", d: "It learns your people, preferences and projects, and carries them across every session." },
    { i: "ti-bolt", t: "Works while you sleep", d: "Set an automation once — a morning brief, an inbox sweep — it runs on its own." },
    { i: "ti-file-text", t: "Pages & calendar", d: "Turn a conversation into a page or an event with one line. Your workspace, built as you talk." },
  ];
</script>

<div class="lp">
  <!-- Nav -->
  <header class="nav glass">
    <div class="brand"><span class="mark"><Logo size={24} /></span> Emblem</div>
    <nav class="links">
      <a href="#features">Product</a>
      <a href="#connect">Connections</a>
      <a href="#voice">Voice</a>
    </nav>
    <div class="nav-cta">
      <button class="ghost" on:click={enter}>Sign in</button>
      <button class="primary" on:click={enter}>Open workspace</button>
    </div>
  </header>

  <!-- Hero -->
  <section class="hero" use:reveal>
    <div class="arc"></div>
    <div class="orb"><i class="ti ti-sparkles"></i></div>
    <div class="eyebrow"><i class="ti ti-microphone"></i> Voice-first · does the work for you</div>
    <h1>Your whole workday.<br/>One voice.</h1>
    <p class="sub">Emblem is the AI workspace you talk to. It connects to the tools you already use,
      remembers what matters, and quietly gets things done — so you don't have to.</p>
    <div class="hero-cta">
      <button class="primary big" on:click={enter}>Start free <i class="ti ti-arrow-right"></i></button>
      <button class="ghost big" on:click={enter}><i class="ti ti-player-play"></i> Hold to talk</button>
    </div>
    <div class="hero-note">No card needed · your accounts stay private to you</div>
  </section>

  <!-- Connections trust row -->
  <section id="connect" class="trust" use:reveal>
    <div class="trust-label">Connects to everything you work in — 20,000+ tools</div>
    <div class="tiles">
      {#each tools as t}
        <div class="tile gloss"><i class="ti {t.i}"></i><span>{t.n}</span></div>
      {/each}
      <div class="tile more">+20k more</div>
    </div>
  </section>

  <!-- Features bento -->
  <section id="features" class="features" use:reveal>
    <h2>A workspace that works back.</h2>
    <div class="bento">
      {#each features as f, idx}
        <div class="fcard" class:wide={idx === 0} use:reveal>
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
    <h2>Talk to it. It does the rest.</h2>
    <p class="sub">Say "reply to Sarah and put a follow-up on Friday." It drafts the email, stages the
      event, and shows you both to approve — out loud or on screen.</p>
    <button class="primary big" on:click={enter}>Try the voice demo <i class="ti ti-arrow-right"></i></button>
  </section>

  <!-- Big CTA -->
  <section class="cta" use:reveal>
    <h2>Meet the assistant that has your back.</h2>
    <button class="primary big" on:click={enter}>Open your workspace <i class="ti ti-arrow-right"></i></button>
  </section>

  <footer class="foot">
    <div class="brand"><span class="mark"><Logo size={24} /></span> Emblem</div>
    <span class="dim">Your voice-first AI workspace.</span>
    <span class="dim">© 2026 Emblem</span>
  </footer>
</div>

<style>
  .lp { background: var(--bg); color: var(--text); min-height: 100vh; overflow-x: hidden; }
  .lp :global(h1), .lp :global(h2) { font-weight: 800; letter-spacing: -0.03em; color: var(--text); margin: 0; }

  /* Scroll reveal (class is added at runtime by the action, so keep it global-scoped) */
  .lp :global(.reveal) {
    opacity: 0;
    transform: translateY(14px);
    transition: opacity var(--t-slow) ease, transform var(--t-slow) ease;
  }
  .lp :global(.reveal.reveal-in) { opacity: 1; transform: translateY(0); }

  /* Nav — sticky glass bar (surface/blur/border come from the .glass utility) */
  .nav { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; justify-content: space-between;
    padding: 16px 40px; border-left: none; border-right: none; border-top: none; }
  .brand { display: flex; align-items: center; gap: 9px; font-size: 19px; font-weight: 700; letter-spacing: -0.02em; }
  .mark { display: grid; place-items: center; color: var(--accent-ink); }
  .links { display: flex; gap: 30px; }
  .links a { color: var(--text-2); font-size: 14px; font-weight: 500; text-decoration: none; transition: color var(--t-fast); }
  .links a:hover { color: var(--accent-ink); }
  .nav-cta { display: flex; gap: 10px; align-items: center; }

  .ghost { background: transparent; border: 1px solid transparent; color: var(--text-2); padding: 9px 14px;
    border-radius: var(--r-pill); font-size: 14px; font-weight: 600; cursor: pointer;
    transition: color var(--t-fast), background var(--t-fast), border-color var(--t-fast); }
  .ghost:hover { color: var(--text); background: var(--s2); }
  .primary { background: var(--accent-grad); color: var(--accent-t); border: none; padding: 9px 18px;
    border-radius: var(--r-pill); font-size: 14px; font-weight: 700; cursor: pointer;
    box-shadow: 0 2px 12px var(--accent-glow);
    transition: filter var(--t-fast), box-shadow var(--t-fast);
    display: inline-flex; align-items: center; gap: 7px; }
  .primary:hover { filter: brightness(1.06); box-shadow: 0 4px 20px var(--accent-glow); }
  .big { padding: 14px 26px; font-size: 16px; }
  .ghost.big { border: 1px solid var(--border-strong); color: var(--text); }
  .ghost.big:hover { background: var(--s1); border-color: var(--border-strong); }

  /* Hero */
  .hero { position: relative; text-align: center; padding: 96px 24px 80px; }
  .arc { position: absolute; top: 60px; left: 50%; transform: translateX(-50%); width: 1400px; height: 700px;
    border-radius: 50%; background: radial-gradient(ellipse at center top, var(--accent-bg), transparent 60%);
    z-index: 0; pointer-events: none; }
  .orb { position: relative; z-index: 1; width: 92px; height: 92px; margin: 0 auto 30px; border-radius: 26px;
    background: var(--accent-grad); color: var(--accent-t); display: grid; place-items: center; font-size: 40px;
    box-shadow: 0 20px 50px var(--glow-soft), 0 0 24px var(--glow-soft); animation: float 4s ease-in-out infinite; }
  @keyframes float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
  .eyebrow { position: relative; z-index: 1; display: inline-flex; align-items: center; gap: 7px; font-size: 13px;
    font-weight: 600; color: var(--accent-ink); background: var(--accent-bg); border: 1px solid var(--border);
    padding: 7px 15px; border-radius: var(--r-pill); margin-bottom: 26px; }
  .hero h1 { position: relative; z-index: 1; font-size: clamp(44px, 8vw, 92px); line-height: 0.98; }
  .sub { position: relative; z-index: 1; max-width: 620px; margin: 24px auto 0; font-size: 19px; line-height: 1.6;
    color: var(--text-2); font-weight: 400; }
  .hero-cta { position: relative; z-index: 1; display: flex; gap: 14px; justify-content: center; margin-top: 36px; flex-wrap: wrap; }
  .hero-note { position: relative; z-index: 1; margin-top: 18px; font-size: 13px; color: var(--text-3); }

  /* Trust */
  .trust { padding: 40px 24px 20px; text-align: center; }
  .trust-label { font-size: 13px; font-weight: 600; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 22px; }
  .tiles { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; max-width: 780px; margin: 0 auto; }
  .tile { display: flex; align-items: center; gap: 9px; padding: 11px 18px; background: var(--s1); border: 1px solid var(--border);
    border-radius: var(--r-md); font-size: 14px; font-weight: 600; color: var(--text-2); box-shadow: var(--shadow-sm);
    transition: border-color var(--t-fast), box-shadow var(--t-fast), transform var(--t-fast); }
  .tile:hover { border-color: var(--border-strong); box-shadow: var(--shadow-md); transform: translateY(-2px); }
  .tile i { font-size: 20px; color: var(--accent-ink); position: relative; z-index: 1; }
  .tile span { position: relative; z-index: 1; }
  .tile.more { color: var(--accent-ink); background: var(--accent-bg); border-color: var(--border-strong); }

  /* Features */
  .features { padding: 90px 24px; max-width: 1080px; margin: 0 auto; }
  .features h2 { font-size: clamp(30px, 4.5vw, 46px); text-align: center; margin-bottom: 48px; }
  .bento { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
  .fcard { background: var(--bg); border: 1px solid var(--border); border-radius: var(--r-lg); padding: 28px;
    box-shadow: var(--shadow-sm); cursor: default;
    transition: border-color var(--t-fast), box-shadow var(--t-fast), transform var(--t-fast); }
  .fcard:hover { border-color: var(--border-strong); box-shadow: var(--shadow-md); transform: translateY(-2px); }
  .fcard.wide { grid-column: span 1; background: var(--accent-bg); border-color: var(--border-strong); }
  .ficon { width: 46px; height: 46px; border-radius: 13px; background: var(--bg); border: 1px solid var(--border);
    display: grid; place-items: center; font-size: 23px; color: var(--accent-ink); margin-bottom: 18px;
    box-shadow: var(--shadow-sm); }
  .ftitle { font-size: 19px; font-weight: 700; letter-spacing: -0.01em; margin-bottom: 8px; }
  .fdesc { font-size: 15px; line-height: 1.6; color: var(--text-2); }

  /* Voice */
  .voice { text-align: center; padding: 90px 24px; background: var(--s1); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
  .voice h2 { font-size: clamp(30px, 4.5vw, 46px); margin-bottom: 20px; }
  .v-orb { position: relative; width: 120px; height: 120px; margin: 0 auto 34px; display: grid; place-items: center; }
  .v-orb .core { width: 84px; height: 84px; border-radius: 50%; background: var(--accent-grad); color: var(--accent-t);
    display: grid; place-items: center; font-size: 34px; z-index: 2;
    box-shadow: 0 12px 34px var(--glow-soft), 0 0 20px var(--glow-soft); }
  .ring { position: absolute; border-radius: 50%; border: 2px solid var(--accent); opacity: 0; }
  .r1 { width: 120px; height: 120px; animation: pulsering 2.4s ease-out infinite; }
  .r2 { width: 120px; height: 120px; animation: pulsering 2.4s ease-out infinite 1.2s; }
  @keyframes pulsering { 0% { transform: scale(0.7); opacity: 0.7; } 100% { transform: scale(1.25); opacity: 0; } }

  /* CTA + footer */
  .cta { text-align: center; padding: 100px 24px; }
  .cta h2 { font-size: clamp(30px, 5vw, 54px); max-width: 760px; margin: 0 auto 34px; line-height: 1.05; }
  .foot { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;
    padding: 30px 40px; border-top: 1px solid var(--border); }
  .foot .dim { font-size: 13px; color: var(--text-3); }

  @media (max-width: 760px) {
    .nav { padding: 14px 18px; } .links { display: none; }
    .bento { grid-template-columns: 1fr; }
    .hero { padding: 60px 20px 50px; }
  }
</style>
