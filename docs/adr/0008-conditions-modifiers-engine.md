# Conditions & modifiers engine — additive spec-stack, reversible tags, whole-bundle chips

Conditions and custom modifiers are modeled as `ModifierSpec`s pushed onto a per-combatant list. The base stat is **never mutated**; effective values are computed from the spec list — net modifier via `effectiveNumber`, net advantage via `advantageFor`, auto-fail via `autoFailFor` (all in `convex/modifiers.ts`). Toggling a condition off pops its specs, reverting the effect. Custom conditions (Case 2) bundle multiple specs under one label = one toggleable chip (e.g. 薩滿之怒: STR-check advantage + STR-save advantage + STR melee damage bonus + BPS resistance).

## Decision

1. **Layering.** Manual base override is authoritative (ADR-0002); conditions are a separate, **non-destructive tag layer on top** of the base. Conditions are themselves editable. One click removes the tag to revert.
2. **Additive, non-mutating.** Conditions push specs; the base is never overwritten. This is the mechanism that makes "manual override wins" actually hold under toggling — a toggled condition cannot destroy a manual base value.
3. **One spec list, three resolution axes.** The same spec list feeds `effectiveNumber`, `advantageFor`, and `autoFailFor`, so adding a condition consistently affects modifier / advantage / auto-fail together (you can't accidentally apply a condition's disadvantage without also its auto-fail, etc.).
4. **Whole-bundle as the unit of reversal.** A custom condition toggles as one chip — one click reverts all its specs. This matches how conditions end at the table (you end "薩滿之怒" as one thing, not its individual sub-effects).

## Why

Reversibility is the whole point of the tag model: conditions are a non-destructive way to change stats, removable in one click. Per-spec sub-toggling within a bundle would break the "one click reverts" promise and require per-spec active-state storage for a rare need. If a DM wants a partial effect, the ethos is to edit the condition's specs directly (conditions are editable) or add a separate custom condition.

## Considered options

- **Mutate-and-reverse** (apply the condition's effect directly to the stat, reverse on toggle). Rejected — drifts the moment a condition is edited while active, and cannot cleanly layer with manual base overrides (it would overwrite the base, violating ADR-0002's guarantee).
- **Per-spec toggling within a custom bundle.** **Deferred — possible future change, low priority, no current need.** Stay whole-bundle for now. If a real need for removing a single stat from a bundle arises, per-stat removal within a bundle is the direction to revisit. Recorded here so a future contributor knows it was considered and consciously deferred, not forgotten.

## Consequence for future work

Any new condition/modifier-affecting feature pushes a `ModifierSpec` with the right `stat` (`attack` / `attackAgainst` / `save` / etc. — see ADR-0003 for the adv/disadv actor/target side split) rather than mutating a base value. The unit of reversal is the **condition**, not the individual spec. Do not introduce a second mechanism for applying reversible stat changes alongside the spec-stack. Instant appliesMods-only stats (`healing`, and since 2026-07-08 `tempHp` — granted via `grantTempHp`, no stacking, keep-the-larger, per the fifth-edition temp-HP rule) are the sanctioned exception: applied once at Confirm, never stored as a chip, inert to all Effective-stat math.
