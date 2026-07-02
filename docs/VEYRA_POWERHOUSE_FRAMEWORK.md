# Veyra Powerhouse — Master Framework (Canonical)

This is the single source of truth for Veyra's architecture and build. It supersedes
the ordering in `VEYRA_MASTER_PLAN.md` and `VEYRA_EXECUTION_BREAKDOWN.md` (those remain
valid as vision/feature references). Where they conflict, this document wins.

Status legend: [ ] todo · [~] in progress · [x] done

---

## 1. Philosophy

Veyra is a **local-first agentic operator** — not a chat box. The model chooses and
chains **tools** that act on the real world (files, shell, email, money, web, system),
and a **Security Kernel** gates every dangerous action (approve / deny / log / undo).

Power and safety are the same subsystem. The more dangerous the capability, the more the
kernel is what makes it usable instead of reckless.

Core loop:

```
You (voice/text)
  -> Brain (LLM) chooses TOOLS
     -> Tools act on the real world
        -> Security Kernel gates every dangerous tool (approve/deny/log/undo)
           -> Brain sees results, continues or reports
              -> Veyra speaks/writes the outcome
```

---

## 2. Architecture (seven layers)

```
UI LAYER         Command center (Tauri shell): dashboard, IDE, voice, studios,
                 approvals, logs, briefing
AGENT LAYER      Agent loop, tool-calling, planner, model router, streaming, memory
CAPABILITY LAYER Tool registry; each tool tagged with a permission tier
CONNECTOR LAYER  Gmail, Flutterwave, Social, Search, Calendar, WhatsApp... (same tiers)
SECURITY KERNEL  permission tiers, approval gate, audit log, undo/snapshots,
                 secrets vault, kill switch, untrusted-content firewall, sandbox
MODEL LAYER      Ollama (local) + optional cloud escalation
PERSISTENCE      SQLite + local vector store (RAG/memory)
```

### Directory layout (target)

```
C:\VEYRA
  backend\
    veyra\
      kernel\        # security kernel (pure stdlib) -- built first
      tools\         # capability tools, one module per domain
      agent\         # agent loop, model router, planner
      connectors\    # gmail, flutterwave, social, search, calendar...
      api\           # FastAPI app (M2+); stdlib server bridges until then
      memory\        # vector store + RAG
      config.py
    main.py          # legacy stdlib server (kept running until API migration)
  frontend\          # Vite + Svelte + Monaco (M3); current src/ until then
  data\  documents\  workspaces\  exports\  logs\
  .veyra\            # kernel runtime: trash/snapshots, vault, audit db
  docs\
```

---

## 3. Security Kernel (built FIRST — M1)

Every other layer plugs into this. Non-negotiable pieces:

1. **Permission tiers** per tool:
   - `safe`      — auto-run
   - `caution`   — auto-run, logged + user notified (network egress, in-workspace edits)
   - `danger`    — requires explicit approval before running
   - `forbidden` — blocked unless explicitly enabled in settings
2. **Approval Gate** — a `danger` call pauses and emits a request showing: action type,
   exact target/recipient, full payload, account affected, risk level. Resolves to
   approve / reject / approve-and-remember. Agent cannot proceed without resolution.
3. **Audit log** — append-only record of every tool call: actor, action, args (secrets
   redacted), result, tier, approval id, timestamp.
4. **Reversibility** — snapshot before any overwrite/delete to `.veyra\trash`; restore on
   demand. Undo window for sends/publishes where the connector allows.
5. **Secrets vault** — keys encrypted at rest via Windows DPAPI (ctypes, no deps). Never
   rendered in UI, never logged, never sent to the model.
6. **Kill switch** — global "stop everything / local-only" flag, always honored by the
   kernel before any tool runs.
7. **Untrusted-content firewall** — web/email/document content is wrapped as DATA, never
   instructions. Prompt-injection cannot trigger tools.
8. **Sandboxed exec** — shell/code runs in a constrained working dir, command allowlist,
   timeout.

Kernel has ZERO external dependencies (sqlite3, hashlib, ctypes, secrets, json) so it
runs on the currently-installed Python 3.14 today.

---

## 4. Capability map (tools the agent can chain)

Tier in brackets. ★ = in core roadmap; others = backlog the architecture absorbs.

Filesystem: read[safe] list[safe] search[safe] write[caution] move[caution]
  delete[danger] overwrite[danger]
Exec/Code: run-command[danger] run-script[danger] process-control[danger] git[caution]
IDE: open[safe] edit[caution] diff[safe] generate[caution] run-tests[danger]
Documents: generate[safe] export-md/docx/pdf[safe]
Web/Research: search[caution] fetch[caution] deep-research[caution] monitor[caution]
Email (Gmail): read[caution] summarize[safe] draft[safe] send[danger]
Payments: read-tx[caution] revenue-stats[safe] webhook[caution] refund/payout[danger]
Social: draft[safe] rewrite[safe] queue[caution] publish[danger]
Calendar: read[caution] create/move[caution] invite[danger]
Comms (WhatsApp/Telegram): read[caution] draft[safe] send[danger]
System: clipboard[caution] notify[safe] screenshot[caution] open-app[caution]
  window-control[danger]
Scheduler: schedule[caution] (scheduled action keeps its own tier)
Memory/RAG: remember[safe] recall[safe]
Vision: ocr[safe] screen-understand[caution]
Invoicing: generate[safe] send[danger] track[safe] remind[danger]

---

## 4b. Experience structure (the redesign — approved)

