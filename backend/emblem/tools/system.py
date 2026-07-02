"""System capability tools (desktop integration).

Kept narrow and kernel-gated. Opening an editor is low-harm (caution), but it still runs
through the kernel so it is logged and obeys the kill switch / local-only flags.
"""

import os
import shutil
import subprocess

from ..kernel import Tier, tool
from . import fsutil


@tool("system.open_file", Tier.CAUTION, "Open a file with its default local app",
      summarize=lambda a: f"Open {a.get('root', 'documents')}/{a.get('path', '')} in its app")
def open_file(path: str = "", root: str = "documents") -> dict:
    try:
        target = fsutil.resolve(root, path)
        if not target.exists():
            return {"ok": False, "error": "File not found."}
        os.startfile(str(target))  # Windows: opens with the associated app
        return {"ok": True, "opened": str(target)}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@tool("terminal.run", Tier.CAUTION, "Run a command in the workspace terminal",
      summarize=lambda a: f"terminal: {a.get('command', '')[:70]}")
def terminal_run(command: str = "", cwd: str = "workspaces") -> dict:
    """User-driven integrated terminal. Runs one command in PowerShell rooted at a known
    folder. Caution-tier: logged and halted by the kill switch, but not per-command gated
    (the human is typing it). The agent calling shell commands stays danger-tier elsewhere.
    """
    base = fsutil.ROOTS.get(cwd) or fsutil.ROOTS["workspaces"]
    if not (command or "").strip():
        return {"ok": False, "error": "Empty command."}
    try:
        p = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", command],
            cwd=str(base), capture_output=True, text=True, timeout=90,
        )
        return {"ok": True, "stdout": p.stdout, "stderr": p.stderr, "code": p.returncode, "cwd": cwd}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "Command timed out (90s)."}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@tool("system.open_vscode", Tier.CAUTION, "Open a file or folder in VS Code",
      summarize=lambda a: f"Open {a.get('root', 'workspaces')}/{a.get('path', '')} in VS Code")
def open_vscode(path: str = "", root: str = "workspaces") -> dict:
    code = shutil.which("code") or shutil.which("code.cmd")
    if not code:
        return {"ok": False, "error": "VS Code CLI 'code' is not on PATH. Install VS Code and enable 'code' in PATH."}
    base = fsutil.ROOTS.get(root)
    if base is None:
        return {"ok": False, "error": f"Unknown root '{root}'."}
    target = fsutil.resolve(root, path) if path else base
    try:
        subprocess.Popen([code, str(target)], shell=False)
    except Exception:
        subprocess.Popen(f'"{code}" "{target}"', shell=True)
    return {"ok": True, "opened": str(target)}
