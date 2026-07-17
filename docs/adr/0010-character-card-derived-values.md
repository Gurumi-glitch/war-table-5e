# Character-card derived values — incomplete auto-derivation (species bonuses out of v1) + manual compensation + granular recompute

The character card auto-derives some values from base stats (ability mods, PB-scaled values, etc. via `cascadePb` / `recomputeDependents` / `modByKey` / `recalcCard` in `src/lib/dndCalc.ts` and `CharacterCardWindow.tsx`). The auto-derivation graph is **intentionally incomplete in v1**: species/subrace stat bonuses (High Elf +2 DEX from elf / +1 INT from the high-elf subrace, and every other species' own spread) are **not** auto-applied, because modeling all species is out-of-v1 scope (too many species, each different).

Therefore derived fields are manually overrideable, and the DM is **expected** to manually set/override derived values to compensate for un-modeled bonuses. Manual override on the character sheet is not a "just in case" fallback — it is the *primary* way species bonuses reach the sheet today.

## Decision

When a base stat is edited, **only the derived values that depend on it recompute**; manual overrides on *unrelated* derived fields survive. The granular helpers in `dndCalc.ts` exist specifically for this ("granular helpers instead so manual overrides survive unrelated edits", `dndCalc.ts:145`). A global "recompute everything" pass is never used on a base edit.

## Why

Because auto-derivation is incomplete, derived fields carry manual overrides that compensate — a manually-set AC for an un-modeled species trait or feat, a manually-bumped save, etc. A "recompute all derived values on any base edit" simplification would **silently destroy** those compensating overrides the next time the DM touched an unrelated stat. No test catches it: the recompute is still "correct," just destructive, so the DM wouldn't notice until the number was wrong at the table. This is the same silent-cleanup-hazard pattern as ADR-0004 (optimistic updates) — guarded by reading intent, not by CI.

## Considered options

- **Recompute all derived values on any base edit.** Rejected — silently wipes unrelated manual overrides (the compensating overrides for un-modeled bonuses).
- **Full auto-derivation incl. all species/subrace bonuses.** Out of v1 scope (too many species, each different). Deferred. Until then: manual compensation + granular recompute.

## Consequence for future work

Extending the auto-derivation graph (e.g. adding a species-bonus layer) must **preserve the granular-recompute guarantee**: a newly-derived value recomputes only when its own inputs change, never as part of a global recompute. Do not collapse the granular helpers into a "recompute everything" pass. Any new derived field must declare its dependency set explicitly so its recompute stays scoped. This ADR and ADR-0002 together are why the character card's overrides survive edits.
