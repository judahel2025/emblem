---
name: Data visualization
description: Charts and graphs — bar, line, pie, scatter, histogram — as image files
when_to_use: User asks for a chart, graph, plot, or visualization of data or numbers
outputs: png/svg saved to exports/
tools: files.write, terminal.run; lib matplotlib
dependencies: py -m pip install matplotlib
---

# Data visualization

## Overview
Turn numbers into clear charts: bar, line, pie, scatter, histogram, area, and grouped/
stacked variants — saved as PNG (or SVG) ready to drop into a doc, deck, or post.

## When to use
"Make a chart/graph of…", "plot this data", "visualize my revenue by month",
"show a pie chart of…", "compare X and Y in a bar chart".

## Workflow
1. Get the data (from the user, a file, or a connector) and pick the right chart type:
   - **trend over time** → line; **compare categories** → bar; **parts of a whole** → pie/
     donut; **relationship** → scatter; **distribution** → histogram.
2. Build with `matplotlib` in a script saved under `exports/`: set title, axis labels,
   legend, grid; use a clean palette; `plt.tight_layout()`; `savefig(path, dpi=150)`.
3. Run via `terminal.run`; report the saved image path (it shows on the Files page).

## Output format
- `exports/<slug>.png` (default) or `.svg`.
- Titled, labeled axes, legend when multi-series, readable font sizes, no clutter.

## Chart types covered
Bar (grouped/stacked) · line/area · pie/donut · scatter · histogram · box plot · combo.

## Quality bar
The chart answers a question at a glance; axes and units are labeled; colors are
distinguishable; no chartjunk; high enough DPI to look crisp.

## Dependencies
`py -m pip install matplotlib`.

## Examples
- "Bar chart of revenue by month." → labeled bars, value annotations → `exports/revenue.png`.
- "Pie chart of traffic sources." → donut with percentages and a legend.
