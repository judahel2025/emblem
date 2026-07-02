"""Filesystem capability tools.

Each function is registered as a kernel tool with a tier. They are plain functions --
the kernel is what enforces the tier and audits the call. Destructive operations take a
snapshot first so they are always reversible.

Tiers:
  read/list/search  safe     (auto)
  write/move        caution  (auto + notify; snapshot on overwrite)
  delete/overwrite  danger   (approval required; snapshot first)
"""

from ..kernel import Tier, snapshots, tool
from . import fsutil


@tool("files.read", Tier.SAFE, "Read a text file",
      summarize=lambda a: f"Read {a.get('root', 'workspaces')}/{a.get('path')}")
def read(path: str, root: str = "workspaces") -> dict:
    target = fsutil.resolve(root, path)
    if not target.exists():
        return {"ok": False, "error": "File not found.", "path": path}
    return {"ok": True, "root": root, "path": fsutil.relto(root, target),
            "content": target.read_text(encoding="utf-8", errors="replace")}


@tool("files.list", Tier.SAFE, "List files under a root")
def list_files(root: str = "workspaces") -> dict:
    base = fsutil.ROOTS.get(root)
    if base is None:
        return {"ok": False, "error": f"Unknown root '{root}'."}
    items = []
    for p in sorted(base.rglob("*")):
        if p.is_file():
            st = p.stat()
            items.append({"path": p.relative_to(base).as_posix(), "name": p.name,
                          "size": st.st_size, "updated": int(st.st_mtime)})
    return {"ok": True, "root": root, "items": items}


@tool("files.search", Tier.SAFE, "Search file contents under a root")
def search(query: str, root: str = "workspaces", max_results: int = 50) -> dict:
    base = fsutil.ROOTS.get(root)
    if base is None:
        return {"ok": False, "error": f"Unknown root '{root}'."}
    needle = (query or "").lower()
    hits = []
    for p in sorted(base.rglob("*")):
        if not p.is_file():
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        if needle and needle in text.lower():
            idx = text.lower().find(needle)
            snippet = text[max(0, idx - 40): idx + 80].replace("\n", " ")
            hits.append({"path": p.relative_to(base).as_posix(), "snippet": snippet})
            if len(hits) >= max_results:
                break
    return {"ok": True, "root": root, "query": query, "matches": hits}


@tool("files.write", Tier.CAUTION, "Create or update a file",
      summarize=lambda a: f"Write {a.get('root', 'workspaces')}/{a.get('path')}",
      target=lambda a: f"{a.get('root', 'workspaces')}/{a.get('path')}")
def write(path: str, content: str = "", root: str = "workspaces") -> dict:
    target = fsutil.resolve(root, path)
    if target.exists():
        snapshots.snapshot(target, reason="files.write overwrite")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content or "", encoding="utf-8")
    return {"ok": True, "root": root, "path": fsutil.relto(root, target),
            "bytes": len(content or "")}


@tool("files.move", Tier.CAUTION, "Move or rename a file",
      summarize=lambda a: f"Move {a.get('src')} -> {a.get('dst')}")
def move(src: str, dst: str, root: str = "workspaces") -> dict:
    s = fsutil.resolve(root, src)
    d = fsutil.resolve(root, dst)
    if not s.exists():
        return {"ok": False, "error": "Source not found."}
    if d.exists():
        snapshots.snapshot(d, reason="files.move overwrite")
    d.parent.mkdir(parents=True, exist_ok=True)
    s.replace(d)
    return {"ok": True, "from": fsutil.relto(root, s), "to": fsutil.relto(root, d)}


@tool("files.delete", Tier.DANGER, "Delete a file",
      summarize=lambda a: f"Delete {a.get('root', 'workspaces')}/{a.get('path')}",
      target=lambda a: f"{a.get('root', 'workspaces')}/{a.get('path')}")
def delete(path: str, root: str = "workspaces") -> dict:
    target = fsutil.resolve(root, path)
    if not target.exists():
        return {"ok": False, "error": "File not found."}
    snap = snapshots.snapshot(target, reason="files.delete")
    target.unlink()
    return {"ok": True, "deleted": fsutil.relto(root, target), "snapshot_id": snap,
            "note": "Recoverable from Emblem trash via snapshots.restore."}
