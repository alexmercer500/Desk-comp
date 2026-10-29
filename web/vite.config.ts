import { resolve } from "node:path";
import { defineConfig } from "vite";

// The website. It draws the app's own characters, so `@app` points at the
// app's source one folder up (Vercel: Root Directory `web`, with files outside
// it included in the build, which is its default).
export default defineConfig({
  resolve: { alias: { "@app": resolve(import.meta.dirname, "../src") } },
  server: { port: 5190, strictPort: true, fs: { allow: [".."] } },
  build: { target: "es2022" },
});
