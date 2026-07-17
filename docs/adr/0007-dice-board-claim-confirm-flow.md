# Dice Board + Claim + Confirm is the canonical combat input flow

Combat input is a three-step flow: **batch roll** dice onto a shared Dice Board → **claim** dice by combatant color → **confirm-to-commit** (the Confirm engine consumes the claimed dice and resolves the attack/save/damage). Batch battle is an optional mode layered on top of this flow, not a parallel one.

## Decision

This shared-board + claim-by-color + confirm-to-commit flow is the **canonical combat input model**, not a leftover from the abandoned Google Sheets attempt. It lives on the non-tablet surfaces (DM laptop, player phones); the TTS tablet strips it (ADR-0006).

## Why

The model is structurally tied to two non-negotiables that won't change:

- **No-login (ADR-0001):** there is no per-player identity to privately attribute dice to. Claiming-by-color is *how* a die is attributed to a combatant when anyone at the table can roll.
- **DM authority (ADR-0002):** dice are visible and auditable to the whole table; the DM can see and override any die (`setDieValue`) and any result (`forceOutcome`). A private-rolls model would break both auditability and the shared-state model.

## Considered options

- **Private per-player rolls.** Rejected — breaks no-login attribution and DM auditability.
- **Direct roll-and-resolve (no claim step).** Rejected — the claim step is what maps a physical die on the shared board to a combatant; without it, batch rolls can't feed per-target resolution, and the DM can't see which die fed which attack.

## Consequence for future work

Any new combat input goes through Claim + Confirm, not a parallel path. The Confirm engine (`convex/combatLog.ts` `confirm`) is the **single resolution chokepoint** — where adv/disadv max/min, net modifiers, R/V/I, and `forceOutcome` all apply (see ADR-0003 for the adv/disadv actor/target split). Do not add a second resolution path. Batch battle extends this flow (it batches Confirms), it does not bypass it.

The Confirm engine emits a **structured event** (`combatLog.event`) that clients render in the viewer's own language; the engine still resolves everything, it just stops formatting the sentence. See ADR-0016 for that contract (dual-write, expand-only, legacy rows fall back to `rollSummary`).

## Amendment — a "second resolution path" can hide inside the chokepoint (#33 / #62, 2026-07-15)

"Do not add a second resolution path" was written against an obvious mistake: a new mutation that resolves combat somewhere other than `confirm`. The real failure was subtler and lived **inside** `confirm` — a branch that skipped part of the shared path while sitting in the middle of it.

Magic Missile's darts branch gated on `recipe.multiTarget === "darts"` and, from there, resolved the whole action — including whether it hit. That made `multiTarget` a **hidden fourth `hitType`**: a recipe that was supposed to be "an attack, whose damage happens to be split into darts" instead bypassed attack resolution entirely, and the per-dart bonus was hardcoded `+1` (Magic Missile's number, burned into the engine) rather than read from `recipe.damageMod`.

The rule this sharpens into:

- **Mechanics are axes that compose, never branches that short-circuit.** `hitType` (attack / save / auto) decides **whether** damage lands. `multiTarget` (none / aoe / darts) decides **how much** lands per target and how claimed dice are split. They are orthogonal: darts at any `hitType` is meaningful, and one swing still decides each target separately — darts only change the amount (`convex/combatLog.ts:432-442`).
- **Spell-specific numbers are data, not code.** Per-dart modifier comes from `recipe.damageMod`; Magic Missile's familiar `sum(d4 + 1)` is a recipe with `damageMod: 1`, not an `if` in the engine. A hardcoded constant in the engine is the same bug as a hardcoded branch — it makes one spell's shape the engine's shape (ADR-0002: the DM's homebrew must be expressible as data).
- **The test for a new mechanic:** name the axis it belongs to, then check the other axes still compose with it. If the answer is "it handles the whole action itself," it is a second resolution path wearing the chokepoint's clothes.

This is the same root as ADR-0003's incident: a value resolved before all its inputs were known. Known v1 cut, deliberately left: extra rolls stay unwired for darts at every `hitType` (`ExtraRoll` in the rules module).
