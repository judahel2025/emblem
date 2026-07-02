# Veyra Skills Library

Skills are Veyra's playbooks. Each skill is a Markdown file that tells Veyra **how to do a
class of real work** — generate a document, write code, build a chart, draft social posts —
to an Anthropic-grade standard. The agent loads the relevant skill before acting, so its
output is consistent, high-quality, and follows a known workflow.

## How a skill works

Every skill file has YAML frontmatter and a body:

```yaml
---
name: human-readable name
description: one line — used to decide when this skill applies
when_to_use: the triggers that should load this skill
outputs: what it produces (md, docx, pdf, code, chart, post...)
tools: kernel tools / libraries it uses
---
```

Body sections: **Overview · When to use · Workflow (steps) · Output format · Quality bar ·
Examples**. The agent reads `description`/`when_to_use` to pick a skill, then follows the
Workflow exactly.

## How Veyra selects and runs a skill

1. You speak or type a request (e.g. "write me an academic essay on climate finance").
2. The router matches it to a skill by `description` / `when_to_use`.
3. The agent follows the skill's Workflow, asking only the clarifying questions the skill
   says to ask — then it proceeds.
4. The result is produced **and saved automatically** to the right place under `C:\VEYRA`,
   and appears on the **Files** page.

## Voice → action routing (what goes where)

Veyra decides the destination from the verb, not from you choosing a tab:

| You say… | Destination | Skill family |
|---|---|---|
| "write / generate code", "build a function/script" | **Code editor** (Make → Code), saved to `workspaces` | `code/*` |
| "run / execute / install / test it" | **Terminal** (`terminal.run`) | `code/terminal-and-execution` |
| "write / draft a document / essay / report / letter" | **Documents** (saved to `documents`) | `documents/*` |
| "make a Word doc / PDF / spreadsheet" | **Office export** (saved to `exports`) | `office/*` |
| "make a chart / graph of…" | **Chart image** (saved to `exports`) | `office/data-visualization` |
| "draft posts / captions for…" | **Social drafts** | `content/*` |
| "research / look up / find current info on…" | **Research** | `research/web-research` |

Anything that **sends, posts, deletes, refunds, or moves money** stops at the **approval
gate** first — Veyra asks you (by voice) before doing it.

## The library

### documents/
- `academic-writing` — essays, theses, research summaries, study notes, citations.
- `reports-and-proposals` — business/technical reports, proposals, executive summaries.
- `business-and-personal` — letters, business plans, resumes/CVs, memos.
- `creative-and-copy` — fiction, scripts, ad/marketing copy, storytelling.

### office/
- `word-and-pdf` — polished `.docx` and `.pdf` with headings, TOC, tables, page numbers.
- `spreadsheets` — `.xlsx`/CSV with formulas, formatting, multiple sheets.
- `data-visualization` — bar/line/pie/scatter charts as PNG/SVG.

### code/
- `writing-code` — generate code straight into the editor, any language.
- `debugging-and-review` — find bugs, refactor, explain, security review.
- `project-scaffolding` — whole project structures and boilerplate.
- `terminal-and-execution` — run commands, install deps, run tests, start servers.

### content/
- `social-media` — platform-native posts (IG, X, LinkedIn, TikTok, Threads, FB, Shorts).
- `content-strategy` — calendars, hooks, repurposing, hashtags, SEO.

### research/
- `web-research` — search, read, verify, summarize, cite; treats web content as untrusted.

## Quality bar (applies to every skill)

- Match the requested audience, tone, and length; never pad.
- Be accurate; never present invented facts as verified — if sources are needed, research.
- Follow the skill's output format exactly so files are clean and reusable.
- Save the result and report the path; offer the obvious next step.
- For anything irreversible or outward-facing, ask for approval first.

## Status

Skill files = the knowledge (done). Execution depends on the layer below them:
- Text/Markdown/code generation → works with any installed Ollama model.
- `.docx` / `.pdf` / `.xlsx` / charts → need Python libs (`python-docx`, `reportlab`,
  `openpyxl`, `matplotlib`); each office skill lists its dependency. Install on demand.
