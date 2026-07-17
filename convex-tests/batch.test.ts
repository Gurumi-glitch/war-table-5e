import { test, expect } from "vitest";
import { newTestClient } from "./testHelper";
import { create, getGameState } from "../convex/games";
import {
  add as addCombatant,
  remove as removeCombatant,
  setAlive,
} from "../convex/combatants";
import { batchRoll, setDieClaim, setDieValue, rerollDie } from "../convex/dice";
import { confirm } from "../convex/combatLog";
import { add as addRecipe } from "../convex/recipes";
import { addCustomModifier, toggleEffect } from "../convex/effects";
import { startBatchRun, advanceBatchTurn, endBatchRun } from "../convex/batch";
import type { DieType } from "../convex/dice";

/**
 * Backend-seam tests for Batch battle (issue #8): one Batch roll serves a run
 * of consecutive turns resolved in initiative order from the same pre-rolled
 * board. Covers the run ordering, the no-reroll invariant, and Conditions
 * toggled between Confirms feeding the next Confirm's math. Batch battle is
 * optional — the normal flow is untouched when no run is active.
 */

async function setup() {
  const t = newTestClient();
  const { playerToken, dmToken } = await t.mutation(create, {});
  // Initiative order: Hero (10) → Ally (9) → Goblin (8).
  const hero = await t.mutation(addCombatant, {
    playerToken, name: "Hero", kind: "pc", maxHp: 30, ac: 16, initiative: 10, notes: "",
  });
  const ally = await t.mutation(addCombatant, {
    playerToken, name: "Ally", kind: "pc", maxHp: 25, ac: 14, initiative: 9, notes: "",
  });
  const gob = await t.mutation(addCombatant, {
    playerToken, name: "Goblin", kind: "enemy", maxHp: 20, ac: 12, initiative: 8, notes: "",
  });
  return { t, playerToken, dmToken, hero, ally, gob };
}

/** Set + claim dice of `type` for a combatant (first unclaimed of the type). */
async function claimDice(
  t: ReturnType<typeof newTestClient>,
  playerToken: string,
  combatantId: string,
  type: DieType,
  values: number[],
) {
  const state = await t.query(getGameState, { playerToken });
  const free = state.dice.filter((d: any) => d.type === type && d.claimedBy === null);
  for (let i = 0; i < values.length; i++) {
    await t.mutation(setDieValue, { playerToken, dieId: free[i]._id, value: values[i] });
    await t.mutation(setDieClaim, { playerToken, dieId: free[i]._id, claimedBy: combatantId });
  }
}

/** A basic Longsword attack recipe: +5 to hit, 1d8+3 slashing. */
async function addLongsword(
  t: ReturnType<typeof newTestClient>,
  playerToken: string,
  combatantId: string,
) {
  return await t.mutation(addRecipe, {
    playerToken, combatantId,
    recipe: {
      name: "Longsword", hitType: "attack", attackMod: 5,
      damageDice: [{ type: "d8", count: 1 }], damageMod: 3, damageType: "slashing",
      dc: 0, saveAbility: "", critImmune: false, resourceCost: 0, multiTarget: "none",
    },
  });
}

test("startBatchRun: fresh board (claims released), queue in initiative order, pointer at top", async () => {
  const { t, playerToken, dmToken, hero, ally, gob } = await setup();
  // Stale claim from before the run — the run's fresh Batch roll must release it.
  await claimDice(t, playerToken, hero, "d20", [14]);

  await t.mutation(startBatchRun, { playerToken });

  const state = await t.query(getGameState, { playerToken, dmToken });
  // Queue = all alive combatants, initiative order (Hero 10 → Ally 9 → Goblin 8).
  expect(state.batchRun).toMatchObject({ turnIds: [hero, ally, gob], turnIndex: 0 });
  expect(state.batchRun!.runId).toEqual(expect.any(String));
  // Turn highlight follows the run.
  expect(state.currentTurnId).toBe(hero);
  // The single Batch roll released every claim — no stale state on the board.
  expect(state.dice.filter((d: any) => d.claimedBy !== null)).toHaveLength(0);
});

test("startBatchRun with a subset: only those combatants, still initiative order", async () => {
  const { t, playerToken, dmToken, hero, gob } = await setup();
  // Pass ids in "wrong" order — the queue is initiative order regardless.
  await t.mutation(startBatchRun, { playerToken, combatantIds: [gob, hero] });
  const state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.batchRun).toMatchObject({ turnIds: [hero, gob], turnIndex: 0 });
});

