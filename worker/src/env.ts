// Bindings + secrets available to the Emblem Worker.

export interface Env {
  // bindings
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;

  // secrets (wrangler secret put …)
  JWT_SECRET: string;
  CEREBRAS_KEY?: string;
  GROQ_KEY?: string;
  GEMINI_KEY?: string;
  COMPOSIO_KEY?: string;
  RESEND_KEY?: string;
  RESEND_DOMAIN?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  EMBLEM_OWNER_USER_ID?: string;

  // vars
  APP_ORIGIN?: string; // e.g. https://emblem.thequaniac.com (OAuth redirects)
}
