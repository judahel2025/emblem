"""Kernel-registered gateway for Composio tools.

The agent never calls Composio directly. Instead it calls one of two kernel tools, so
every external action passes the same tier gate, approval binding, and audit trail as
native tools:

  * composio.read  (Tier.SAFE)   — read-only lookups (list/get/search/fetch), run freely.
  * composio.act   (Tier.DANGER) — anything that sends/posts/creates/deletes/updates —
                                    requires the user's explicit approval before it runs.

Both execute as the CURRENT request user (from context), so people only ever touch their
own connected accounts.
"""

from __future__ import annotations

from ..kernel.permissions import Tier, tool
from . import composio_tools

# Slug fragments that mean "this only reads" — everything else is treated as consequential.
_READ_HINTS = ("GET_", "_GET", "LIST", "FETCH", "SEARCH", "READ", "FIND", "RETRIEVE",
               "_INFO", "PROFILE", "STATS", "COUNT", "CHECK")


def is_read_only(slug: str) -> bool:
    s = (slug or "").upper()
    return any(h in s for h in _READ_HINTS)


@tool("composio.read", Tier.SAFE, "Read from a connected app (Gmail, Calendar, GitHub, socials).",
      network=True,
      summarize=lambda a: f"Read via {a.get('slug', '?')}",
      target=lambda a: a.get("slug", ""))
def composio_read(slug: str, params: dict | None = None):
    return {"ok": True, "result": composio_tools.execute(slug, params or {})}


@tool("composio.act", Tier.DANGER, "Take an action in a connected app (send, post, create, delete).",
      network=True,
      summarize=lambda a: f"Act via {a.get('slug', '?')}",
      target=lambda a: a.get("slug", ""))
def composio_act(slug: str, params: dict | None = None):
    return {"ok": True, "result": composio_tools.execute(slug, params or {})}
