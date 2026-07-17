# Backend: Convex reactive database

We chose Convex as the realtime backend for the shared board, character data, and enemy database, with a Vite + React frontend hosted on Vercel.

The app needs realtime sync across browser clients (including a Tabletop Simulator in-game tablet) with **no login** — players join by URL. Convex gives automatic reactive sync and lets us filter DM-only fields inside query functions using the URL token, with no auth plumbing. The group has no SQL experience and AI writes the code, so SQL's querying power wasn't worth the extra no-login setup that Supabase would require.

## Considered Options

- **Supabase** (Postgres + Realtime + Row-Level-Security): free, true SQL, excellent for a relational enemy database, and RLS could enforce the frontstage/backstage split at the DB layer. Rejected because the no-login requirement needs anonymous auth + RLS policies — more plumbing than this project needs. Revisit if relational enemy queries become important enough to justify the setup.
