# Public release: self-host primary, one shared playground deployment — never a multi-tenant service

Going public (the portfolio goal) means strangers can reach the code and, if we publish a URL, a live deployment. This ADR fixes *what* we operate for them. It is the durable summary of a longer local-only interview record (12 questions + S1–S4 simplification review, 2026-07-12).

## Decision

The repo goes public as a **self-hostable tool**, with exactly **two deployments operated by us, same code**:

1. **遊戲桌 (game table)** — the existing prod (Convex `<prod>` + Vercel; the deployment name is deliberately not written here — this file ships publicly, and the table's coordinates are exactly what this ADR says to keep out of public material. Local-only planning docs carry the real name). Private in practice: its URL never appears in the README or any public material. Persistent global character cards, no data policy changes. Behavior identical to before this decision.
2. **Demo / playground** — a *separate* Convex project + *separate* Vercel project, URL published in the README. Fully functional (create game, create/import/export cards, run combat), `PLAYGROUND_MODE=true` (ADR-0015), data periodically wiped, seeded with SRD sample cards. Casual groups may genuinely play on it; the homepage banner tells them to export cards to keep them.
3. **Strangers wanting a persistent campaign self-host** their own Convex+Vercel (both free tier); the README carries the deployment guide.

We do **not** operate a multi-tenant hosted service, and there is **no group/owner token system**.

## Why

- **The no-login trust model doesn't scale to strangers.** Secret-URL + open-buttons + DM-is-authority is designed for one table of friends. Serving strangers' persistent campaigns would mean: we can never wipe or freely migrate (their real data, no way to contact them), their traffic shares the free-tier fuse with our own game nights, and human-chosen group tokens are cooperative privacy, not isolation — real isolation reinvents login.
- **Two deployments quarantine every fear that motivated token engineering.** Stranger traffic burns the demo project's quota, never the table's; "hundreds of stranger cards" accumulate only where wiping is legitimate policy; visibility of cards stops mattering where cards are either ours (private deployment) or disposable (demo).
- **The portfolio wants clickable + comprehensible, not operated.** A README demo link satisfies "interviewers can't click a link" (the original gap) without signing service-operator contracts.

## Considered options

- **Single deployment as both table and demo.** Rejected: stranger writes land in the table's Convex quota and sit next to real campaign data; wipe policy becomes impossible.
- **Multi-tenant hosted service with character group tokens** (e.g. a shared word entered at create-game and card-creation). Rejected on three contracts it silently signs: permanent custody of strangers' campaign data (no wipe/migrate freedom, no user contact channel), shared quota fuse, and low-entropy tokens giving fake isolation (fixing that = reinventing accounts). The one benefit — "my own cards survive under my token" — is free on a private deployment.
- **Remove the public URL entirely, hand it to interviewers personally.** Rejected: kills the main value of going public (nothing clickable from the README).
- **Ephemeral-only cards everywhere (import at start, delete on close).** Rejected: "close" doesn't exist as an event in a no-login web app, and it outsources campaign continuity to human memory (per-session export/import ritual, file-version chaos). Ephemerality is the demo's *operations policy* (periodic wipe), not architecture.

## Consequence for future work

The maintenance surface is: push to main auto-deploys both Vercel projects; backend changes need one extra `deploy:demo` command (candidate for CI automation later). Demo cleanup is manual dashboard table-clearing + reseed until the Phase-2 wipe mutation + cron. If real demand ever appears for hosted multi-group play, that is a deliberate reversal of this ADR (re-read the grilling doc's Q4 contracts first), not an incremental feature. The game-table URL staying out of the README is a standing rule — treat publishing it as a security-relevant change.
