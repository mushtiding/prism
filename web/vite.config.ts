import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const tailscaleHostname = "sakuranbo.tail96df1c.ts.net";

// Frontend dev server proxies /api to the Prism backend.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    allowedHosts: [tailscaleHostname],
    port: 5173,
    strictPort: false,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8788",
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    allowedHosts: [tailscaleHostname],
  },
});
