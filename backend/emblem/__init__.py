"""Emblem powerhouse package.

Layers (see docs/EMBLEM_POWERHOUSE_FRAMEWORK.md):
  kernel      security kernel (pure stdlib) -- the foundation
  tools       capability tools (registered against the kernel)
  agent       agent loop, model router, planner
  connectors  external accounts (gmail, calendar, social, ...)
  api         web layer (FastAPI at M2; stdlib bridge until then)
  memory      vector store + RAG
"""

__version__ = "0.2.0"
