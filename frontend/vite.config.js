import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Dev server proxies the Worker (wrangler dev on :8971) so the SPA talks to it
// same-origin — mirrors the Vercel rewrites in production.
export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5188,
    proxy: {
      "/api": { target: "http://127.0.0.1:8971", changeOrigin: true, ws: true },
      "/auth": { target: "http://127.0.0.1:8971", changeOrigin: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
