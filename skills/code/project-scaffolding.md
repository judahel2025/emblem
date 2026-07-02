---
name: Project scaffolding
description: Generate whole project structures, boilerplate, and starter apps
when_to_use: User asks to start/scaffold a project, set up an app, or create a project structure
outputs: a folder tree of files under workspaces/<project>/
tools: files.write, terminal.run; editor
---

# Project scaffolding

## Overview
Stand up a complete, runnable project skeleton — folders, config, entry points, and a
README — under `workspaces/<project>/`, ready to build on.

## When to use
"Start a new … project", "scaffold a … app", "set up a … with …", "create a project
structure for …".

## Workflow
1. Confirm stack and shape: language/framework, app type (CLI / web API / web app / lib),
   package manager, and name. Ask ≤2 questions, then proceed.
2. Create the tree file by file under `workspaces/<project>/`:
   - entry point, source folders, config (`package.json` / `requirements.txt` / etc.),
     `.gitignore`, `README.md` with run instructions, and a minimal working example.
3. Offer to install dependencies and run it (→ `terminal-and-execution`).
4. Keep the first version minimal but actually runnable — no broken imports.

## Output format
- A coherent folder tree saved under `workspaces/`.
- A `README.md` with setup + run commands.

## Stacks covered
Python (CLI, FastAPI, Flask), Node/JS (CLI, Express, Vite), static web (HTML/CSS/JS),
and others on request.

## Quality bar
`npm install && npm run dev` (or the language equivalent) works from a clean checkout; no
placeholder files that break the build; README matches reality.

## Examples
- "Scaffold a FastAPI project." → app/, main.py, requirements.txt, README, runnable.
- "Create a landing page for my course." → index.html + styles + a working hero/CTA.
