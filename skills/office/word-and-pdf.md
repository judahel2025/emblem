---
name: Word and PDF documents
description: Polished .docx and .pdf files with headings, tables of contents, tables, and page numbers
when_to_use: User asks for a Word document, .docx, .pdf, or "make this a proper document/file"
outputs: docx and pdf saved to exports/
tools: files.write, terminal.run; libs python-docx (docx), reportlab or weasyprint (pdf)
dependencies: py -m pip install python-docx reportlab markdown
---

# Word and PDF documents

## Overview
Turn generated Markdown into formatted, shareable office files: `.docx` (Word) and `.pdf`,
with title pages, headings, tables of contents, tables, and page numbers.

## When to use
"Make a Word doc / PDF of this", "export as .docx", "create a PDF proposal/report",
"give me a properly formatted document file".

## Workflow
1. Generate or take the document content as Markdown (use the relevant `documents/*` skill).
2. Confirm format(s) wanted and any branding (title, author, logo).
3. Build the file with a generation script, saved under `exports/`:
   - **.docx** → `python-docx`: map `#`→Heading 1, `##`→Heading 2, paragraphs, bullet/number
     lists, tables; add a title page and `doc.add_page_break()`; set core properties.
   - **.pdf** → `reportlab` (Platypus: `SimpleDocTemplate`, `Paragraph`, `Spacer`, `Table`,
     `TableStyle`, `PageBreak`) or `weasyprint` (render Markdown→HTML→PDF for rich layout).
4. Run the script via `terminal.run`; report the saved path; it appears on the Files page.

## Output format
- Saved to `exports/<slug>.docx` / `exports/<slug>.pdf`.
- Heading hierarchy preserved; tables rendered as real tables; page numbers in the footer;
  consistent fonts and spacing.

## Quality bar
Opens cleanly in Word/Acrobat; no raw Markdown artifacts; headings navigable; tables
aligned; a title page when the document is formal.

## Dependencies
`py -m pip install python-docx reportlab markdown` (install on first use; the skill checks
and prompts if missing). Veyra also has bundled docx/pdf skills it can call.

## Examples
- "Create a PDF proposal from this draft." → reportlab build → `exports/proposal.pdf`.
- "Export my essay as a Word doc." → python-docx with headings + title page → `.docx`.
