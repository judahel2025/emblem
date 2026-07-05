// The guided product tour — Emblem walks a new member through the workspace.
// Each step: which screen to show, which element to spotlight ([data-tour=...]),
// and the exact narration line (spoken via cached TTS + shown as the caption).
export const TOUR_STEPS = [
  {
    view: "chat",
    target: "composer",
    title: "This is where we talk",
    script: "This is home. Ask me anything here — type, attach a file, or tap the mic and just speak.",
  },
  {
    view: "chat",
    target: "sidebar",
    title: "Your conversations",
    script: "Every conversation lives here, titled and ready to pick back up whenever you are.",
  },
  {
    view: "connect",
    target: "connect-grid",
    title: "Connections",
    script: "This is Connections. Link your Gmail, GitHub, Calendar and more — I act in YOUR accounts, and anything consequential always asks you first.",
  },
  {
    view: "pages",
    target: "pages-root",
    title: "Notes",
    script: "Notes are living documents. Ask me to start one in chat, and we'll grow it together.",
  },
  {
    view: "calendar",
    target: "calendar-root",
    title: "Calendar",
    script: "Your calendar, at a glance. Tell me about an event in plain words and I'll put it in the right place.",
  },
  {
    view: "automations",
    target: "automations-root",
    title: "Automations",
    script: "Automations run while you don't. Describe what you want — every morning, every week — and I'll keep it running.",
  },
  {
    view: "chat",
    target: "composer",
    title: "That's the tour",
    script: "That's everything. I'm ready when you are — ask me anything.",
  },
];
