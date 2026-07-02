"""Permission tiers and the tool registry.

A tool is any callable the agent can invoke. Every tool declares a tier; the kernel
enforces the tier before the tool runs. This module holds no policy beyond the tier
definitions and a registry -- enforcement lives in kernel.py.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Dict, List, Optional

from .errors import UnknownTool


class Tier(str, Enum):
    SAFE = "safe"            # auto-run
    CAUTION = "caution"      # auto-run, logged + user notified
    DANGER = "danger"        # requires explicit approval
    FORBIDDEN = "forbidden"  # blocked unless explicitly enabled in settings

    @property
    def rank(self) -> int:
        return {"safe": 0, "caution": 1, "danger": 2, "forbidden": 3}[self.value]


# Sensible default risk wording per tier, used when a tool does not specify its own.
_DEFAULT_RISK = {Tier.DANGER: "high", Tier.FORBIDDEN: "critical"}


@dataclass
class ToolSpec:
    name: str
    tier: Tier
    handler: Callable[..., object]
    description: str = ""
    network: bool = False           # touches the internet / external accounts
    risk: str = ""                  # human label shown in approvals
    summarize: Optional[Callable[[dict], str]] = None  # args -> one-line summary
    target: Optional[Callable[[dict], str]] = None     # args -> affected target
    schema: dict = field(default_factory=dict)         # JSON schema for the model

    def __post_init__(self):
        if not self.risk:
            self.risk = _DEFAULT_RISK.get(self.tier, "low")

    def summary_for(self, args: dict) -> str:
        if self.summarize:
            try:
                return self.summarize(args)
            except Exception:
                pass
        return self.description or self.name

    def target_for(self, args: dict) -> str:
        if self.target:
            try:
                return self.target(args)
            except Exception:
                pass
        return ""


class ToolRegistry:
    def __init__(self):
        self._tools: Dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec) -> ToolSpec:
        if spec.name in self._tools:
            raise ValueError(f"Tool '{spec.name}' is already registered.")
        self._tools[spec.name] = spec
        return spec

    def get(self, name: str) -> ToolSpec:
        spec = self._tools.get(name)
        if spec is None:
            raise UnknownTool(f"No tool named '{name}'.")
        return spec

    def has(self, name: str) -> bool:
        return name in self._tools

    def all(self) -> List[ToolSpec]:
        return sorted(self._tools.values(), key=lambda s: (s.tier.rank, s.name))

    def manifest(self) -> List[dict]:
        """Model-facing description of available tools."""
        return [
            {
                "name": s.name,
                "tier": s.tier.value,
                "description": s.description,
                "network": s.network,
                "schema": s.schema,
            }
            for s in self.all()
        ]


# Global registry that the @tool decorator writes into. The kernel reads from it.
REGISTRY = ToolRegistry()


def tool(name, tier: Tier, description="", *, network=False, risk="",
         summarize=None, target=None, schema=None):
    """Decorator: register a function as a kernel tool.

    @tool("files.delete", Tier.DANGER, "Delete a file",
          summarize=lambda a: f"Delete {a['path']}", target=lambda a: a["path"])
    def delete(path): ...
    """

    def decorator(func):
        REGISTRY.register(ToolSpec(
            name=name, tier=tier, handler=func, description=description,
            network=network, risk=risk, summarize=summarize, target=target,
            schema=schema or {},
        ))
        return func

    return decorator


# Argument keys whose values must never be written to the audit log.
_SECRET_KEYS = ("password", "passwd", "secret", "token", "api_key", "apikey",
                "key", "authorization", "auth", "client_secret", "private_key")


def redact(args: dict) -> dict:
    """Return a copy of args with secret-looking values masked for logging."""
    out = {}
    for k, v in (args or {}).items():
        if any(s in k.lower() for s in _SECRET_KEYS):
            out[k] = "***redacted***"
        elif isinstance(v, str) and len(v) > 500:
            out[k] = v[:500] + f"...(+{len(v) - 500} chars)"
        else:
            out[k] = v
    return out
