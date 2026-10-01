import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

// Static SPA: built in CI, served by nginx in the admin image (PLAN §3).
export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  server: { port: 5173, host: true },
  envPrefix: ["VITE_"],
  build: { sourcemap: true, target: "es2023" },
});
