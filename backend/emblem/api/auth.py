"""Supabase JWT auth for the multi-user cloud build.

Two ways to be authorized:
  1. A real user: `Authorization: Bearer <supabase access token>` — verified against the
     project's JWT secret (HS256). Yields their auth.users id as the user_id.
  2. The service principal: `Authorization: Bearer <EMBLEM_API_TOKEN>` — the server-set token
     used by the heartbeat/scheduler and admin calls. Cannot be spoofed by request input.

On the local PC build (no SUPABASE_JWT_SECRET, no EMBLEM_API_TOKEN) everything is open and the
user resolves to the local owner, exactly as before.

This module is intentionally dependency-light: HS256 verification uses stdlib hmac so we don't
pull PyJWT into the slim cloud image. Supabase issues HS256 access tokens signed with the
project's JWT secret by default.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time

from ..kernel import context

_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET", "")
_SERVICE_TOKEN = os.environ.get("EMBLEM_API_TOKEN", "")
_SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "") or os.environ.get("EMBLEM_SUPABASE_ANON", "")

# Paths that never require auth.
_PUBLIC = {"/api/health"}

# Cache verified tokens briefly so we don't introspect on every request.
_verify_cache: dict[str, tuple[float, str]] = {}   # token -> (expiry_epoch, user_id)
_CACHE_TTL = 300


def _introspect(token: str) -> str | None:
    """Verify a Supabase access token by asking Supabase who it belongs to.

    Works regardless of the project's JWT signing scheme (legacy HS256 or the newer
    asymmetric keys) because we don't verify the signature locally — Supabase does.
    Returns the user id (sub) or None.
    """
    if not (_SUPABASE_URL and _ANON_KEY):
        return None
    now = time.time()
    cached = _verify_cache.get(token)
    if cached and cached[0] > now:
        return cached[1]
    try:
        import httpx
        r = httpx.get(f"{_SUPABASE_URL}/auth/v1/user",
                      headers={"Authorization": f"Bearer {token}", "apikey": _ANON_KEY},
                      timeout=6)
        if r.status_code == 200:
            uid = r.json().get("id")
            if uid:
                _verify_cache[token] = (now + _CACHE_TTL, uid)
                return uid
    except Exception:
        pass
    return None


def _b64url_decode(seg: str) -> bytes:
    pad = "=" * (-len(seg) % 4)
    return base64.urlsafe_b64decode(seg + pad)


def _verify_supabase_jwt(token: str) -> dict | None:
    """Return the token claims if the signature + expiry are valid, else None."""
    if not _JWT_SECRET:
        return None
    try:
        header_b64, payload_b64, sig_b64 = token.split(".")
    except ValueError:
        return None
    signing_input = f"{header_b64}.{payload_b64}".encode()
    expected = hmac.new(_JWT_SECRET.encode(), signing_input, hashlib.sha256).digest()
    try:
        got = _b64url_decode(sig_b64)
    except Exception:
        return None
    if not hmac.compare_digest(expected, got):
        return None
    try:
        claims = json.loads(_b64url_decode(payload_b64))
    except Exception:
        return None
    if claims.get("exp") and time.time() > float(claims["exp"]):
        return None
    return claims


def resolve_identity(auth_header: str) -> tuple[str | None, str] | None:
    """Map an Authorization header to (user_id, actor).

    Returns None when auth is required but the header is missing/invalid.
    Returns (user_id, actor) on success. On the local build returns the local owner.
    """
    # Local single-user build: no cloud auth configured at all.
    if not _JWT_SECRET and not _SERVICE_TOKEN and not _SUPABASE_URL:
        return ("local-owner", "user")

    token = ""
    if auth_header.lower().startswith("bearer "):
        token = auth_header[7:].strip()
    if not token:
        return None

    # Service principal (heartbeat / admin) — server-set, unspoofable.
    if _SERVICE_TOKEN and hmac.compare_digest(token, _SERVICE_TOKEN):
        return (context.SERVICE_PRINCIPAL, context.SERVICE_PRINCIPAL)

    # Fast path: local HS256 verification when the JWT secret is configured.
    if _JWT_SECRET:
        claims = _verify_supabase_jwt(token)
        if claims and claims.get("sub"):
            return (claims["sub"], "user")

    # Universal path: ask Supabase to verify the token (any signing scheme).
    uid = _introspect(token)
    if uid:
        return (uid, "user")

    return None


def is_public(path: str) -> bool:
    return path in _PUBLIC or not path.startswith("/api")
