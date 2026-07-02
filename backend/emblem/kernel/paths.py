"""Filesystem locations for the kernel runtime.

The kernel keeps its own state under C:\\EMBLEM\\.emblem so it is separable from the
application database and from user content.
"""

import os
from pathlib import Path

# backend/emblem/kernel/paths.py -> parents[3] == C:\EMBLEM AI
ROOT = Path(__file__).resolve().parents[3]

# A launcher (e.g. the packaged desktop app) can pin a STABLE data location via the
# EMBLEM_BASE env var so the vault, API keys, and database are always found and persist
# regardless of where the code itself runs. Defaults to the repo root (dev behaviour).
BASE = Path(os.environ["EMBLEM_BASE"]).resolve() if os.environ.get("EMBLEM_BASE") else ROOT
EMBLEM_HOME = Path(os.environ["EMBLEM_HOME"]).resolve() if os.environ.get("EMBLEM_HOME") else (BASE / ".emblem")

KERNEL_DB = EMBLEM_HOME / "kernel.db"
TRASH_DIR = EMBLEM_HOME / "trash"

# Application-content folders the kernel is aware of (for snapshots / sandboxing).
WORKSPACES_DIR = BASE / "workspaces"
DOCUMENTS_DIR = BASE / "documents"
DATA_DIR = BASE / "data"
LOGS_DIR = BASE / "logs"

# Emblem's own file home — where she keeps files she creates or is handed. `inbox` is the
# drop folder: the owner drops a file there and tells Emblem to "check my inbox".
EMBLEM_FILES = BASE / "emblem_files"
EMBLEM_INBOX = EMBLEM_FILES / "inbox"
EMBLEM_CREATED = EMBLEM_FILES / "created"
EMBLEM_SAVED = EMBLEM_FILES / "saved"


def ensure_dirs() -> None:
    for folder in (EMBLEM_HOME, TRASH_DIR, WORKSPACES_DIR, DOCUMENTS_DIR, DATA_DIR, LOGS_DIR,
                   EMBLEM_FILES, EMBLEM_INBOX, EMBLEM_CREATED, EMBLEM_SAVED):
        folder.mkdir(parents=True, exist_ok=True)
