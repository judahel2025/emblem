<script>
  // Help center, layout from stitch_emblem_core_ui/help_documentation:
  // "How can we help you today?" hero with a big search, three category cards,
  // then an accordion FAQ.
  import { fly, slide } from "svelte/transition";

  let query = "";
  let openIdx = null;

  const CATEGORIES = [
    { icon: "ti-microphone", title: "Getting started",
      desc: "Meeting Emblem, the voice conversation, the guided tour, and finding your way around." },
    { icon: "ti-plug-connected", title: "Connections & automations",
      desc: "Linking your Gmail, Calendar and GitHub, opening workspaces, and setting up automations." },
    { icon: "ti-shield-check", title: "Privacy & approvals",
      desc: "How approvals protect you, whose accounts actions run in, and revoking access." },
  ];

  const FAQS = [
    { q: "What is Emblem?",
      a: "Emblem is a workspace you talk to. Ask it anything by voice or by typing. It answers, remembers what matters to you, and acts in the apps you connect: drafting and sending email, managing your calendar, editing code on GitHub, and more." },
    { q: "How does the voice onboarding work?",
      a: "The first time you arrive, tap “Meet Emblem.” Emblem speaks first and asks about you one question at a time. It learns your name, what you do, what you want help with, and how you like to be spoken to. Prefer typing? Choose “prefer typing.” The same conversation runs, and Emblem still answers out loud." },
    { q: "Emblem speaks but I can't hear anything.",
      a: "Browsers block sound until you interact with the page. If you see “Tap to hear Emblem,” tap it once and audio unlocks. Also check your device volume and that the tab isn't muted." },
    { q: "How do I connect my apps?",
      a: "Open Connections in the sidebar and pick an app: Gmail, Google Calendar, GitHub, and thousands more. Sign-in happens securely in a popup with the app's own login page. Emblem never sees your password, and you can revoke a connection anytime." },
    { q: "Whose account does Emblem act in?",
      a: "Yours, always. When you ask Emblem to send an email, it sends from YOUR connected Gmail, your address, your sent folder. Commits push to YOUR GitHub. If the app you need isn't connected yet, Emblem asks you to connect it rather than sending any other way." },
    { q: "What are approvals?",
      a: "Anything consequential (sending, posting, committing, deleting) pauses first and shows you a card describing exactly what will happen, like “Send email to sam@work.com via your Gmail.” Nothing happens until you approve. Each approval covers exactly that one action, and declining costs nothing." },
    { q: "What does Emblem remember, and can I shape how it talks to me?",
      a: "Durable things you tell it: your name, preferences, projects, decisions. You can see, edit, pin, or delete any of it in Settings → Memory. You can also set a standing master instruction there for how you want it to talk to you (tone, language, what to avoid), and it applies to every conversation from then on." },
    { q: "What are skills?",
      a: "A skill is a saved way of handling a repeatable task, written in plain language once and reused automatically after. Tell Emblem “save this as a skill” after it does something well, describe one from scratch in Settings → Skills, or just let Emblem offer to save one when it notices a pattern. The next time a similar request comes up, it follows the skill without you explaining it again." },
    { q: "What are threads?",
      a: "Every conversation is saved in the sidebar with an automatic title. Start a fresh one with New chat, then reopen, rename, or delete old ones anytime." },
    { q: "How do automations work?",
      a: "Describe what you want in plain language, like “every morning, summarize my unread email,” and Emblem runs it on schedule. Pause or delete any automation from the Automations screen. During your quiet hours, non-urgent updates hold until morning." },
    { q: "Can I change how Emblem looks?",
      a: "Yes: light, dark, or follow-your-system, from the toggle in the sidebar or in Settings → Preferences." },
  ];

  $: shown = query.trim()
    ? FAQS.filter((f) => (f.q + " " + f.a).toLowerCase().includes(query.trim().toLowerCase()))
    : FAQS;

  function toggle(i) { openIdx = openIdx === i ? null : i; }
</script>

