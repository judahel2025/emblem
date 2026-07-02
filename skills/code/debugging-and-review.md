---
name: Debugging and code review
description: Find and fix bugs, refactor, explain code, and run security/quality reviews
when_to_use: User reports an error, asks to fix/debug/refactor/explain code, or wants a review
outputs: edited files in workspaces/, an explanation, or a review report
tools: files.read, files.write, terminal.run; editor; chat (coding mode)
---

# Debugging and code review

## Overview
Diagnose and fix problems in existing code, refactor for clarity/reliability, explain how
code works, and review for bugs, security, and quality.

## When to use
"Fix this error: …", "why doesn't this work", "debug …", "refactor this", "explain this
file", "review this code", "is this secure?".

## Workflow
- **Debug**: read the error + relevant file(s); form a hypothesis about root cause; explain
  it plainly; apply the minimal fix in the editor; offer to run it to confirm (`terminal-
  and-execution`). Don't shotgun-change unrelated code.
- **Refactor**: preserve behavior; improve names, structure, and error handling; note what
  changed and why. Save; suggest running tests.
- **Explain**: summarize purpose, then walk the key parts; call out anything risky.
- **Review**: report findings as Severity · Location · Issue · Fix. Cover correctness,
  edge cases, error handling, security (injection, secrets, auth), and clarity.

## Output format
- For fixes/refactors: the edited file + a short "what changed" note.
- For reviews: a list of findings, highest severity first, each with a concrete fix.

## Quality bar
Fixes the actual root cause, not the symptom; changes are minimal and explained; reviews
are specific and actionable, never vague.

## Examples
- "Fix this JavaScript error." → identifies cause, edits the file, offers to re-run.
- "Review server.py for security." → findings on input handling, secrets, and auth, ranked.
