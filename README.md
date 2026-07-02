# Emblem

Emblem is a local-first AI command center for Master Judah — voice control, coding, documents,
research, business data, email, scheduling, payments, and social content, all behind a security
kernel (approvals, audit, kill switch, encrypted vault).

The AI brain is online (Cerebras / Claude / OpenAI / Gemini, chosen in **Settings → AI brain**).
Ollama is no longer used.

## First run (dev)

1. Add your AI key in **Settings → AI brain** (Cerebras by default).
2. Start the engine + UI:

```powershell
cd C:\EMBLEM AI
npm run start        # builds the Svelte UI, then serves the API + UI
```

The dashboard opens at `http://127.0.0.1:8788`.

For UI hot-reload while developing:

```powershell
npm run dev          # API engine only (port 8788)
npm run ui:dev       # Vite dev server for the frontend
```

## Desktop app

A native Windows app (Tauri) wraps the UI and launches the engine automatically — see
[desktop/README.md](desktop/README.md). Build the installer from `frontend/` with `npm run tauri build`.

## What Emblem can do

- Voice in/out (with wake word, barge-in, and "stop" to interrupt)
- Full IDE — writes code that auto-saves and is retrievable later
- Documents, charts, spreadsheets (Word / PDF / PowerPoint / Excel)
- Web search + read, business analytics, **full Estoppel database access**
- Email (draft or send, with confirm or full-auto approval)
- Recurring/scheduled tasks (local + cloud) with live countdowns
- Save data to local or cloud; its own file home with a drop **inbox**
- Long-term + conversation memory; logs its own improvement requests
- Approval queue, audit log, snapshots, secrets vault, kill switch