<div class="page">
  <header class="hero" in:fly={{ y: 10, duration: 250 }}>
    <h1>How can we help you today?</h1>
    <div class="search glass">
      <i class="ti ti-search"></i>
      <input bind:value={query} placeholder="Type your question, e.g. “connect Gmail” or “approvals”"
             aria-label="Search help" />
    </div>
  </header>

  <div class="cats">
    {#each CATEGORIES as c, i}
      <div class="cat glass gloss" in:fly={{ y: 10, duration: 200, delay: i * 60 }}>
        <span class="cicon"><i class="ti {c.icon}"></i></span>
        <h3>{c.title}</h3>
        <p>{c.desc}</p>
      </div>
    {/each}
  </div>

  <section class="faq">
    <h2>Frequently asked questions</h2>
    {#if shown.length === 0}
      <div class="empty">No matches, try different words, or just ask Emblem in chat.</div>
    {/if}
    {#each shown as f, i (f.q)}
      <div class="qa" class:open={openIdx === i}>
        <button class="q" on:click={() => toggle(i)} aria-expanded={openIdx === i}>
          <span>{f.q}</span>
          <i class="ti {openIdx === i ? 'ti-minus' : 'ti-plus'}"></i>
        </button>
        {#if openIdx === i}
          <p class="a" transition:slide={{ duration: 180 }}>{f.a}</p>
        {/if}
      </div>
    {/each}
  </section>

  <p class="footnote">Still stuck? Just ask Emblem in chat. It knows this product best.</p>
</div>

<style>
  .page { max-width: 860px; margin: 0 auto; padding: 40px 24px 60px; }

  .hero { text-align: center; margin-bottom: 36px; }
  h1 { font-size: 38px; font-weight: 500; letter-spacing: -0.04em; color: var(--text); margin: 0 0 22px; }
  .search {
    display: flex; align-items: center; gap: 10px;
    max-width: 560px; margin: 0 auto;
    border-radius: var(--r-lg); padding: 14px 18px;
    box-shadow: var(--shadow-md);
    transition: border-color var(--t-fast), box-shadow var(--t-fast);
  }
  .search:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-bg), var(--shadow-md); }
  .search i { color: var(--text-3); font-size: 18px; }
  .search input { flex: 1; background: none; border: none; outline: none; font-size: 15px; color: var(--text); }
  .search input::placeholder { color: var(--text-3); }

  .cats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 44px; }
  @media (max-width: 720px) { .cats { grid-template-columns: 1fr; } }
  .cat { border-radius: var(--r-md); padding: 22px; box-shadow: var(--shadow-sm);
    transition: box-shadow var(--t-fast), border-color var(--t-fast), transform var(--t-fast); }
  .cat:hover { box-shadow: var(--shadow-md); border-color: var(--border-strong); transform: translateY(-2px); }
  .cicon {
    width: 40px; height: 40px; border-radius: var(--r-sm);
    background: var(--accent-bg); color: var(--accent-ink);
    display: grid; place-items: center; font-size: 21px; margin-bottom: 14px;
  }
  .cat h3 { margin: 0 0 6px; font-size: 17px; font-weight: 500; color: var(--text); }
  .cat p { margin: 0; font-size: 13px; line-height: 1.55; color: var(--text-2); }

  .faq h2 { font-size: 24px; font-weight: 500; letter-spacing: -0.02em; color: var(--text); margin: 0 0 18px; }
  .qa { border-bottom: 1px solid var(--border); }
  .q {
    width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 14px;
    text-align: left; padding: 16px 2px; cursor: pointer;
    font-size: 15px; font-weight: 500; color: var(--text);
    transition: color var(--t-fast);
  }
  .q:hover { color: var(--accent-ink); }
  .q i { color: var(--text-3); font-size: 16px; flex-shrink: 0; }
  .qa.open .q { color: var(--accent-ink); }
  .a { margin: 0; padding: 0 2px 18px; font-size: 14.5px; line-height: 1.65; color: var(--text-2); max-width: 760px; }

  .footnote { margin-top: 32px; text-align: center; font-size: 13px; color: var(--text-3); }
</style>
