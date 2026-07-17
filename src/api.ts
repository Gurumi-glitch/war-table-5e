import { ConvexReactClient } from "convex/react";

/**
 * The Convex backend URL. Set `VITE_CONVEX_URL` (copy it from `npx convex dev`)
 * in `.env.local` before running `npm run dev`. When unset, the app renders a
 * configuration notice instead of a broken client.
 */
const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;

export const convex =
  convexUrl && convexUrl.length > 0
    ? new ConvexReactClient(convexUrl)
    : null;

export { api } from "../convex/_generated/api";
