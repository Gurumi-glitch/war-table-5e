// MUST stay the first import — patches missing built-in APIs (Object.hasOwn,
// structuredClone) before any module that calls them runs (TTS tablet).
import "./lib/polyfills";
// Arms the global Backspace fix for the TTS tablet (its embedded Chromium
// swallows Backspace's default deletion). Safe no-op on modern browsers.
import { installTtsBackspaceFix } from "./lib/ttsBackspace";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider } from "convex/react";
import { convex } from "./api";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) {
  throw new Error("#root element not found");
}

installTtsBackspaceFix();

createRoot(root).render(
  <StrictMode>
    {convex ? (
      <ConvexProvider client={convex}>
        <App />
      </ConvexProvider>
    ) : (
      <main>
        <h1>D&amp;D Combat Toolkit</h1>
        <p>
          Backend not configured. Set <code>VITE_CONVEX_URL</code> in{" "}
          <code>.env.local</code> (copy it from <code>npx convex dev</code>),
          then restart <code>npm run dev</code>.
        </p>
      </main>
    )}
  </StrictMode>,
);
