import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Static Super Admin SPA: served at platform.bcom.si (PLAN §6).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5174, host: true },
  envPrefix: ["VITE_"],
  build: { sourcemap: true, target: "es2023" },
});
