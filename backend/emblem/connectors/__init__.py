"""External account connectors. Each stores its credentials in the encrypted vault and
exposes kernel tools. Read operations are safe; sending/refunding is danger-tier (gated).

Composio powers per-user app connections (Gmail, GitHub, socials).
gmail / social — scaffolding; live data needs OAuth setup (next).
"""
