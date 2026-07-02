// /api/voice/live — browser WebSocket ⇄ Gemini Live relay. Built out in phase C6.

import type { Env } from "./env";

export function voiceRelay(req: Request, _env: Env): Response {
  if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("expected websocket", { status: 426 });
  }
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
  server.accept();
  // Graceful "not ready" — the UI shows its unavailable state, nothing leaks.
  server.send(JSON.stringify({ type: "status", state: "unavailable" }));
  server.close();
  return new Response(null, { status: 101, webSocket: client });
}
