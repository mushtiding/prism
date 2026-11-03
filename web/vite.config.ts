import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiTarget = process.env.PRISM_API_TARGET || "http://127.0.0.1:8788";
const allowedHosts = (process.env.PRISM_ALLOWED_HOSTS || "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

// Frontend dev server proxies /api to the Prism backend.
export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    ...(allowedHosts.length > 0 ? { allowedHosts } : {}),
    port: 5173,
    strictPort: false,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    ...(allowedHosts.length > 0 ? { allowedHosts } : {}),
  },
});
