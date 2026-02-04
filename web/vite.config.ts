import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 8080,
    strictPort: true, // Prevents port jumping if 8080 is momentarily busy
    allowedHosts: ["vaiyu.co.in", "www.vaiyu.co.in"],
    hmr: {
      protocol: 'ws',      // Force insecure ws (standard for local dev)
      host: 'localhost',   // Force it to look at your machine
      port: 8080,          // Match your server port
    },
  },
})
