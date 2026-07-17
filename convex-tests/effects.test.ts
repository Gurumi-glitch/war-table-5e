import { test, expect } from "vitest";
import { newTestClient } from "./testHelper";
import { create, getGameState } from "../convex/games";
import { add, remove } from "../convex/combatants";
import {
  applyCondition,
  addCustomModifier,
  toggleEffect,
  removeEffect,
} from "../convex/effects";

/**
 * Backend-seam tests for Conditions & Modifiers (issue #5). Covers apply/toggle,
 * Effective-stat computation, reversibility (toggle reverts without mutating
 * base), condition-as-one-unit, stacking, cleanup on combatant removal, and the
 * open-buttons ethos (player token only).
 */

async function setup() {
  const t = newTestClient();
  const { playerToken, dmToken } = await t.mutation(create, {});
  const id = await t.mutation(add, {
    playerToken,
    name: "Goblin",
    kind: "enemy",
    maxHp: 7,
    ac: 15,
    initiative: 12,
    notes: "",
  });
  return { t, playerToken, dmToken, id };
}

test("applyCondition (poisoned) attaches the bundled condition as one effect", async () => {
  const { t, playerToken, dmToken, id } = await setup();
  await t.mutation(applyCondition, {
    playerToken,
    combatantId: id,
    conditionKey: "poisoned",
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  const c = state.combatants[0];
  expect(c.effects).toHaveLength(1);
  expect(c.effects[0].type).toBe("condition");
  expect(c.effects[0].conditionKey).toBe("poisoned");
  expect(c.effects[0].label).toBe("Poisoned");
  expect(c.effects[0].active).toBe(true);
  // Poisoned has no AC spec, so Effective AC == base AC.
  expect(c.effectiveAc.value).toBe(15);
});

test("applyCondition rejects an unknown condition key", async () => {
  const { t, playerToken, dmToken, id } = await setup();
  await expect(
    t.mutation(applyCondition, {
      playerToken,
      combatantId: id,
      conditionKey: "nope",
    }),
  ).rejects.toThrow(/Unknown condition/);
});

test("addCustomModifier (Shield +5 AC) raises Effective AC without mutating base", async () => {
  const { t, playerToken, dmToken, id } = await setup();
  await t.mutation(addCustomModifier, {
    playerToken,
    combatantId: id,
    label: "Shield",
    specs: [{ stat: "ac", mode: "bonus", value: 5 }],
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  const c = state.combatants[0];
  expect(c.effects).toHaveLength(1);
  expect(c.effects[0].type).toBe("custom");
  expect(c.ac).toBe(15); // base untouched
  expect(c.effectiveAc).toEqual({ base: 15, bonus: 5, override: null, value: 20 });
});

test("toggleEffect off reverts the Effective stat without mutating the base", async () => {
  const { t, playerToken, dmToken, id } = await setup();
  const effectId = await t.mutation(addCustomModifier, {
    playerToken,
    combatantId: id,
    label: "Shield",
    specs: [{ stat: "ac", mode: "bonus", value: 5 }],
  });
  let state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.combatants[0].effectiveAc.value).toBe(20);

  await t.mutation(toggleEffect, {
    playerToken,
    effectId,
    active: false,
  });
  state = await t.query(getGameState, { playerToken, dmToken });
  const c = state.combatants[0];
  expect(c.effects[0].active).toBe(false);
  expect(c.ac).toBe(15); // base never mutated
  expect(c.effectiveAc.value).toBe(15); // reverted

  // Toggling back on restores it.
  await t.mutation(toggleEffect, { playerToken, effectId, active: true });
  state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.combatants[0].effectiveAc.value).toBe(20);
});

test("toggleEffect on a condition reverts ALL of its bundled modifiers at once", async () => {
  const { t, playerToken, dmToken, id } = await setup();
  // Poisoned disadvantages attack + ability checks. We confirm the condition is
  // one stored effect, and toggling it off reverts both — verified via the pure
  // math in modifiers.test.ts; here we confirm the single row toggles cleanly.
  const effectId = await t.mutation(applyCondition, {
    playerToken,
    combatantId: id,
    conditionKey: "poisoned",
  });
  let state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.combatants[0].effects).toHaveLength(1);

  await t.mutation(toggleEffect, { playerToken, effectId, active: false });
  state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.combatants[0].effects[0].active).toBe(false);
});

