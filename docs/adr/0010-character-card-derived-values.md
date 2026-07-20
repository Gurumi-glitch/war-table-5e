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

## Amendment (2026-07-20, PR #10 character builder): granted values are derived, chosen values are state

The character **builder** (`CharacterBuilder.tsx`, shipped in PR #10) creates the card this ADR governs, and it hit the same hazard from the other direction. Its proficiency state had three sources — species grants, background grants, and the player's own class picks — all union-merged into one `chosenSkills` array. Only the background handler removed the *previous* background's grants; switching class or species left the old source's skills in state forever. Because the picker renders only the *current* class's list, the leftovers became **checked but unrenderable**, and card assembly wrote them out as real proficiencies. A wizard could ship with five skill proficiencies, three of them not even on the wizard list, with no UI surface showing it. Fixed by removing the accumulator, not by adding a third filter (`4fdb742`).

**The rule this establishes for builder-shaped state:** anything *implied by a selection* (species/background grants, racial ASI, seeded languages) is a **derived `useMemo`, never stored state** — changing the selection recomputes it, so there is nothing to filter-then-merge. Only what the **user actively chose** goes in state. The tell that you are on the wrong side of this line is writing a second "remove the old source's contribution first" filter in a handler: the third source will get it wrong, and the wrongness will be invisible rather than loud.

Two corollaries, both consistent with ADR-0002:
- **Granted values must be visible, not merely applied.** Grants render as disabled+checked with a `（種族）`/`（背景）` tag. A silently-applied grant is the same failure class as a silently-wrong derived value — the DM cannot audit what the UI does not draw. (Species grants outside the class list used to render nowhere at all.)
- **Rule violations warn, never block.** Picking more skills than the class allows produces a soft `⚠` hint next to the count and nothing else — same shape as the "diverged from engine" warning on overridden values (`493b673`) and the point-buy out-of-range hint. Manual override still wins; the hint exists so the deviation is *visible* rather than silent.

Testing corollary: when the defect is UI/state divergence, the regression test must assert on the **assembled payload** (the `onCreate` call), not on checkbox state. A test that reads the UI is reading the half that lies.

## Consequence for future work

Extending the auto-derivation graph (e.g. adding a species-bonus layer) must **preserve the granular-recompute guarantee**: a newly-derived value recomputes only when its own inputs change, never as part of a global recompute. Do not collapse the granular helpers into a "recompute everything" pass. Any new derived field must declare its dependency set explicitly so its recompute stays scoped. This ADR and ADR-0002 together are why the character card's overrides survive edits.
