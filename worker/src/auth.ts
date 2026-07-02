// /auth/* — signup, login, Google OAuth, JWT sessions. Built out in phase C2.

import { Hono } from "hono";
import type { Env } from "./env";

export const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.all("*", (c) => c.json({ error: "auth not ready yet" }, 501));
