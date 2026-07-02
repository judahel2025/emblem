"""Capability tools.

Importing a tool module registers its tools against the kernel REGISTRY (via the @tool
decorator). load_all() imports every tool module so the registry is fully populated; the
API/agent call it once at startup.
"""

import importlib
import os

# Add new tool modules here as they are built (documents, web, email, ...).
_TOOL_MODULES = [
    "veyra.tools.files",
    "veyra.tools.system",
    "veyra.tools.notes",
    "veyra.tools.web",
    "veyra.tools.docs",
    "veyra.tools.charts",
    "veyra.tools.sheets",
    "veyra.tools.docread",
    "veyra.tools.analyze",
    "veyra.tools.code",
    "veyra.tools.schedule",
    "veyra.tools.improve",
    "veyra.tools.emails",
    "veyra.tools.pages",
    "veyra.tools.calendar",
    "veyra.tools.automations",
    "veyra.connectors.flutterwave",
    "veyra.connectors.quaniac",
    "veyra.connectors.estoppel",
    "veyra.connectors.estoppel_mail",
    "veyra.connectors.resend_mail",
    "veyra.connectors.analytics",
    "veyra.connectors.briefing",
    "veyra.connectors.cloud_memory",
    "veyra.connectors.cloud_files",
    "veyra.connectors.monitor",
    "veyra.connectors.reports",
    "veyra.connectors.composio_kernel",
]


def load_all() -> int:
    # In the cloud, the "operate my PC" tools (shell/terminal + local filesystem) make no
    # sense and would be unsafe on a shared server, so we don't register them there.
    cloud = os.environ.get("VEYRA_CLOUD") == "1"
    skip = {"veyra.tools.system", "veyra.tools.files"} if cloud else set()
    for name in _TOOL_MODULES:
        if name in skip:
            continue
        importlib.import_module(name)
    from ..kernel import REGISTRY
    return len(REGISTRY.all())
