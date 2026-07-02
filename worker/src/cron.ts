// The heartbeat — runs every minute via Cron Trigger. Built out in phase C7.

import type { Env } from "./env";

export async function heartbeat(_env: Env): Promise<void> {
  // C7: due automations + calendar reminders → agent turns → alerts.
}
