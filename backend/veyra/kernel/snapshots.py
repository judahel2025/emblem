"""Reversibility: snapshot a file before it is overwritten or deleted.

Tools that mutate or remove files call snapshot(path) first. The kernel can later
restore any snapshot, so no destructive file action is truly irreversible.
"""

import shutil
from pathlib import Path

from . import db, paths


def snapshot(path, reason: str = "") -> int | None:
    """Copy the current contents of path into the trash. Returns a snapshot id, or None
    if the file does not exist (nothing to preserve)."""
    src = Path(path)
    if not src.exists() or not src.is_file():
        return None
    paths.ensure_dirs()
    snap_id = db.write(
        "INSERT INTO kernel_snapshots (original_path, snapshot_path, reason) VALUES (?, ?, ?)",
        (str(src), "", reason),
    )
    dest = paths.TRASH_DIR / f"{snap_id}__{src.name}"
    shutil.copy2(src, dest)
    db.write("UPDATE kernel_snapshots SET snapshot_path = ? WHERE id = ?", (str(dest), snap_id))
    return snap_id


def restore(snapshot_id: int) -> bool:
    row = db.one("SELECT * FROM kernel_snapshots WHERE id = ?", (snapshot_id,))
    if not row:
        return False
    snap = Path(row["snapshot_path"])
    if not snap.exists():
        return False
    dest = Path(row["original_path"])
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(snap, dest)
    db.write("UPDATE kernel_snapshots SET restored = 1 WHERE id = ?", (snapshot_id,))
    return True


def recent(limit: int = 100):
    return db.query(
        """SELECT id, original_path, reason, restored, created_at
           FROM kernel_snapshots ORDER BY id DESC LIMIT ?""",
        (limit,),
    )
