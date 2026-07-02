"""Data router for SHARED content tables (notes, emails, code, conversations, improvements,
alerts). Drop-in replacement for `db`: tools that import `data as db` automatically read/write
the shared Postgres store when it's configured (so all devices sync), and fall back to the
local SQLite DB only on transient network/connection failures.

IMPORTANT: the fallback is NOT silent for permission errors, syntax errors, or constraint
violations — those propagate as real exceptions. Only genuine connection failures (timeout,
socket dropped, driver unavailable) fall back to local SQLite.
"""

from . import db, store


def _is_transient(exc: Exception) -> bool:
    """True only for network/connectivity failures — safe to fall back to SQLite.

    False for permission denied, bad SQL, constraint violations — those should
    surface as real errors, not silently route writes to the wrong database.
    """
    if isinstance(exc, (ImportError, ModuleNotFoundError)):
        return True  # psycopg not installed
    try:
        import psycopg
        # OperationalError = network/connection level (class 08xxx)
        # InterfaceError   = driver-level connection state (connection closed, etc.)
        return isinstance(exc, (psycopg.OperationalError, psycopg.InterfaceError))
    except ImportError:
        return True


def query(sql, params=()):
    if store.enabled():
        try:
            return store.query(sql, params)
        except Exception as exc:
            if not _is_transient(exc):
                raise
    return db.query(sql, params)


def one(sql, params=()):
    if store.enabled():
        try:
            return store.one(sql, params)
        except Exception as exc:
            if not _is_transient(exc):
                raise
    return db.one(sql, params)


def write(sql, params=()):
    if store.enabled():
        try:
            return store.write(sql, params)
        except Exception as exc:
            if not _is_transient(exc):
                raise
    return db.write(sql, params)
