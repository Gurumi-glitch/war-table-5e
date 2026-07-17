import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // The TTS in-game tablet runs an old embedded Chromium; Vite's default
    // target (~Chrome 87 / ES2020) emits syntax like `?.`/`??` that older
    // engines reject with a SyntaxError → silent blank page. es2015 keeps
    // ESM (Chrome 61+) but transpiles all modern syntax away. Modern
    // browsers are unaffected; the bundle just grows slightly.
    target: "es2015",
  },
  define: {
    // Convex client checks for process.env.NODE_ENV in some paths; provide a
    // static value for the browser bundle.
    "process.env.NODE_ENV": JSON.stringify(
      process.env.NODE_ENV ?? "production",
    ),
  },
});
