# Deployment environments

This project deploys the frontend to Vercel and the backend to Convex, with
separate Production and Preview environments so that testing never touches
live game data.

| Environment | Convex deployment       | Triggered by             |
| ----------- | ----------------------- | ------------------------ |
| Production  | the production deployment | push to `main`           |
| Preview     | the dev deployment      | push to any other branch |

(Deployment names live in the Convex dashboard and in the gitignored
`.env.local` — they are deliberately not written down here, since this file is
public and a deployment name is an address for the live table.)

## Why the split exists

Vercel automatically builds a Preview deployment — with its own unique URL —
for every push to a non-`main` branch. `VITE_CONVEX_URL` was originally scoped
to both Production and Preview with the same value (the production Convex
URL), so every Preview deployment, including throwaway test branches, wrote
directly into the live game database the actual play group uses.

Fixed by giving `VITE_CONVEX_URL` a separate value scoped only to Preview,
pointing at the dev deployment. Verified by pushing a branch and confirming
the resulting Preview deployment's test data landed in dev's tables, not
prod's.

## Practical effect

It's now safe to push a feature branch and use its Preview URL for anything
that needs a real, reachable URL — handing the link to Tabletop Simulator,
testing realtime sync across multiple browser tabs/devices — without risking
the live game data. Any future feature branch gets this isolation automatically;
no per-branch setup needed.
