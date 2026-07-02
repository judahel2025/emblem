# Local Core Sprint Status

## Completed

- Rebuilt Emblem into a multi-section command center.
- Added navigation for:
  - Home
  - Voice
  - Chat
  - Custom IDE
  - Documents
  - Academic
  - Research
  - Payments
  - Gmail
  - Social
  - Approvals
  - Settings
  - Logs
- Preserved typed chat and voice command flow.
- Added local workspace file APIs.
- Added local document APIs.
- Added SQLite storage at `C:\EMBLEM AI\data\emblem.db`.
- Added command history table.
- Added approval queue table.
- Added logs table.
- Added local folders:
  - `C:\EMBLEM AI\workspaces`
  - `C:\EMBLEM AI\documents`
  - `C:\EMBLEM AI\data`
  - `C:\EMBLEM AI\logs`
  - `C:\EMBLEM AI\exports`
- Added Custom IDE v1:
  - file list
  - file path field
  - editor area
  - save file
  - generate code through Ollama when models are installed
- Added Document Studio v1:
  - document list
  - document path field
  - document type/topic/tone/length/notes
  - Markdown editor
  - save document
  - generate document through Ollama when models are installed
- Added Academic Studio v1 using the document generator.
- Added approval queue view.
- Added logs and command history view.

## Verified

- Backend health endpoint works.
- Ollama is reachable.
- Workspace file save works.
- Document save works.
- Approval creation works.
- Dashboard loads in browser.
- No browser console errors found during verification.

## Current Limitation

Ollama is installed and reachable, but no local models are installed yet.

Install at least one model before testing AI generation:

```powershell
ollama pull llama3.2:3b
ollama pull qwen2.5-coder:7b
ollama pull qwen2.5:7b
```

## Start Command

```powershell
cd C:\EMBLEM AI
npm run dev
```

Open:

```text
http://127.0.0.1:8787
```

