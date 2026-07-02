import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Dev server proxies the kernel-backed API (FastAPI on :8788) so the SPA talks to it
// same-origin. Production build (npm run build) emits to dist/, which FastAPI serves.
export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5188,
    proxy: {
      "/api": { target: "http://127.0.0.1:8788", changeOrigin: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
