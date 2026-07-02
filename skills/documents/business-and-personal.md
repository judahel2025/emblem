---
name: Business and personal documents
description: Formal letters, business plans, resumes/CVs, cover letters, and memos
when_to_use: User asks for a letter, business plan, resume, CV, cover letter, memo, or agreement draft
outputs: md (saved to documents/), optionally docx/pdf
tools: chat, files.write
---

# Business and personal documents

## Overview
Practical documents people send and rely on: formal letters, business plans, resumes/CVs,
cover letters, memos, and simple agreement drafts.

## When to use
"Write a formal letter to…", "draft a business plan for…", "make / improve my resume",
"write a cover letter for…", "draft a memo about…".

## Workflow
1. Gather the specifics the document needs (recipient, purpose, key facts, your details).
   Ask only for what's missing; proceed with sensible placeholders marked `[like this]`.
2. Use the correct template for the type (see below).
3. Keep tone appropriate: formal letters are concise and courteous; resumes are
   achievement-led and quantified; business plans are realistic, not hype.
4. Save to `documents/<slug>.md`; offer `.docx`/`.pdf` (resumes/letters usually want docx).

## Document templates covered
- **Formal letter**: sender block → date → recipient → salutation → body → close → signature.
- **Business plan**: summary → problem → solution → market → model → go-to-market →
  financials → milestones → team.
- **Resume / CV**: header → summary → experience (impact bullets with metrics) → skills →
  education → projects.
- **Cover letter**: hook → fit → proof → close.
- **Memo**: To/From/Date/Re → purpose → details → action.

## Quality bar
Correct format for the type; specific and truthful (no invented credentials); placeholders
clearly marked; ready to send or export with minimal edits.

## Examples
- "Draft a cover letter for a backend role." → tailored hook + 2 proof points + close.
- "Build a business plan for my course platform." → full plan with realistic financials
  flagged as estimates.
