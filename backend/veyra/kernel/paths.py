"""Filesystem locations for the kernel runtime.

The kernel keeps its own state under C:\\VEYRA\\.veyra so it is separable from the
application database and from user content.
"""

import os
from pathlib import Path

# backend/veyra/kernel/paths.py -> parents[3] == C:\VEYRA
ROOT = Path(__file__).resolve().parents[3]

# A launcher (e.g. the packaged desktop app) can pin a STABLE data location via the
# VEYRA_BASE env var so the vault, API keys, and database are always found and persist
# regardless of where the code itself runs. Defaults to the repo root (dev behaviour).
BASE = Path(os.environ["VEYRA_BASE"]).resolve() if os.environ.get("VEYRA_BASE") else ROOT
VEYRA_HOME = Path(os.environ["VEYRA_HOME"]).resolve() if os.environ.get("VEYRA_HOME") else (BASE / ".veyra")

KERNEL_DB = VEYRA_HOME / "kernel.db"
TRASH_DIR = VEYRA_HOME / "trash"

# Application-content folders the kernel is aware of (for snapshots / sandboxing).
WORKSPACES_DIR = BASE / "workspaces"
DOCUMENTS_DIR = BASE / "documents"
DATA_DIR = BASE / "data"
LOGS_DIR = BASE / "logs"

# Veyra's own file home — where she keeps files she creates or is handed. `inbox` is the
# drop folder: Master Judah puts a file there and tells Veyra to "check my inbox".
VEYRA_FILES = BASE / "veyra_files"
VEYRA_INBOX = VEYRA_FILES / "inbox"
VEYRA_CREATED = VEYRA_FILES / "created"
VEYRA_SAVED = VEYRA_FILES / "saved"


def ensure_dirs() -> None:
    for folder in (VEYRA_HOME, TRASH_DIR, WORKSPACES_DIR, DOCUMENTS_DIR, DATA_DIR, LOGS_DIR,
                   VEYRA_FILES, VEYRA_INBOX, VEYRA_CREATED, VEYRA_SAVED):
        folder.mkdir(parents=True, exist_ok=True)