test("stacking: two AC-bonus effects sum in the Effective AC", async () => {
  const { t, playerToken, dmToken, id } = await setup();
  await t.mutation(addCustomModifier, {
    playerToken,
    combatantId: id,
    label: "Shield",
    specs: [{ stat: "ac", mode: "bonus", value: 5 }],
  });
  await t.mutation(addCustomModifier, {
    playerToken,
    combatantId: id,
    label: "Half cover",
    specs: [{ stat: "ac", mode: "bonus", value: 2 }],
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  const c = state.combatants[0];
  expect(c.effects).toHaveLength(2);
  expect(c.effectiveAc.value).toBe(22); // 15 + 5 + 2
});

test("removeEffect deletes the effect entirely", async () => {
  const { t, playerToken, dmToken, id } = await setup();
  const effectId = await t.mutation(addCustomModifier, {
    playerToken,
    combatantId: id,
    label: "Shield",
    specs: [{ stat: "ac", mode: "bonus", value: 5 }],
  });
  await t.mutation(removeEffect, { playerToken, effectId });
  const state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.combatants[0].effects).toHaveLength(0);
  expect(state.combatants[0].effectiveAc.value).toBe(15);
});

test("removing a combatant deletes its effects (no orphans)", async () => {
  const { t, playerToken, dmToken, id } = await setup();
  await t.mutation(addCustomModifier, {
    playerToken,
    combatantId: id,
    label: "Shield",
    specs: [{ stat: "ac", mode: "bonus", value: 5 }],
  });
  await t.mutation(applyCondition, {
    playerToken,
    combatantId: id,
    conditionKey: "poisoned",
  });
  await t.mutation(remove, { playerToken, combatantId: id });
  const state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.combatants).toHaveLength(0);
  // Re-add a combatant and confirm no stale effects leak onto it.
  const id2 = await t.mutation(add, {
    playerToken,
    name: "New",
    kind: "pc",
    maxHp: 10,
    ac: 12,
    initiative: 10,
    notes: "",
  });
  const state2 = await t.query(getGameState, { playerToken, dmToken });
  expect(state2.combatants[0].effects).toHaveLength(0);
  expect(id2).toBeDefined();
});

test("effects work with just the player token (open-buttons ethos)", async () => {
  const { t, playerToken, dmToken, id } = await setup();
  // No dmToken anywhere — any player-token client manages conditions/modifiers.
  const effectId = await t.mutation(addCustomModifier, {
    playerToken,
    combatantId: id,
    label: "Shield",
    specs: [{ stat: "ac", mode: "bonus", value: 5 }],
  });
  await t.mutation(toggleEffect, { playerToken, effectId, active: false });
  await t.mutation(applyCondition, {
    playerToken,
    combatantId: id,
    conditionKey: "poisoned",
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.combatants[0].effects).toHaveLength(2);
});

test("an effect on combatant A is not visible on combatant B", async () => {
  const { t, playerToken, dmToken, id } = await setup();
  const id2 = await t.mutation(add, {
    playerToken,
    name: "Other",
    kind: "pc",
    maxHp: 10,
    ac: 12,
    initiative: 10,
    notes: "",
  });
  await t.mutation(addCustomModifier, {
    playerToken,
    combatantId: id,
    label: "Shield",
    specs: [{ stat: "ac", mode: "bonus", value: 5 }],
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  const a = state.combatants.find((c: any) => c._id === id);
  const b = state.combatants.find((c: any) => c._id === id2);
  expect(a.effects).toHaveLength(1);
  expect(b.effects).toHaveLength(0);
  expect(b.effectiveAc.value).toBe(12);
});
