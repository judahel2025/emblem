"""Capability tools.

Importing a tool module registers its tools against the kernel REGISTRY (via the @tool
decorator). load_all() imports every tool module so the registry is fully populated; the
API/agent call it once at startup.
"""

import importlib
import os

# Add new tool modules here as they are built (documents, web, email, ...).
_TOOL_MODULES = [
    "emblem.tools.files",
    "emblem.tools.system",
    "emblem.tools.notes",
    "emblem.tools.web",
    "emblem.tools.docs",
    "emblem.tools.charts",
    "emblem.tools.sheets",
    "emblem.tools.docread",
    "emblem.tools.analyze",
    "emblem.tools.code",
    "emblem.tools.schedule",
    "emblem.tools.improve",
    "emblem.tools.emails",
    "emblem.tools.pages",
    "emblem.tools.calendar",
    "emblem.tools.automations",
    "emblem.connectors.resend_mail",
    "emblem.connectors.cloud_memory",
    "emblem.connectors.cloud_files",
    "emblem.connectors.composio_kernel",
]


def load_all() -> int:
    # In the cloud, the "operate my PC" tools (shell/terminal + local filesystem) make no
    # sense and would be unsafe on a shared server, so we don't register them there.
    cloud = os.environ.get("EMBLEM_CLOUD") == "1"
    skip = {"emblem.tools.system", "emblem.tools.files"} if cloud else set()
    for name in _TOOL_MODULES:
        if name in skip:
            continue
        importlib.import_module(name)
    from ..kernel import REGISTRY
    return len(REGISTRY.all())
