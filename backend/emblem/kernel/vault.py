"""Secrets vault.

API keys and tokens are encrypted at rest with Windows DPAPI (CryptProtectData),
which ties the ciphertext to the current Windows user account -- no master password to
manage and no key material in the repo. Secrets are returned only to backend code that
asks by name; they are never logged, never put in the audit args, and never sent to the
model.

If DPAPI is unavailable (non-Windows), values are stored unprotected and flagged so the
UI can warn. On this target machine (Windows) DPAPI is used.
"""

import base64
import os

from . import db

try:  # Windows DPAPI via ctypes -- standard library only.
    import ctypes
    import ctypes.wintypes as wt

    class _DATA_BLOB(ctypes.Structure):
        _fields_ = [("cbData", wt.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

    _crypt32 = ctypes.windll.crypt32
    _kernel32 = ctypes.windll.kernel32
    _DPAPI = True

    def _to_blob(data: bytes):
        buf = ctypes.create_string_buffer(data, len(data))
        return _DATA_BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char))), buf

    def _from_blob(blob) -> bytes:
        return ctypes.string_at(blob.pbData, blob.cbData)

    def _protect(data: bytes) -> bytes:
        blob_in, _keep = _to_blob(data)
        blob_out = _DATA_BLOB()
        ok = _crypt32.CryptProtectData(
            ctypes.byref(blob_in), u"emblem", None, None, None, 0, ctypes.byref(blob_out))
        if not ok:
            raise OSError("CryptProtectData failed")
        try:
            return _from_blob(blob_out)
        finally:
            _kernel32.LocalFree(blob_out.pbData)

    def _unprotect(data: bytes) -> bytes:
        blob_in, _keep = _to_blob(data)
        blob_out = _DATA_BLOB()
        ok = _crypt32.CryptUnprotectData(
            ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out))
        if not ok:
            raise OSError("CryptUnprotectData failed")
        try:
            return _from_blob(blob_out)
        finally:
            _kernel32.LocalFree(blob_out.pbData)

except Exception:  # pragma: no cover - non-Windows fallback
    _DPAPI = False

    def _protect(data: bytes) -> bytes:
        return data

    def _unprotect(data: bytes) -> bytes:
        return data


def set_secret(name: str, value: str) -> None:
    blob = base64.b64encode(_protect(value.encode("utf-8")))
    db.write(
        """INSERT INTO kernel_secrets (name, value_blob, protected, updated_at)
           VALUES (?, ?, ?, datetime('now'))
           ON CONFLICT(name) DO UPDATE SET
             value_blob = excluded.value_blob,
             protected = excluded.protected,
             updated_at = datetime('now')""",
        (name, blob, 1 if _DPAPI else 0),
    )


def get_secret(name: str):
    row = db.one("SELECT value_blob FROM kernel_secrets WHERE name = ?", (name,))
    if row:
        try:
            return _unprotect(base64.b64decode(row["value_blob"])).decode("utf-8")
        except Exception:
            pass
    # Cloud / cross-platform fallback: an environment variable named like the secret,
    # uppercased (e.g. cerebras_key -> CEREBRAS_KEY). Lets a Linux server supply keys
    # without DPAPI; on Windows the encrypted DB above is used first.
    return os.environ.get(name.upper())


def delete_secret(name: str) -> None:
    db.write("DELETE FROM kernel_secrets WHERE name = ?", (name,))


def list_secrets():
    """Names and metadata only -- never values. Safe to send to the UI."""
    return db.query(
        "SELECT name, protected, created_at, updated_at FROM kernel_secrets ORDER BY name")


def has_secret(name: str) -> bool:
    return db.one("SELECT 1 AS x FROM kernel_secrets WHERE name = ?", (name,)) is not None


def dpapi_available() -> bool:
    return _DPAPI
