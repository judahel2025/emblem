"""Composio integration — per-user connections and tools, via the Composio v3 REST API.

Every call is scoped to a user_id (Composio's "user"), so each person connects and uses
THEIR OWN Gmail / GitHub / YouTube / Instagram / Calendar / etc. The user_id comes from the
request context (the verified Supabase JWT); pass it explicitly for background work.

We talk to the REST API directly (httpx) rather than the SDK: the endpoints are stable and
verified (auth_configs → connected_accounts/link → tools/execute), while SDK method shapes
have churned across releases. The API key lives in the vault / env only (COMPOSIO_KEY).

Free tier: ~20K tool calls, 60 rpm.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

from ..kernel import context, vault

log = logging.getLogger(__name__)

_BASE = "https://backend.composio.dev/api/v3"

# Curated set surfaced first in the Connections UI (Composio supports 1000+).
FEATURED_TOOLKITS = [
    "gmail", "googlecalendar", "github", "youtube",
    "instagram", "facebook", "linkedin", "twitter", "notion", "slack",
]

# toolkit slug -> auth_config id (process-lifetime cache; auth configs are stable)
_auth_config_cache: dict[str, str] = {}
_toolkits_cache: list[str] = []


def _key() -> str | None:
    return vault.get_secret("composio_key") or os.environ.get("COMPOSIO_KEY")


def configured() -> bool:
    return _key() is not None


def _headers() -> dict:
    return {"x-api-key": _key() or "", "Content-Type": "application/json"}


def _get(path: str, params: dict | None = None) -> dict:
    r = httpx.get(f"{_BASE}{path}", headers=_headers(), params=params or {}, timeout=25)
    r.raise_for_status()
    return r.json()


def _post(path: str, body: dict) -> dict:
    r = httpx.post(f"{_BASE}{path}", headers=_headers(), json=body, timeout=30)
    data = {}
    try:
        data = r.json()
    except Exception:
        pass
    if r.status_code >= 400:
        msg = (data.get("error") or {}).get("message") or f"HTTP {r.status_code}"
        raise RuntimeError(msg)
    return data


def _uid(user_id: str | None) -> str:
    return user_id or context.require_user()


# ---------------------------------------------------------------------------
# Connection lifecycle (per user)
# ---------------------------------------------------------------------------

def _auth_config_for(toolkit: str) -> str | None:
    """Find (or create) the auth config for a toolkit. Composio-managed by default.
    NOTE: Twitter/X requires custom developer credentials configured in the Composio Dashboard.
    """
    slug = toolkit.lower()
    if slug in _auth_config_cache:
        return _auth_config_cache[slug]
    try:
        existing = _get("/auth_configs", {"toolkit_slug": slug, "limit": 10}).get("items", [])
        # Prefer a Composio-managed config; fall back to any (e.g. custom Meta apps).
        pick = next((a for a in existing if a.get("is_composio_managed")), None) or \
               (existing[0] if existing else None)
        if pick:
            _auth_config_cache[slug] = pick["id"]
            return pick["id"]
        created = _post("/auth_configs", {
            "toolkit": {"slug": slug},
            "auth_config": {"type": "use_composio_managed_auth"},
        })
        acid = (created.get("auth_config") or {}).get("id")
        if acid:
            _auth_config_cache[slug] = acid
        return acid
    except Exception as e:
        log.warning("auth_config_for(%s) failed: %s", slug, e)
        return None


def initiate_connection(toolkit: str, user_id: str | None = None) -> str | None:
    """Start hosted OAuth for `toolkit` for this user. Returns the redirect URL."""
    uid = _uid(user_id)
    acid = _auth_config_for(toolkit)
    if not acid:
        return None
    try:
        res = _post("/connected_accounts/link", {"auth_config_id": acid, "user_id": uid})
        return res.get("redirect_url")
    except Exception as e:
        log.warning("initiate_connection(%s) for %s failed: %s", toolkit, uid, e)
        return None


def list_connections(user_id: str | None = None) -> list[str]:
    """Toolkits this user has ACTIVE connections for (lowercased slugs)."""
    uid = _uid(user_id)
    try:
        items = _get("/connected_accounts", {"user_ids": uid, "limit": 100}).get("items", [])
        return sorted({
            str((a.get("toolkit") or {}).get("slug", "")).lower()
            for a in items
            if a.get("status") == "ACTIVE" and (a.get("toolkit") or {}).get("slug")
        })
    except Exception as e:
        log.warning("list_connections for %s failed: %s", uid, e)
        return []


def get_all_app_names() -> list[str]:
    """Every available toolkit slug (featured first). Cached per process."""
    global _toolkits_cache
    if not _toolkits_cache:
        try:
            items = _get("/toolkits", {"limit": 500}).get("items", [])
            _toolkits_cache = [str(t.get("slug", "")).lower() for t in items if t.get("slug")]
        except Exception as e:
            log.info("toolkit list failed: %s", e)
    names = _toolkits_cache
    featured = [t for t in FEATURED_TOOLKITS if not names or t in names]
    rest = sorted(n for n in names if n not in FEATURED_TOOLKITS)
    return featured + rest


# ---------------------------------------------------------------------------
# Tools + execution (per user) — callers route consequential actions through
# the kernel gate (composio_kernel) BEFORE execute() runs.
# ---------------------------------------------------------------------------

_MAX_TOOLS_PER_TOOLKIT = 20   # keep the model's tool list sane
_MAX_TOOLS_TOTAL = 80


def get_user_tools(user_id: str | None = None, toolkits: list[str] | None = None) -> list[dict]:
    """OpenAI-style tool schemas for THIS user's connected apps, for the agent loop."""
    uid = _uid(user_id)
    if not configured():
        return []
    connected = toolkits or list_connections(uid)
    out: list[dict] = []
    for tk in connected:
        if len(out) >= _MAX_TOOLS_TOTAL:
            break
        try:
            items = _get("/tools", {"toolkit_slug": tk, "limit": _MAX_TOOLS_PER_TOOLKIT,
                                    "important": "true"}).get("items", [])
            if not items:  # some toolkits don't tag "important" tools
                items = _get("/tools", {"toolkit_slug": tk,
                                        "limit": _MAX_TOOLS_PER_TOOLKIT}).get("items", [])
        except Exception as e:
            log.info("tools list for %s failed: %s", tk, e)
            continue
        for t in items:
            if len(out) >= _MAX_TOOLS_TOTAL:
                break
            slug = t.get("slug")
            if not slug or t.get("is_deprecated"):
                continue
            out.append({"type": "function", "function": {
                "name": slug,
                "description": (t.get("description") or t.get("name") or slug)[:512],
                "parameters": t.get("input_parameters") or {"type": "object", "properties": {}},
            }})
    return out


def execute(tool_slug: str, params: dict, user_id: str | None = None) -> Any:
    """Execute one Composio tool as this user."""
    uid = _uid(user_id)
    if not configured():
        raise RuntimeError("Connections aren't configured on this server.")
    res = _post(f"/tools/execute/{tool_slug}", {"user_id": uid, "arguments": params or {}})
    if res.get("successful") is False:
        raise RuntimeError(res.get("error") or "The connected app returned an error.")
    return res.get("data", res)


# ---- Backward-compatible shims (old call sites) -----------------------------------
def get_connected_apps() -> list[str]:
    return list_connections()


def execute_action(action_name: str, params: dict, entity_id: str = "default") -> Any:
    return execute(action_name, params, user_id=None if entity_id == "default" else entity_id)
