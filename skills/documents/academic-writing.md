---
name: Academic writing
description: Essays, theses, research summaries, study notes, and citation formatting
when_to_use: User asks for an essay, paper, thesis, literature review, study notes, outline, or citations
outputs: md (saved to documents/), optionally docx/pdf via office/word-and-pdf
tools: chat (academic mode), files.write
---

# Academic writing

## Overview
Produce rigorous, well-structured academic work: essays, research papers, thesis
statements, literature reviews, study notes, outlines, and correctly formatted citations.

## When to use
"Write an essay/paper on…", "draft a thesis statement", "summarize this research",
"make study notes / flashcards on…", "outline an argument about…", "format these citations".

## Workflow
1. Clarify only what's essential and not already given: topic, level (high-school / under-
   grad / grad), length, citation style (APA / MLA / Chicago / IEEE), and whether sources
   are required. Ask at most 2–3 questions, then proceed.
2. If verifiable sources are required, run `research/web-research` first — never invent
   references or pass unsourced claims as verified.
3. Structure: title → thesis → introduction → body (one idea per section, evidence +
   analysis) → counterpoint where relevant → conclusion → references.
4. Write in a clear, formal, precise academic voice. No filler, no inflated language.
5. Save as Markdown to `documents/<slug>.md`. Offer `.docx`/`.pdf` export.

## Output format
- Markdown with `#`/`##` headings, numbered/bulleted lists where useful.
- A `## References` section in the requested citation style.
- If sources were needed but unavailable, add a short `## Sources needed` note — do not
  fabricate citations.

## Document types covered
Essay · research paper · thesis statement · literature review · annotated bibliography ·
study notes · flashcards (Q/A pairs) · revision summary · argument outline · abstract.

## Quality bar
Argument is coherent and evidenced; claims are accurate; citations are real and correctly
formatted; tone matches the academic level; length is honored without padding.

## Examples
- "Write a 1,500-word undergrad essay on climate finance, APA, with sources." → research,
  then a structured essay with real APA references, saved to `documents/`.
- "Make study notes on the Krebs cycle." → concise headed notes + 8 Q/A flashcards.
