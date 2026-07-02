"""Charts & graphs — render real PNG images into the documents folder so they show in
Files and open in any image viewer. Uses matplotlib (Agg backend, no display needed).
"""

import time

from ..kernel import Tier, tool
from . import fsutil


def _slug(t):
    s = "".join(c.lower() if c.isalnum() else "-" for c in (t or "chart"))
    while "--" in s:
        s = s.replace("--", "-")
    return s.strip("-") or "chart"


@tool("charts.make", Tier.CAUTION, "Render a chart/graph as a PNG image",
      summarize=lambda a: f"Chart: {a.get('title', 'chart')} ({a.get('kind', 'bar')})",
      target=lambda a: f"documents/{a.get('title', 'chart')}.png")
def make_chart(kind="bar", title="Chart", labels=None, values=None, xlabel="", ylabel=""):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    labels = labels or []
    values = [float(v) for v in (values or [])]
    if not values:
        return {"ok": False, "error": "No data values to plot."}

    fig, ax = plt.subplots(figsize=(8, 4.6), dpi=130)
    kind = (kind or "bar").lower()
    color = "#d8693f"
    if kind == "line":
        ax.plot(labels or range(len(values)), values, marker="o", color=color, linewidth=2)
    elif kind == "pie":
        ax.pie(values, labels=labels or None, autopct="%1.0f%%",
               colors=["#d8693f", "#e3a008", "#2d9e75", "#378add", "#8b5cf6", "#e0584e"])
    elif kind == "scatter":
        ax.scatter(labels or range(len(values)), values, color=color)
    else:  # bar
        ax.bar(labels or [str(i) for i in range(len(values))], values, color=color)
    if kind != "pie":
        ax.set_xlabel(xlabel); ax.set_ylabel(ylabel)
        ax.grid(True, axis="y", alpha=0.2)
    ax.set_title(title)
    fig.tight_layout()

    name = f"{_slug(title)}-{int(time.time())}.png"
    target = fsutil.resolve("documents", name)
    fig.savefig(str(target))
    plt.close(fig)
    return {"ok": True, "root": "documents", "path": name}
