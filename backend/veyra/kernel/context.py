"""Per-request identity seam.

Multi-user Veyra threads the current user through a contextvar instead of adding a
`user_id` argument to every function. The API auth layer sets it at the start of each
request; the data layer and tools read it to scope reads/writes.

A NULL/empty user_id means "no user bound" — used by the local single-user PC build and
by internal service calls. Tools that are user-scoped should call `require_user()` and
refuse to run consequential actions without one in the cloud.
"""

from __future__ import annotations

import contextvars
import os

# The owner principal for internal / heartbeat work (server-set, unspoofable).
SERVICE_PRINCIPAL = "service"

_current_user: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "veyra_user_id", default=None
)
_current_actor: contextvars.ContextVar[str] = contextvars.ContextVar(
    "veyra_actor", default="user"
)

# When no VEYRA_API_TOKEN / cloud auth is configured we're the local single-user build.
_MULTIUSER = bool(os.environ.get("SUPABASE_JWT_SECRET") or os.environ.get("SUPABASE_URL"))

# The single operator who may see provider/model/secret internals. Everyone else is blind.
_OWNER_USER_ID = os.environ.get("VEYRA_OWNER_USER_ID", "")


def multiuser() -> bool:
    """True when the deployment authenticates real Supabase users."""
    return _MULTIUSER


def set_user(user_id: str | None, actor: str = "user"):
    """Bind the current request's identity. Returns tokens for reset()."""
    return _current_user.set(user_id), _current_actor.set(actor)


def reset(tokens):
    user_tok, actor_tok = tokens
    _current_user.reset(user_tok)
    _current_actor.reset(actor_tok)


def user_id() -> str | None:
    """The bound user, or None for local/service context."""
    return _current_user.get()


def actor() -> str:
    return _current_actor.get()


def is_owner() -> bool:
    """True only for the operator: the local build, the service principal, or the
    configured owner user. Used to hide provider/model/secret internals from everyone
    else so the client (and DevTools) never learns which AI or tools power Veyra."""
    if not _MULTIUSER:
        return True
    if _current_actor.get() == SERVICE_PRINCIPAL:
        return True
    uid = _current_user.get()
    return bool(_OWNER_USER_ID and uid == _OWNER_USER_ID)


def require_user() -> str:
    """Return the bound user_id or raise — for user-scoped tools in the cloud."""
    uid = _current_user.get()
    if not uid:
        if not _MULTIUSER:
            # Local single-user build: use a stable local owner id.
            return "local-owner"
        raise PermissionError("no authenticated user bound to this request")
    return uid
