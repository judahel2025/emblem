// Turn Markdown into clean spoken text so TTS reads it naturally.
//
// Emblem does NOT read everything word-for-word. Code, tables, and long lists are shown on
// screen, so speech collapses them to a short cue ("Here's the code", "Here's the list on
// your screen") instead of reading them out. Regular prose and explanations are spoken in
// full — so "list and explain" reads the explanation and shows the list.

export function speechify(md) {
  let t = String(md || "");

  // Fenced code blocks — never read code aloud; just cue it (it's in the editor/on screen).
  t = t.replace(/```[\s\S]*?```/g, " Here's the code. ");

  // Markdown tables — visual; cue them instead of reading every cell.
  t = t.replace(/(?:^\|.*\|[ \t]*\n?)+/gm, " Here's the table on your screen. ");

  // Long lists (5+ items) — show, don't recite. Short lists still get read.
  t = t.replace(/(?:^[ \t]*(?:[-*+]|\d+\.)\s+.*(?:\n|$)){5,}/gm, " Here's the full list on your screen. ");

  // Headings: drop the # and end with a pause.
  t = t.replace(/^#{1,6}\s+(.*)$/gm, "$1.");

  // Links and images: keep the text, drop the URL.
  t = t.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1");

  // Bold / italic / inline code markers.
  t = t.replace(/(\*\*|__)(.*?)\1/g, "$2");
  t = t.replace(/(\*|_)(.*?)\1/g, "$2");
  t = t.replace(/`([^`]+)`/g, "$1");

  // List markers and blockquotes at line start.
  t = t.replace(/^\s*[-*+]\s+/gm, "");
  t = t.replace(/^\s*\d+\.\s+/gm, "");
  t = t.replace(/^\s*>\s?/gm, "");

  // Leftover stray symbols and tidy whitespace.
  t = t.replace(/[|#`]/g, " ");
  t = t.replace(/[ \t]{2,}/g, " ");
  t = t.replace(/\n{2,}/g, ". ");
  t = t.replace(/\s*\n\s*/g, ". ");
  t = t.replace(/\.\s*\.+/g, ".");
  return t.trim();
}
