---
name: Terminal and execution
description: Run commands, install dependencies, run tests, and start servers in the terminal
when_to_use: User asks to run/execute/install/test/start something, or to use the terminal
outputs: command output in the IDE terminal
tools: terminal.run (kernel, caution tier)
---

# Terminal and execution

## Overview
When the task is to **do** something on the machine — run a script, install packages, run
tests, start a server, check versions — Veyra uses the integrated terminal, not the editor.

## When to use
"Run it / run this", "install …", "run the tests", "start the server", "what version of …",
"execute …", anything imperative about the system.

## Workflow
1. Decide the exact command(s). Prefer one clear command; chain with `;` only when needed.
2. Run via `terminal.run` (PowerShell, rooted at `workspaces`). Output streams into the
   IDE terminal panel (Make → Code → Terminal).
3. Read the output: on success, report the key result; on error, read stderr, diagnose, and
   propose or apply a fix (→ `debugging-and-review`), then offer to re-run.
4. For long-running processes (dev servers), say how to stop them.

## Safety
- `terminal.run` is **caution-tier**: every command is logged and the **kill switch** halts
  it, but user-typed/voice-driven commands don't need per-command approval (you're driving).
- Commands the *agent* proposes that are destructive (delete, format, network-changing,
  money) are surfaced for approval first.
- Runs are sandboxed to the workspace folder; no command escapes the kill switch.

## Quality bar
The right command the first time; output is read and acted on, not just dumped; failures
are diagnosed, not ignored.

## Examples
- "Install the requirements." → `pip install -r requirements.txt`, reports success/errors.
- "Run my script." → `python <file>.py`, shows output, fixes errors if any.
- "What Python version is this?" → `python --version` → "Python 3.14.5".
