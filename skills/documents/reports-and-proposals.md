---
name: Reports and proposals
description: Business and technical reports, proposals, and executive summaries
when_to_use: User asks for a report, proposal, brief, white paper, or executive summary
outputs: md (saved to documents/), optionally docx/pdf
tools: chat, files.write
---

# Reports and proposals

## Overview
Decision-ready business and technical documents: reports, proposals, briefs, white papers,
and executive summaries that lead with the point and back it with structure.

## When to use
"Write a proposal for…", "draft a report on…", "make an executive summary of…",
"prepare a business brief / white paper about…".

## Workflow
1. Clarify: audience (exec / team / client), goal (inform / persuade / request approval),
   length, and any data/context to include. Ask ≤3 questions, then proceed.
2. Lead with an **executive summary** (the answer first), then supporting sections.
3. Use clear section headers, short paragraphs, bullet lists for scannability, and a table
   for any comparison or numbers.
4. Proposals follow: problem → proposed solution → scope/deliverables → timeline → cost →
   risks → call to action.
5. Save to `documents/<slug>.md`; offer `.docx`/`.pdf`.

## Output format
- `# Title`, `## Executive summary`, then sections.
- Tables in Markdown for figures/comparisons.
- A `## Next steps` or `## Recommendation` close.

## Document types covered
Business report · technical report · project proposal · grant/funding proposal · executive
summary · status/progress report · white paper · one-page brief.

## Quality bar
The reader gets the point in the first paragraph; structure is skimmable; numbers are
labeled and consistent; the ask (if any) is explicit and easy to approve.

## Examples
- "Write a proposal for a 6-week paid cohort." → problem→solution→scope→timeline→price→CTA.
- "Generate a Flutterwave payment summary report." → exec summary + tables of revenue,
  successful/failed counts, top customers (pulls real data once the connector is live).
