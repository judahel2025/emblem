---
name: Spreadsheets
description: Excel .xlsx and CSV files with formulas, formatting, and multiple sheets
when_to_use: User asks for a spreadsheet, Excel file, .xlsx, .csv, table of data, tracker, or budget
outputs: xlsx/csv saved to exports/
tools: files.write, terminal.run; lib openpyxl (xlsx), stdlib csv
dependencies: py -m pip install openpyxl
---

# Spreadsheets

## Overview
Create real spreadsheets: budgets, trackers, schedules, data tables, and calculators —
with formulas, formatting, frozen headers, and multiple sheets.

## When to use
"Make a spreadsheet / Excel file for…", "build a budget / tracker / schedule",
"put this data into a table / .xlsx / .csv", "create a calculator for…".

## Workflow
1. Determine columns, rows, any computed fields (totals, %, running balance), and sheet(s).
2. Build with a script saved under `exports/`:
   - **.xlsx** → `openpyxl`: write headers (bold + fill), data rows, formulas as strings
     (`=SUM(B2:B10)`), number/currency formats, column widths, `freeze_panes="A2"`, and
     extra sheets via `wb.create_sheet`.
   - **.csv** → stdlib `csv` for plain tabular data.
3. Run via `terminal.run`; report the saved path.

## Output format
- `exports/<slug>.xlsx` or `.csv`.
- Header row styled and frozen; numeric columns formatted; formulas live (recalc in Excel);
  sensible column widths.

## Quality bar
Opens in Excel/Sheets with formulas intact; headers clear; no merged-cell messiness;
currency/percent formatting correct.

## Dependencies
`py -m pip install openpyxl`.

## Examples
- "Build a monthly budget spreadsheet." → categories, amounts, `=SUM`, totals, % of income.
- "Put these 30 transactions into an Excel file with a total." → formatted table + sum.