Veyra is NOT an app with pages. It is one adaptive surface:

- **Voice bar (omnipresent)** at the base — speak or type from any mode; shows state
  (listening / thinking / speaking / acting). The spine of the whole app.
- **The Stage** shows ONE of four modes at a time, summoned by voice or the dock:
  - **Converse** — talk; answers + small artifacts inline.
  - **Make** — the creation canvas: Code (IDE) and Write (documents/content).
  - **Pulse** — your world at a glance: money, inbox, content, research.
  - **Guard** — safety: approvals, activity audit, secrets, kill switch.
- **Tiny mode dock** (left) — 4 mode icons + status dot. The only nav chrome.
- **Status strip** (top) — pending approvals, connectors, local/online, kill switch.
- **Three depths within the Stage:** Ambient (resting) -> Split (working: conversation +
  one focused canvas) -> Focus (full immersion, e.g. the IDE). Depth follows intent.
- **Canvas = one focused artifact** at a time (calm), can split to two only when a task
  needs it.

Aesthetic: "Windows-grand x Claude-refined" — warm palette, coral accent, serif for grand
moments, generous whitespace, native Windows feel. NOT an AI-looking dashboard.

IDE: BOTH engines — Monaco-dressed-as-VS-Code (default, offline) + an optional embedded
real VS Code (openvscode-server) for heavy work.

Packaging: perfect in-browser first, wrap in Tauri (native window, Mica, tray, wake word)
later.

## 5. Roadmap (sequenced: kernel + agent BEFORE dangerous connectors)

- [x] **M0 Foundations** — package skeleton (`backend/veyra/`); CORS locked to localhost
       in the new API; `.venv` on Python 3.14 (FastAPI verified working on 3.14 — no 3.12
       needed). Legacy stdlib server kept runnable during migration.
- [x] **M1 Security Kernel** — DONE + verified (13/13 checks, `backend/tests/test_kernel.py`).
       Tiers, approval gate (real approve/reject, single-use, arg-bound), audit log,
       snapshot/undo, secrets vault (DPAPI active), kill switch, local-only, config
       toggles. Lives in `backend/veyra/kernel/`.
- [~] **M2 Agent Core** — [x] FastAPI backend (`backend/veyra/api/app.py`, port 8788)
       kernel-backed: tools, approvals, audit, snapshots, secrets, config; serves frontend
       same-origin. [x] First tools (`files.*`, 6) registered + tested through the kernel.
       [x] Ollama client bridge. [ ] tool-calling agent loop + streaming (needs installed
       models). [ ] documents/search/memory tools. Tests: `test_api.py` 10/10.
- [~] **M3 UI + IDE** — [x] Full Vite + Svelte 5 frontend (`frontend/`), 12 screens on a
       shared dark command-center design system; served by FastAPI at :8788 (or `npm run
       ui:dev`). Live screens wired to the kernel: Home, Agent chat, Approvals (approve/
       reject), Settings (kill switch, local-only, encrypted secrets), Activity (audit +
       undo), IDE (Monaco editor, file tree, save/delete through the kernel), Documents.
       Preview screens: Payments, Inbox, Social, Automations, Research. [ ] IDE diffs,
       gated terminal/run, generate-to-editor with model.
- [ ] **M4 Studios** — Documents + Academic with docx/pdf export; Research with the
       untrusted-content firewall; deep-research mode.
- [ ] **M5 Dangerous connectors** — Flutterwave (read->stats->webhooks),
       Gmail (read->summarize->draft->gated send), Social (draft->queue->gated publish).
- [ ] **M6 Proactive layer** — scheduler, triggers (time + event), recipes/workflows,
       Daily Briefing, anomaly alerts, unified inbox, calendar, tasks.
- [ ] **M7 Offline voice** — openWakeWord, faster-whisper, Piper TTS, barge-in, personas.
- [ ] **M8 Desktop packaging** — Tauri app, icon, autostart, installer.
- [ ] **M9 Hardening + demo flow** — full end-to-end business-ops run, panic wipe,
       encrypted backups, activity timeline.

---

## 6. Tech decisions

| Area      | Now                 | Target                         | Why |
|-----------|---------------------|--------------------------------|-----|
| Kernel    | (new)               | pure stdlib                    | no deps, runs on 3.14 today |
| Backend   | stdlib http.server  | FastAPI + uvicorn (3.12 venv)  | async, streaming, agent loop |
| Python    | 3.14.5              | pin 3.12 venv at M2            | lib compatibility |
| Frontend  | vanilla innerHTML   | Vite + Svelte                  | state, no flicker |
| Editor    | textarea            | Monaco                         | the IDE is the product |
| Agent     | none                | Ollama tool-calling loop       | the core leap |
| Memory    | sqlite only         | sqlite + sqlite-vec            | RAG recall |
| Desktop   | browser             | Tauri                          | light desktop shell |
| Voice     | browser STT/TTS     | faster-whisper + Piper + oWW   | offline "Hey Veyra" |

Migration is staged: existing working pieces are wrapped, not discarded.

---

## 7. Definition of done (Veyra v1 powerhouse)

Opens as a desktop app; wake-word voice in/out; offline via Ollama; agentic tool-calling;
VS Code-grade IDE; document/academic studios with exports; deep web research; multi-
processor payments; Gmail + unified inbox summarize/draft/gated-send; social
draft/queue/gated-publish; calendar + tasks; proactive daily briefing + anomaly alerts;
recipes/triggers automations; every dangerous action gated by the approval kernel with
full audit + undo; runs reliably after reboot.