test("startBatchRun default excludes dead combatants; empty queue / double start throw", async () => {
  const { t, playerToken, dmToken, hero, ally, gob } = await setup();
  await t.mutation(setAlive, { playerToken, combatantId: ally, alive: false });
  await t.mutation(startBatchRun, { playerToken });
  const state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.batchRun!.turnIds).toEqual([hero, gob]);

  // A second start while a run is active is an error — end it first.
  await expect(t.mutation(startBatchRun, { playerToken })).rejects.toThrow(/already active/);

  await t.mutation(endBatchRun, { playerToken });
  await t.mutation(setAlive, { playerToken, combatantId: hero, alive: false });
  await t.mutation(setAlive, { playerToken, combatantId: gob, alive: false });
  // Everyone is down (Ally already was) — nothing to run.
  await expect(t.mutation(startBatchRun, { playerToken })).rejects.toThrow(/at least one/);
});

test("no-reroll invariant: batchRoll locked during a run, unlocked after; single-die ops stay open", async () => {
  const { t, playerToken, dmToken, hero } = await setup();
  await t.mutation(startBatchRun, { playerToken });

  // Batch rolls (full or per-type) are locked — the board serves the whole run.
  await expect(t.mutation(batchRoll, { playerToken })).rejects.toThrow(/locked/);
  await expect(t.mutation(batchRoll, { playerToken, types: ["d20"] })).rejects.toThrow(/locked/);

  // Single-die adjustment before a Confirm is still the normal Claim flow:
  // selective reroll + manual entry stay open (manual override always wins).
  const state = await t.query(getGameState, { playerToken, dmToken });
  const d20 = state.dice.find((d: any) => d.type === "d20")!;
  await t.mutation(rerollDie, { playerToken, dieId: d20._id });
  await t.mutation(setDieValue, { playerToken, dieId: d20._id, value: 17 });
  await t.mutation(setDieClaim, { playerToken, dieId: d20._id, claimedBy: hero });

  // Ending the run unlocks the Batch roll.
  await t.mutation(endBatchRun, { playerToken });
  await t.mutation(batchRoll, { playerToken });
  const after = await t.query(getGameState, { playerToken, dmToken });
  expect(after.batchRun).toBeNull();
});

test("run ordering: the current runner's Confirm advances the pointer; the last Confirm ends the run", async () => {
  const { t, playerToken, dmToken, hero, ally, gob } = await setup();
  await t.mutation(startBatchRun, { playerToken, combatantIds: [hero, ally] });

  // Hero (current) confirms → pointer moves to Ally.
  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "attack",
    effects: [{ combatantId: gob, hpDelta: -3 }],
  });
  let state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.batchRun).toMatchObject({ turnIds: [hero, ally], turnIndex: 1 });
  expect(state.currentTurnId).toBe(ally);

  // Ally (last in the queue) confirms → run complete, back to the normal flow.
  await t.mutation(confirm, {
    playerToken, actingCombatantId: ally, effectText: "attack",
    effects: [{ combatantId: gob, hpDelta: -2 }],
  });
  state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.batchRun).toBeNull();
  await t.mutation(batchRoll, { playerToken }); // unlocked again
});

