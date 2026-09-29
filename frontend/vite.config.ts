import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: true,
    proxy: {
      // Single-origin wiring: the browser only ever talks to the frontend
      // origin; /api is proxied to the backend service.
      "/api": {
        target: "http://api:4000",
        changeOrigin: true,
      },
    },
    watch: {
      usePolling: true,
    },
  },
});
