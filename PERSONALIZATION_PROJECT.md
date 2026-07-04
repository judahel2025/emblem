# PERSONALIZATION PROJECT — build plan (awaiting Judah's approval)

Status: **PLAN ONLY. Nothing here is built yet.** Judah approves before implementation.
Written 2026-07-04. Now backed by **full research** (all cited inline): personalization
patterns, Claude agentic principles, connector UX, memory-panel UX, in-chat document UX,
the ChatGPT/Claude skill-builder flows, and a complete document-library + Cloudflare-Worker
compatibility study. **The document stack is confirmed Worker-native; the Skills architecture
is validated against Anthropic's own docs.** No pending spikes remain — the plan is locked
enough to build the moment you say go.

---

## 0. The one technical truth this whole plan hinges on (read first)

Your instinct was: "find GitHub skills and fork them so they're live in the codebase, just
like the Composio logos." **Logos and skills are not the same kind of thing, and it decides
the whole architecture.**

- **Logos** are *static files* (SVGs). We "integrated" them by pointing an `<img>` at a URL.
  Zero code runs. That works because a logo is data.
- **Anthropic's document Skills** (`docx`/`pptx`/`xlsx`/`pdf` in `anthropics/skills`) are
  **code-execution artifacts**. Verified against the actual SKILL.md files: they shell out to
  **Python (`openpyxl`, `pandas`, `pypdf`, `pdfplumber`, `reportlab`, `pytesseract`), Node
  (`docx-js`, `pptxgenjs`), and LibreOffice/Poppler/qpdf** — and the API gates them behind a
  **code-execution container** and three beta headers (`code-execution-2025-08-25`,
  `skills-2025-10-02`, `files-api-2025-04-14`). ([docx](https://github.com/anthropics/skills/blob/main/skills/docx/SKILL.md),
  [xlsx](https://github.com/anthropics/skills/blob/main/skills/xlsx/SKILL.md),
  [pptx](https://github.com/anthropics/skills/blob/main/skills/pptx/SKILL.md),
  [pdf](https://github.com/anthropics/skills/blob/main/skills/pdf/SKILL.md))

**Emblem's backend is a Cloudflare Worker — a V8 isolate: no Python, no shell, no
`child_process`, no persistent filesystem, no LibreOffice.** Copying those skills in would
hand the model *instructions it physically cannot run.* So we **cannot "fork and run" them**
the way we hot-linked the logos.

**The correct, durable path (what this plan does):** re-implement the *capabilities* natively
with JavaScript/WASM libraries that genuinely run on our stack (all confirmed below, §4–5),
and adopt the **SKILL.md *concept*** (a skill = a named, described, reusable instruction) for
the guidance layer — routing to native tools instead of shelling out. This is better than
forking: it's ours, it runs, no sandbox dependency, we own the quality.
([Anthropic Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills),
[Platform docs](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview))

---

## 1. Deep personalization — the "it knows me" layer

Research finding (ChatGPT/Claude/Notion/Mem reviews): the feeling of "it knows me" comes from
**four separate, visible, editable layers** — tone, standing instructions, learned facts, and
live connector context. Products that merge them into one opaque "memory" blob feel generic;
the #1 complaint is "I can't tell what's influencing it / it saved junk / context rot."

**1a. Split the profile into distinct, individually-editable layers.**
- **Tone** — trait chips (Direct, Warm, Concise, Playful, Formal, Encouraging…) that shape
  *delivery only*. Fastest, safest personalization win; 2–3 recommended.
- **Master Instruction** — the thing you asked for. Following ChatGPT's proven split, TWO
  fields: *"What should Emblem know about you?"* and *"How should Emblem respond?"* Applied
  deterministically every turn. Live character counter; generous cap (ChatGPT's 1,500 is a
  top complaint — we go higher). ([ChatGPT custom instructions](https://help.openai.com/en/articles/8096356-chatgpt-custom-instructions))
- **Facts** — learned durable facts (name, role, stack, projects, relationships).
- Partly exists today (`profiles`: display_name, role, tone, comm_style). This formalizes them.

**1b. Memory panel (Settings → Memory) — transparent + editable (the Claude model, not the
opaque ChatGPT one).** Confirmed spec from the memory-UX research:
- Every saved fact as a **row**: fact text · source (which chat/when) · date.
- **Per-item Edit and Delete** — inline, and delete means delete (with confirm).
- **Explicit "+ Add memory"** — manual add of a fact or a standing preference (your "memory
  tab to add further instructions of how one wants to relate with Emblem").
- **"Used in this reply" indicator** — a small chip on replies that consumed a memory ("I
  remembered you prefer TypeScript"), clickable to jump to it. This is the single biggest
  trust lever and the thing ChatGPT is criticized for *lacking*. ([Claude memory](https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context))
- **Capacity meter + prune suggestions** if we cap storage — never silently drop a write
  (ChatGPT's "memory full" wall is a named pain point).
- **Global on/off** + per-item disable for the privacy-conscious.
- Backed by the existing `memory` table + new `POST/PUT/DELETE /api/memory` and a
  `used_memory_ids` field returned from the agent.

**1c. Memory quality gate (kills "context rot").** Only save *generalizable* facts (true
outside this one chat). Prefer a lightweight "want me to remember that?" confirmation over
silent capture. **Never a "memory updated" toast on every message** (a documented ChatGPT
complaint) — a subtle, dismissible "saved · manage" affordance instead.

**1d. Master Instruction in onboarding + Settings.** Onboarding asks how they want Emblem to
talk to them (tone + language) AND explicitly says they can change it later in Settings →
Master Instructions (exactly your ask).

---

## 2. Proactive grounding on real signals

The frontier nobody nails (Notion AI's #1 criticism: "it has my data but doesn't use it").
- On real triggers (a calendar event soon, a new GitHub PR, an unanswered email) Emblem
  surfaces ONE accurate, grounded line: *"You've a 3pm with Sarah; the last thread was the
  contract redline — want me to prep notes?"*
- Read-only first. Fired by real events via the existing cron heartbeat + connector reads,
  **not a timer**, and never nags. One accurate callback beats ten guesses.

---

## 3. Skills system

A skill = a named, described, reusable capability. Validated design: adopt Anthropic's
**SKILL.md concept + progressive disclosure**, but implement it as **prompts that route to
native TS tools** (no sandbox). ([Agent Skills](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview))

**3a. Schema (D1, spec-aligned):**
```ts
interface EmblemSkill {
  id; owner;                      // owner=null → built-in master skill
  name;                           // ≤64 chars, [a-z0-9-]
  description;                    // WHAT it does + WHEN to use (trigger phrases) — Level-1 text
  when_to_use?;                   // extra trigger cues, folded into routing
  instructions;                   // the SKILL.md body (Level-2 content)
  example?; required_tools?;      // native TS tools it may call (analogue of allowed-tools)
  kind: 'instruction' | 'tool_backed';
  source: 'builtin' | 'user_chat' | 'user_paste' | 'imported';
  enabled; version?; created_at; updated_at;
}
```

**3b. Runtime = progressive disclosure reproduced in the Worker (no filesystem):**
1. **Level 1 (every turn, cheap):** load only `{name, description, when_to_use}` for enabled
   skills (cache in KV). With many skills, a **retrieval prescreen** (keyword/embedding match
   on the user message) injects only the top 1–2 candidates — "don't dump all skills."
2. **Level 2 (on match):** inject that skill's full `instructions` for that turn only.
3. **Level 3 (on demand):** `required_tools` point at native TS tools the agent calls through
   the normal loop; big references live in D1, fetched by a `get_skill_reference(id)` tool.
   Token cost stays flat no matter how many skills a user accumulates.

**3c. Built-in "master skills" (invisible, in-app).** Curated, always-present, not
user-editable. Two internal types: **instruction-skills** (pure prompt — e.g. "document-
designer" typography/spacing rules, "research", "content-drafting") and **tool-backed skills**
(an instruction body + a required native tool — e.g. "create-document" → `create_document`).
Some carry "improve/redesign" guidance so Emblem self-corrects as it works (your ask).

**3d. User-created skills (Settings → Skills).** UX modelled on the ChatGPT GPT Builder /
Claude skill-creator (both validated):
- **Conversational builder** — a **Create / Configure split writing to ONE shared config,
  with a live Preview** you can test before saving. Emblem interviews you, drafts the skill,
  and **shows which fields it just changed each turn**; every AI-filled field stays manually
  editable. ([GPT Builder](https://help.openai.com/en/articles/8770868-gpt-builder),
  [Claude skill-creator](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md))
- **Paste-in from an external source** — a big Instructions textarea (the universal "capability
  atom"); an importer pass normalizes it into the schema and **strips any `scripts:`/bash steps
  it can't run**, mapping intent onto native tools. A **magic-wand "improve"** button (table
  stakes across ChatGPT/Claude/Gemini) tightens a rough paste.
- **Manage** — list / edit / enable-disable / delete.

**3e. Save-a-skill-from-chat.** When a repeatable workflow emerges in normal chat, Emblem
offers "save this as a skill?" → one tap stores it.

**3f. Security.** Pasted skills are untrusted; since Emblem skills are *prompts, not code*, the
blast radius is instruction-injection only — sanitize, and a skill can never silently widen its
`required_tools`.

---

## 4. Document generation (create) — CONFIRMED native, runs on our stack

All four types generate inside the Worker on the **Workers Paid plan** (Free's 10 ms CPU is
unusable; Paid gives 30 s, raisable to 5 min). `compatibility_flags = ["nodejs_compat"]`,
compat date ≥ 2024-09-23. ([Worker limits](https://developers.cloudflare.com/workers/platform/limits/),
[nodejs_compat](https://developers.cloudflare.com/workers/runtime-apis/nodejs/))

| Output | Library | Runs in | Locked detail |
|---|---|---|---|
| .docx | `docx` (dolanmiu) ✅ | Worker | `Packer.toArrayBuffer()` — NOT `toBuffer()` (issue #379) |
| .pptx | `pptxgenjs` ✅ | Worker | `pptx.write({outputType:'arraybuffer'})`, never `writeFile` |
| .xlsx | SheetJS `xlsx` ✅ | Worker | **install from `cdn.sheetjs.com` tarball, not npm** (npm pkg is stale); `exceljs` only if rich cell styling needed |
| .pdf (structured) | `pdf-lib` ✅ | Worker | ~250 KB; custom/Unicode fonts need `@pdf-lib/fontkit` (bundler gotcha #8140) + fonts fetched in-memory |
| .pdf (print-grade layout) | Cloudflare **Browser Rendering** binding | separate CF product | only if magazine-grade HTML→PDF is wanted; a Worker can't run headless Chrome in-isolate |

- **Rejected:** `pdfmake` (~1 MB gzipped — blows the bundle budget); `html-to-docx` (Node/DOM
  deps, fails in Workers).
- **Storage & download:** generate in Worker → put to **R2** → return a download link. Use
  **`aws4fetch`** for any presigned-URL work (the AWS SDK is too heavy/Node-bound for the
  isolate). Serve downloads from a **custom domain** on the bucket (not `r2.dev`, which is
  rate-limited/dev-only). ([R2 presigned](https://developers.cloudflare.com/r2/api/s3/presigned-urls/))
- **Where heavy jobs go:** bounded docs → Worker. Large/user-specific → generate in the Svelte
  **browser** and upload to R2 via presigned PUT (client CPU/RAM is free vs the 128 MB isolate
  cap). Genuinely huge / print-grade → a **Cloudflare Container** (Worker→Container→R2). Reserve
  Containers for real need — they're far pricier than Workers. ([Containers](https://developers.cloudflare.com/containers/))
- **"Best-designed documents":** a small internal **doc-design system** (templates, real
  typography, spacing, section styles, cover blocks) is where the quality comes from — the
  library is the easy part. This is the "document-designer" master skill (§3c).

---

## 5. Document reading (parse) — CONFIRMED native

| Input | Library | Runs in | Locked detail |
|---|---|---|---|
| .pdf | `unpdf` ✅ | Worker | purpose-built for edge; wraps `pdfjs-serverless`; `extractText()`. Do NOT use raw `pdfjs-dist` |
| .docx | `mammoth` (rich HTML) / `fflate.unzipSync`+`fast-xml-parser` (light text) ✅ | Worker | mammoth browser build; there is no `DOMParser` in Workers |
| .xlsx | SheetJS `xlsx` ✅ | Worker | `XLSX.read(arrayBuffer)` → `sheet_to_json` |
| .pptx | `fflate.unzipSync` + `fast-xml-parser` over `<a:t>` ✅ | Worker | use the SYNC unzip API (async needs threads Workers lack) |

- Upload → R2 → parse → Emblem reads/summarizes/acts. The existing `analyze/upload` path
  extends to these. `mammoth` + `jszip` already ship in the frontend, so parsing is partly
  proven. ([unpdf](https://github.com/unjs/unpdf), [SheetJS on CF](https://docs.sheetjs.com/docs/demos/cloud/cloudflare), [fflate](https://github.com/101arrowz/fflate))
- **Deps to install** — generate: `docx`, `pptxgenjs`, SheetJS `xlsx` (CDN tarball), `pdf-lib`
  (+`@pdf-lib/fontkit`); parse: `unpdf`, `mammoth`, `fflate`, `fast-xml-parser`; R2: `aws4fetch`.

---

## 6. In-chat document generation UX (spin up agents, show a real doc being built)

Modelled on Gamma + ChatGPT Canvas + Claude Artifacts (all validated):
1. **Detach into a right-side panel** the moment generation starts — an artifact in its own
   panel reads as a *document*, not a chat message.
2. **Outline first** (Gamma/Tome) — a fast title + section list you can edit/reorder before the
   expensive render. This is what makes output feel *authored*, not auto-filled.
3. **Skeleton pages shaped like the final content** (not a spinner) with a shimmer — previews
   the layout and makes the wait feel ~30% faster.
4. **Stream content in section-by-section / card-by-card**; page thumbnails grow as sections
   complete — the "real multi-page document" signal.
5. **Stop/Cancel** during generation.
6. **Download cluster at the end** — explicit **Download (PDF / DOCX / PPTX / XLSX)** + copy +
   save-to-Files. The real-format export is the credibility payoff.
- **Agentic assembly:** for a big multi-section doc, fan out one subagent per section
  (parallel) → assemble → one formatted document → R2 → download. Per Claude's own guidance,
  **default to a single pass; fan out only when genuinely breadth-first** (independent
  sections), since multi-agent runs ~15× the tokens — a complexity check decides.
  ([Canvas](https://openai.com/index/introducing-canvas/), [Artifacts](https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them),
  [multi-agent cost](https://www.anthropic.com/engineering/multi-agent-research-system))

---

## 7. Suggested phasing (each ships independently)

- **Phase A — Personalization core** (§1): profile split (tone chips + two-field master
  instruction) + Memory panel + "used in this reply" indicator. Highest "it knows me" ROI,
  zero infra risk. **Start here.**
- **Phase B — Documents** (§4–5): native create + read tools, in-chat generate + download.
  Requires flipping the Worker to the **Paid plan** + adding the libs.
- **Phase C — Skills system** (§3): schema, retrieval-gated runtime, conversational builder,
  paste-in, save-from-chat, built-in master skills.
- **Phase D — Proactive grounding** (§2).
- **Phase E — Agentic multi-section docs + right-side document panel** (§6).

---

## 8. Open decisions I need from you

1. **Workers Paid plan.** Document generation needs it (Free's 10 ms CPU can't do it). ~$5/mo
   base. OK to move Emblem's Worker to Paid as part of Phase B? *(Required for docs.)*
2. **Print-grade PDF.** Start with `pdf-lib` (clean, in-Worker, good) and add Cloudflare
   **Browser Rendering** only later if you want magazine-grade HTML→PDF? *(My rec: yes, start
   simple.)*
3. **Skills power.** Confirm **skills-as-prompts + native tools** (no new infra, ships fast) —
   a full code-execution sandbox stays a possible later addition, not now. *(My rec: yes.)*
4. **Heavy/large docs.** Default to browser-side generation + presigned R2 upload for big or
   user-specific files, reserving Containers for genuinely huge/print jobs? *(My rec: yes.)*

---

## 9. What this is NOT (honesty)

- Not implemented — awaiting your approval.
- We are **not** forking Python skills to "run live" — they can't run in a V8 isolate (§0,
  validated against the actual SKILL.md files). We build the capabilities natively so they
  actually work, and adopt the SKILL.md *concept* for guidance.
- Every library above is **confirmed Worker-compatible** by the research; the only genuine
  new dependency is the **Paid plan** (decision #1) and, optionally, Browser Rendering /
  Containers for print-grade or huge documents.
```
