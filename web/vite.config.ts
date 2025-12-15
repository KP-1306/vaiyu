// web/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: true,   // <-- crucial: readable stacks in Prod
  },
  server: {
    host: true,
    port: 8080,
    allowedHosts: ["vaiyu.co.in", "www.vaiyu.co.in"],
  },
});
