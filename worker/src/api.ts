// /api/* — the workspace REST surface. Built out in phases C3–C5.

import { Hono } from "hono";
import type { Env } from "./env";

export const apiRoutes = new Hono<{ Bindings: Env }>();

apiRoutes.all("*", (c) => c.json({ error: "not found" }, 404));
