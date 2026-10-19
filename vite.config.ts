import { resolve } from "node:path";
import { defineConfig } from "vite";

// Two pages: the playground (index.html) and the desktop window (companion.html).
export default defineConfig({
  clearScreen: false,
  server: { port: 5179, strictPort: true },
  // The app's tests only: the relay has its own (`cd relay && npm test`).
  test: { include: ["tests/**/*.test.ts"] },
  build: {
    target: "es2022",
    // Rui's 3D stage (three.js) is one ~600 kB file, loaded only when he's chosen.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      input: {
        playground: resolve(import.meta.dirname, "index.html"),
        companion: resolve(import.meta.dirname, "companion.html"),
        bubble: resolve(import.meta.dirname, "bubble.html"),
        panel: resolve(import.meta.dirname, "panel.html"),
        app: resolve(import.meta.dirname, "app.html"),
      },
    },
  },
});
