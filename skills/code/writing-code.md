---
name: Writing code
description: Generate code in any language straight into the editor, conversationally
when_to_use: User asks to write/build/create code, a function, a script, a component, or a feature
outputs: code files saved to workspaces/, opened in the Code editor
tools: files.write, files.read; editor (Make → Code); chat (coding mode, qwen2.5-coder when installed)
---

# Writing code

## Overview
Produce correct, idiomatic code straight into the **Code editor** — any language — and save
it to `workspaces/`. Veyra works conversationally: it confirms intent, writes, explains
what it did, and asks what's next.

## When to use
"Write a script that…", "build a function/component/endpoint for…", "create a … in
Python/JS/…", "add a feature that…".

## Workflow (conversational, agentic)
1. Restate the goal in one line and confirm: "You want X that does Y — correct?" Ask any
   blocking questions (language, framework, inputs/outputs) — at most 2.
2. Choose the file path under `workspaces/` and the language.
3. Write complete, runnable code — no `# TODO` stubs unless asked. Match the conventions of
   any existing file in context.
4. **Place the code in the editor** (the IDE applies it to the active file/buffer) and save
   via `files.write`.
5. Explain briefly what it does and how to run it; offer to run it (→ `terminal-and-
   execution`) or to write tests.
6. For multi-file work, do it file by file, confirming before large or destructive changes.

## Output format
- A complete file in the editor, saved to `workspaces/<path>`.
- One short explanation block; a "to run: …" line.

## Languages
Python, JavaScript/TypeScript, HTML/CSS, shell/PowerShell, SQL, and others on request.

## Quality bar
Runs as written; handles obvious edge cases and errors; readable names; no dead code; only
the libraries actually needed; matches surrounding style.

## Examples
- "Write a Python script that renames files by date." → complete script in the editor,
  saved, with a "to run: python rename.py" note.
- "Add input validation to this function." → edits the open file, shows the diff intent.
