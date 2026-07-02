<script>
  // Perfect white + light-lemon landing page.
  // Design DNA: Air / Apple / Aboard — airy light canvas, oversized display type,
  // one warm lemon accent, a playful arc, generous whitespace. Says nothing about
  // which AI or providers power it — that stays entirely in the backend.
  import { createEventDispatcher } from "svelte";
  const dispatch = createEventDispatcher();
  const enter = () => dispatch("enter");

  const tools = [
    { i: "ti-brand-google-filled", n: "Gmail" },
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
  <header class="nav">
    <div class="brand"><span class="mark">V</span> Emblem</div>
    <nav class="links">
      <a href="#features">Product</a>
      <a href="#connect">Connections</a>
      <a href="#voice">Voice</a>
    </nav>
    <div class="nav-cta">
      <button class="ghost" on:click={enter}>Sign in</button>
      <button class="lemon" on:click={enter}>Open workspace</button>
    </div>
  </header>

  <!-- Hero -->
  <section class="hero">
    <div class="arc"></div>
    <div class="orb"><i class="ti ti-sparkles"></i></div>
    <div class="eyebrow"><i class="ti ti-microphone"></i> Voice-first · does the work for you</div>
    <h1>Your whole workday.<br/>One voice.</h1>
    <p class="sub">Emblem is the AI workspace you talk to. It connects to the tools you already use,
      remembers what matters, and quietly gets things done — so you don't have to.</p>
    <div class="hero-cta">
      <button class="lemon big" on:click={enter}>Start free <i class="ti ti-arrow-right"></i></button>
      <button class="ghost big" on:click={enter}><i class="ti ti-player-play"></i> Hold to talk</button>
    </div>
    <div class="hero-note">No card needed · your accounts stay private to you</div>
  </section>

  <!-- Connections trust row -->
  <section id="connect" class="trust">
    <div class="trust-label">Connects to everything you work in — 20,000+ tools</div>
    <div class="tiles">
      {#each tools as t}
        <div class="tile"><i class="ti {t.i}"></i><span>{t.n}</span></div>
      {/each}
      <div class="tile more">+20k more</div>
    </div>
  </section>

  <!-- Features bento -->
  <section id="features" class="features">
    <h2>A workspace that works back.</h2>
    <div class="bento">
      {#each features as f, idx}
        <div class="fcard" class:wide={idx === 0}>
          <div class="ficon"><i class="ti {f.i}"></i></div>
          <div class="ftitle">{f.t}</div>
          <div class="fdesc">{f.d}</div>
        </div>
      {/each}
    </div>
  </section>

  <!-- Voice section -->
  <section id="voice" class="voice">
    <div class="v-orb">
      <span class="ring r1"></span><span class="ring r2"></span>
      <span class="core"><i class="ti ti-microphone"></i></span>
    </div>
    <h2>Talk to it. It does the rest.</h2>
    <p class="sub">Say "reply to Sarah and put a follow-up on Friday." It drafts the email, stages the
      event, and shows you both to approve — out loud or on screen.</p>
    <button class="lemon big" on:click={enter}>Try the voice demo <i class="ti ti-arrow-right"></i></button>
  </section>

  <!-- Big CTA -->
  <section class="cta">
    <h2>Meet the assistant that has your back.</h2>
    <button class="lemon big" on:click={enter}>Open your workspace <i class="ti ti-arrow-right"></i></button>
  </section>

  <footer class="foot">
    <div class="brand"><span class="mark">V</span> Emblem</div>
    <span class="dim">Your voice-first AI workspace.</span>
    <span class="dim">© 2026 Emblem</span>
  </footer>
</div>

<style>
  .lp { background: #fff; color: var(--text); min-height: 100vh; overflow-x: hidden; }
  .lp :global(h1), .lp :global(h2) { font-weight: 800; letter-spacing: -0.03em; color: var(--text); margin: 0; }

  /* Nav */
  .nav { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; justify-content: space-between;
    padding: 16px 40px; background: rgba(255,255,255,0.82); backdrop-filter: blur(10px); border-bottom: 1px solid var(--border); }
  .brand { display: flex; align-items: center; gap: 9px; font-size: 19px; font-weight: 700; letter-spacing: -0.02em; }
  .mark { width: 26px; height: 26px; border-radius: 8px; background: var(--accent); color: var(--accent-t);
    display: grid; place-items: center; font-weight: 800; font-size: 16px; }
  .links { display: flex; gap: 30px; }
  .links a { color: var(--text-2); font-size: 14px; font-weight: 500; text-decoration: none; transition: color .15s; }
  .links a:hover { color: var(--text); }
  .nav-cta { display: flex; gap: 10px; align-items: center; }

  .ghost { background: transparent; border: 1px solid transparent; color: var(--text-2); padding: 9px 14px;
    border-radius: 22px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all .15s; }
  .ghost:hover { color: var(--text); background: var(--s2); }
  .lemon { background: var(--accent); color: var(--accent-t); border: none; padding: 9px 18px; border-radius: 22px;
    font-size: 14px; font-weight: 700; cursor: pointer; transition: all .18s; display: inline-flex; align-items: center; gap: 7px; }
  .lemon:hover { background: var(--accent-h); transform: translateY(-1px); }
  .big { padding: 14px 26px; font-size: 16px; border-radius: 26px; }
  .ghost.big { border: 1px solid var(--border-strong); color: var(--text); }
  .ghost.big:hover { background: var(--s1); }

  /* Hero */
  .hero { position: relative; text-align: center; padding: 96px 24px 80px; }
  .arc { position: absolute; top: 60px; left: 50%; transform: translateX(-50%); width: 1400px; height: 700px;
    border-radius: 50%; background: radial-gradient(ellipse at center top, rgba(241,232,106,0.55), rgba(241,232,106,0.0) 60%);
    z-index: 0; pointer-events: none; }
  .orb { position: relative; z-index: 1; width: 92px; height: 92px; margin: 0 auto 30px; border-radius: 26px;
    background: var(--accent); color: var(--accent-t); display: grid; place-items: center; font-size: 40px;
    box-shadow: 0 20px 50px rgba(233,220,62,0.45); animation: float 4s ease-in-out infinite; }
  @keyframes float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
  .eyebrow { position: relative; z-index: 1; display: inline-flex; align-items: center; gap: 7px; font-size: 13px;
    font-weight: 600; color: var(--accent-t); background: var(--s1); border: 1px solid var(--border);
    padding: 7px 15px; border-radius: 20px; margin-bottom: 26px; }
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
    border-radius: 14px; font-size: 14px; font-weight: 600; color: var(--text-2); }
  .tile i { font-size: 20px; color: var(--accent-t); }
  .tile.more { color: var(--accent-t); background: var(--accent-bg); border-color: var(--border-strong); }

  /* Features */
  .features { padding: 90px 24px; max-width: 1080px; margin: 0 auto; }
  .features h2 { font-size: clamp(30px, 4.5vw, 46px); text-align: center; margin-bottom: 48px; }
  .bento { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
  .fcard { background: var(--s1); border: 1px solid var(--border); border-radius: 20px; padding: 28px; transition: all .2s; }
  .fcard:hover { border-color: var(--border-strong); transform: translateY(-3px); }
  .fcard.wide { grid-column: span 1; background: var(--accent-bg); border-color: var(--border-strong); }
  .ficon { width: 46px; height: 46px; border-radius: 13px; background: #fff; border: 1px solid var(--border);
    display: grid; place-items: center; font-size: 23px; color: var(--accent-t); margin-bottom: 18px; }
  .ftitle { font-size: 19px; font-weight: 700; letter-spacing: -0.01em; margin-bottom: 8px; }
  .fdesc { font-size: 15px; line-height: 1.6; color: var(--text-2); }

  /* Voice */
  .voice { text-align: center; padding: 90px 24px; background: var(--s1); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
  .voice h2 { font-size: clamp(30px, 4.5vw, 46px); margin-bottom: 20px; }
  .v-orb { position: relative; width: 120px; height: 120px; margin: 0 auto 34px; display: grid; place-items: center; }
  .v-orb .core { width: 84px; height: 84px; border-radius: 50%; background: var(--accent); color: var(--accent-t);
    display: grid; place-items: center; font-size: 34px; z-index: 2; box-shadow: 0 12px 34px rgba(233,220,62,0.5); }
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