test("out-of-queue Confirms are allowed but don't advance the run (guide, not gatekeeper)", async () => {
  const { t, playerToken, dmToken, hero, ally, gob } = await setup();
  await t.mutation(startBatchRun, { playerToken, combatantIds: [hero, ally] });

  // Goblin (not in the run — e.g. a reaction) and Ally (in the run, not current)
  // both confirm; neither is the current runner, so the pointer stays on Hero.
  await t.mutation(confirm, {
    playerToken, actingCombatantId: gob, effectText: "reaction", effects: [],
  });
  await t.mutation(confirm, {
    playerToken, actingCombatantId: ally, effectText: "held action", effects: [],
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.batchRun).toMatchObject({ turnIds: [hero, ally], turnIndex: 0 });
  expect(state.currentTurnId).toBe(hero);
});

test("Conditions toggled between Confirms feed the next Confirm's math", async () => {
  const { t, playerToken, dmToken, hero, ally, gob } = await setup();
  const mage = await t.mutation(addCombatant, {
    playerToken, name: "Mage", kind: "pc", maxHp: 18, ac: 12, initiative: 7, notes: "",
  });
  const heroSword = await addLongsword(t, playerToken, hero);
  const allySword = await addLongsword(t, playerToken, ally);
  const mageSword = await addLongsword(t, playerToken, mage);

  await t.mutation(startBatchRun, { playerToken, combatantIds: [hero, ally, mage] });

  // Turn 1 — Hero: d20 14 (+5 = 19) vs Goblin AC 12 → HIT for 6+3 = 9.
  await claimDice(t, playerToken, hero, "d20", [14]);
  await claimDice(t, playerToken, hero, "d8", [6]);
  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: heroSword, targets: [{ combatantId: gob }],
  });
  let state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.combatants.find((c: any) => c.name === "Goblin")!.hp).toBe(11); // 20 - 9
  expect(state.batchRun!.turnIndex).toBe(1);

  // Between Confirms the DM toggles a Modifier ON: Goblin dives behind cover
  // (+10 AC). Confirm computes Effective AC live, so this feeds the next turn.
  await t.mutation(addCustomModifier, {
    playerToken, combatantId: gob, label: "Total cover",
    specs: [{ stat: "ac", mode: "bonus", value: 10 }],
  });

  // Turn 2 — Ally: same d20 14 (+5 = 19) vs Effective AC 22 → MISS.
  await claimDice(t, playerToken, ally, "d20", [14]);
  await claimDice(t, playerToken, ally, "d8", [6]);
  await t.mutation(confirm, {
    playerToken, actingCombatantId: ally, effectText: "",
    recipeId: allySword, targets: [{ combatantId: gob }],
  });
  state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.combatants.find((c: any) => c.name === "Goblin")!.hp).toBe(11); // unchanged
  expect(state.batchRun!.turnIndex).toBe(2);

  // Toggle the cover OFF (reversible, #5) — the next Confirm reverts to base AC.
  const cover = state.combatants.find((c: any) => c.name === "Goblin")!.effects[0];
  await t.mutation(toggleEffect, { playerToken, effectId: cover._id, active: false });

  // Turn 3 — Mage: d20 14 (+5 = 19) vs AC 12 again → HIT for 9; run completes.
  await claimDice(t, playerToken, mage, "d20", [14]);
  await claimDice(t, playerToken, mage, "d8", [6]);
  await t.mutation(confirm, {
    playerToken, actingCombatantId: mage, effectText: "",
    recipeId: mageSword, targets: [{ combatantId: gob }],
  });
  state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.combatants.find((c: any) => c.name === "Goblin")!.hp).toBe(2); // 11 - 9
  expect(state.batchRun).toBeNull(); // queue exhausted → run over
});

test("advanceBatchTurn skips the current turn; skipping past the end ends the run", async () => {
  const { t, playerToken, dmToken, hero, ally } = await setup();
  await t.mutation(startBatchRun, { playerToken, combatantIds: [hero, ally] });

  await t.mutation(advanceBatchTurn, { playerToken }); // skip Hero (e.g. stunned)
  let state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.batchRun!.turnIndex).toBe(1);
  expect(state.currentTurnId).toBe(ally);

  await t.mutation(advanceBatchTurn, { playerToken }); // skip Ally → queue done
  state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.batchRun).toBeNull();

  // No run → advancing is an error (nothing to advance).
  await expect(t.mutation(advanceBatchTurn, { playerToken })).rejects.toThrow(/No Batch battle/);
});

test("removing a combatant mid-run drops it from the queue and keeps the pointer sensible", async () => {
  const { t, playerToken, dmToken, hero, ally, gob } = await setup();
  await t.mutation(startBatchRun, { playerToken });
  // Hero takes his turn → pointer on Ally (index 1 of [hero, ally, gob]).
  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "", effects: [],
  });

  // Removing an earlier (already-taken) turn shifts the pointer down with it.
  await t.mutation(removeCombatant, { playerToken, combatantId: hero });
  let state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.batchRun).toMatchObject({ turnIds: [ally, gob], turnIndex: 0 });
  expect(state.currentTurnId).toBe(ally);

  // Removing the current combatant points at the next one.
  await t.mutation(removeCombatant, { playerToken, combatantId: ally });
  state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.batchRun).toMatchObject({ turnIds: [gob], turnIndex: 0 });
  expect(state.currentTurnId).toBe(gob);

  // Removing the last queued combatant ends the run.
  await t.mutation(removeCombatant, { playerToken, combatantId: gob });
  state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.batchRun).toBeNull();
});

test("Batch battle is optional: with no run active, state carries batchRun null and the normal flow works", async () => {
  const { t, playerToken, dmToken, hero, gob } = await setup();
  const state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.batchRun).toBeNull();
  // Normal flow: batch roll + confirm, no run bookkeeping.
  await t.mutation(batchRoll, { playerToken });
  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "poke",
    effects: [{ combatantId: gob, hpDelta: -6 }],
  });
  const after = await t.query(getGameState, { playerToken, dmToken });
  expect(after.combatants.find((c: any) => c.name === "Goblin")!.hp).toBe(14);
  expect(after.batchRun).toBeNull();
});
