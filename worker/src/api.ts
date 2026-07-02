// /api/* — the workspace REST surface. Identity comes from requireUser (JWT).
// Workspace CRUD lands in C3; kernel/agent in C4–C5.

import { Hono } from "hono";
import { requireUser, type AppContext } from "./auth";

export const apiRoutes = new Hono<AppContext>();

apiRoutes.use("*", requireUser);

apiRoutes.get("/me", async (c) => {
  const uid = c.get("userId");
  const p = await c.env.DB.prepare(
    "SELECT display_name, onboarded FROM profiles WHERE user_id = ?").bind(uid)
    .first<{ display_name: string | null; onboarded: number | null }>();
  return c.json({
    user_id: uid,
    is_admin: c.get("isOwner"),
    display_name: p?.display_name || "",
    onboarded: Boolean(p?.onboarded),
  });
});

apiRoutes.all("*", (c) => c.json({ error: "not found" }, 404));
