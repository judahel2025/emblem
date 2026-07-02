"""Veyra persistent memory — long-term recall across sessions.

Stores facts, preferences, and decisions with embeddings (nomic-embed-text) for semantic
recall, with a keyword fallback when the embedding model isn't available. This is what lets
Veyra remember what you told it days ago, not just the current conversation.
"""

from .store import listing, recall, remember, delete, versions, rollback  # noqa: F401
