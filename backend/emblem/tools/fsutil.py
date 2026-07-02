"""Path safety for filesystem tools.

Tools may only touch files under a known set of roots. Any attempt to escape (via .., an
absolute path, or a drive-relative path) raises. This is the same guarantee the legacy
server's safe_child gave, centralised so every tool inherits it.
"""

from pathlib import Path

from ..kernel import paths

# Logical root name -> real directory. Tools address files as (root, relative).
ROOTS = {
    "workspaces": paths.WORKSPACES_DIR,
    "documents": paths.DOCUMENTS_DIR,
    "exports": paths.ROOT / "exports",
    "logs": paths.LOGS_DIR,
    "emblem": paths.EMBLEM_FILES,   # Emblem's own file home (inbox/ created/ saved/)
}


def resolve(root: str, relative: str) -> Path:
    base = ROOTS.get(root)
    if base is None:
        raise ValueError(f"Unknown root '{root}'. Allowed: {', '.join(ROOTS)}.")
    base = base.resolve()
    clean = (relative or "").replace("\\", "/").strip("/")
    if not clean:
        raise ValueError("A file path is required.")
    target = (base / clean).resolve()
    if target != base and base not in target.parents:
        raise ValueError("That path is outside Emblem's allowed folders.")
    return target


def relto(root: str, target: Path) -> str:
    return target.relative_to(ROOTS[root].resolve()).as_posix()
