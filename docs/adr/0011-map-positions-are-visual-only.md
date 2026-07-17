# Map positions are visual-only, never fed into combat resolution

The 地圖 (Map) section adds a shared, synced image + grid with draggable **chess pieces** and a global **backstage** holding pen (add-map-system). A piece's position is stored as data (`pieces.location`: a board cell, or a backstage x/y), but **nothing reads a position to compute a rule outcome**. It is a visual reference only.

## Decision

The map system is a **visual/spatial reference layer with no combat-resolution semantics**. Piece positions, the active map, and the grid are display data. No distance, range, line-of-sight, movement-cost, or adjacency computation exists, and no position is ever read by the Confirm engine (`convex/combatLog.ts`), `convex/modifiers.ts`, or any combat math. The three new tables (`maps`, `pieces`, `flavorDice`) are never queried by combat-resolution code.

Like the Dice Board (ADR-0007), the map lives on the non-tablet surfaces and is explicitly kept off the TTS tablet (`?Tablet` content-scope, ADR-0006): it is heavy interactive input, exactly what the tablet strip removes.

## Why

The prior Google Sheets build tried to be both a rules engine *and* a spatial simulator (Bresenham line-of-sight, forced-move, terrain/unit-layer collisions) and stalled on that complexity — most of its spatial machinery was never fully wired, and its own handoff concluded "不要再為每個普通新技能改程式." This boundary is the load-bearing constraint that keeps the map feature from becoming that project again:

- **Scope containment.** Keeping positions display-only means adding a map does not reopen the range/LoS/forced-move rabbit hole that sank the Sheets attempt.
- **Manual-override ethos (ADR-0002).** The DM is the authority on where things are and what happens; automating position→outcome would make the engine a gatekeeper, which the whole toolkit deliberately avoids.
- **Auditability of the chokepoint (ADR-0007).** The Confirm engine is the single combat-resolution path. If position silently fed hit/miss or damage, that chokepoint would no longer be the whole story. `flavorDice` is a separate table from the combat `dice` for the same reason — so "never read by `combatLog.ts`" stays trivially true.

## Considered options

- **Wire position into range/LoS/adjacency checks now.** Rejected — it's the exact complexity that stalled the Sheets build, with no current table demand (the physical map still lives in Tabletop Simulator).
- **Enforce the boundary only by convention, silently.** Rejected as insufficient — with no technical barrier (no combat code imports `pieces`/`maps`), a future contributor could casually add `position → modifier` logic. This ADR is the barrier: crossing it must be a conscious, recorded decision to reverse this one.
- **Pixel-calibrated grids against pre-gridded map images.** Deferred — stretch-fit only for now; the schema extends cleanly later (optional `offsetX`/`offsetY`/`cellPx` on `maps`) without touching this boundary.

## Consequence for future work

Do not read a piece's position, the active map, or the grid from `combatLog.ts` / `modifiers.ts` / any resolution path. Distance/range/LoS/forced-move remain out of scope (v2 deferrals in `todo.md`). If spatial automation is ever wanted, it is a deliberate reversal of this ADR, not an incremental feature — and the Confirm engine (ADR-0007) stays the single resolution chokepoint regardless. Any new map capability (fog-of-war, calibration, more piece metadata) is additive display state, gated by the same DM/open-movement permission split established here (map management + enemy-linked pieces are DM-only per ADR-0005; movement/PC/ad-hoc CRUD is open).

## Superseding note (fix-map-review-findings, 2026-07-10): map deletion relocates its pieces

The original build kept map and piece lifecycles fully independent — deleting a map left its pieces untouched in the DB (a piece on the deleted map's board simply stopped rendering). A code review flagged this as stranding pieces invisibly and unreachably. Map **deletion** now relocates every piece on the deleted map's board to the backstage holding pen (`{ kind: "backstage", x: 50, y: 50 }`) so no piece is silently orphaned (`maps.remove`). Map **switching** still never touches pieces (all piece state is preserved when the active map changes). This is a lifecycle refinement only; it does not touch the visual-only boundary above — positions are still never read by combat resolution.
