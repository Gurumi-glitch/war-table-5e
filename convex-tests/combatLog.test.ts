import { test, expect } from "vitest";
import { claimDice, newGame, newTestClient } from "./testHelper";
import { create, getGameState } from "../convex/games";
import { add } from "../convex/combatants";
import { setDieClaim, setDieValue } from "../convex/dice";
import { confirm, getCombatLog } from "../convex/combatLog";
import { add as addRecipe } from "../convex/recipes";
import { applyCondition } from "../convex/effects";


test("claiming a die alone changes no combatant HP (nothing commits before Confirm)", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const id = await t.mutation(add, {
    playerToken,
    name: "Goblin",
    kind: "enemy",
    maxHp: 10,
    ac: 13,
    initiative: 12,
    notes: "",
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  await t.mutation(setDieClaim, {
    playerToken,
    dieId: state.dice[0]._id,
    claimedBy: id,
  });

  const after = await t.query(getGameState, { playerToken, dmToken });
  const goblin = after.combatants.find((c: any) => c._id === id);
  expect(goblin.hp).toBe(10); // untouched
});

test("confirm applies HP deltas (damage clamps at 0, heal clamps at maxHp)", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const goblin = await t.mutation(add, {
    playerToken,
    name: "Goblin",
    kind: "enemy",
    maxHp: 10,
    ac: 13,
    initiative: 12,
    notes: "",
  });
  const hero = await t.mutation(add, {
    playerToken,
    name: "Hero",
    kind: "pc",
    maxHp: 20,
    ac: 16,
    initiative: 18,
    notes: "",
  });

  await t.mutation(confirm, {
    playerToken,
    actingCombatantId: hero,
    effectText: "hits goblin for 4, overheals hero for 30",
    effects: [
      { combatantId: goblin, hpDelta: -4 },
      { combatantId: hero, hpDelta: 30 },
    ],
  });

  const state = await t.query(getGameState, { playerToken, dmToken });
  const g = state.combatants.find((c: any) => c._id === goblin);
  const h = state.combatants.find((c: any) => c._id === hero);
  expect(g.hp).toBe(6); // 10 - 4
  expect(h.hp).toBe(20); // clamped to maxHp

  // Damage beyond 0 clamps at 0.
  await t.mutation(confirm, {
    playerToken,
    effectText: "finishes the goblin",
    effects: [{ combatantId: goblin, hpDelta: -100 }],
  });
  const after = await t.query(getGameState, { playerToken, dmToken });
  const g2 = after.combatants.find((c: any) => c._id === goblin);
  expect(g2.hp).toBe(0);
});

test("confirm releases the acting combatant's claims; others' claims stay", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const hero = await t.mutation(add, {
    playerToken,
    name: "Hero",
    kind: "pc",
    maxHp: 20,
    ac: 16,
    initiative: 18,
    notes: "",
  });
  const ally = await t.mutation(add, {
    playerToken,
    name: "Ally",
    kind: "pc",
    maxHp: 20,
    ac: 16,
    initiative: 14,
    notes: "",
  });

  // Hero claims a d20; Ally claims a different die.
  const state = await t.query(getGameState, { playerToken, dmToken });
  const heroDie = state.dice.find((d: any) => d.type === "d20")!;
  const allyDie = state.dice.find((d: any) => d.type === "d6")!;
  await t.mutation(setDieClaim, {
    playerToken,
    dieId: heroDie._id,
    claimedBy: hero,
  });
  await t.mutation(setDieClaim, {
    playerToken,
    dieId: allyDie._id,
    claimedBy: ally,
  });

  await t.mutation(confirm, {
    playerToken,
    actingCombatantId: hero,
    effectText: "attack",
    effects: [],
  });

  const after = await t.query(getGameState, { playerToken, dmToken });
  const heroClaim = after.dice.find((d: any) => d._id === heroDie._id);
  const allyClaim = after.dice.find((d: any) => d._id === allyDie._id);
  expect(heroClaim.claimedBy).toBeNull(); // released
  expect(allyClaim.claimedBy).toBe(ally); // untouched
});

test("confirm appends a log entry with the roll summary, effects, and acting name", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const hero = await t.mutation(add, {
    playerToken,
    name: "Hero",
    kind: "pc",
    maxHp: 20,
    ac: 16,
    initiative: 18,
    notes: "",
  });
  const goblin = await t.mutation(add, {
    playerToken,
    name: "Goblin",
    kind: "enemy",
    maxHp: 10,
    ac: 13,
    initiative: 12,
    notes: "",
  });

  // Hero claims a d20 and two d6.
  const state = await t.query(getGameState, { playerToken, dmToken });
  const d20 = state.dice.find((d: any) => d.type === "d20")!;
  const d6s = state.dice.filter((d: any) => d.type === "d6").slice(0, 2);
  // Fix their values via setDieValue so the summary is deterministic.
  const { setDieValue } = await import("../convex/dice");
  await t.mutation(setDieValue, { playerToken, dieId: d20._id, value: 14 });
  await t.mutation(setDieValue, { playerToken, dieId: d6s[0]._id, value: 4 });
  await t.mutation(setDieValue, { playerToken, dieId: d6s[1]._id, value: 2 });
  await t.mutation(setDieClaim, { playerToken, dieId: d20._id, claimedBy: hero });
  await t.mutation(setDieClaim, { playerToken, dieId: d6s[0]._id, claimedBy: hero });
  await t.mutation(setDieClaim, { playerToken, dieId: d6s[1]._id, claimedBy: hero });

  await t.mutation(confirm, {
    playerToken,
    actingCombatantId: hero,
    effectText: "hits",
    effects: [{ combatantId: goblin, hpDelta: -6 }],
  });

  const log = await t.query(getCombatLog, { playerToken, dmToken });
  expect(log).toHaveLength(1);
  const entry = log[0];
  expect(entry.actingName).toBe("Hero");
  expect(entry.actingCombatantId).toBe(hero);
  expect(entry.rollSummary).toBe("d20: 14 · 2d6: 4+2 = 6");
  expect(entry.effectText).toBe("hits");
  expect(entry.effects).toEqual([
    { combatantId: goblin, name: "Goblin", hpDelta: -6 },
  ]);
});

test("confirm without an acting combatant (DM-forced) works with empty roll summary", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const goblin = await t.mutation(add, {
    playerToken,
    name: "Goblin",
    kind: "enemy",
    maxHp: 10,
    ac: 13,
    initiative: 12,
    notes: "",
  });

  await t.mutation(confirm, {
    playerToken,
    effectText: "plot damage",
    effects: [{ combatantId: goblin, hpDelta: -3 }],
  });

  const state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.combatants.find((c: any) => c._id === goblin).hp).toBe(7);

  const log = await t.query(getCombatLog, { playerToken, dmToken });
  expect(log).toHaveLength(1);
  expect(log[0].actingName).toBe("DM");
  expect(log[0].actingCombatantId).toBeNull();
  expect(log[0].rollSummary).toBe("");
});

test("getCombatLog returns entries to both roles, most-recent first", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const goblin = await t.mutation(add, {
    playerToken,
    name: "Goblin",
    kind: "enemy",
    maxHp: 10,
    ac: 13,
    initiative: 12,
    notes: "",
  });

  await t.mutation(confirm, {
    playerToken,
    effectText: "first",
    effects: [{ combatantId: goblin, hpDelta: -1 }],
  });
  await t.mutation(confirm, {
    playerToken,
    effectText: "second",
    effects: [{ combatantId: goblin, hpDelta: -1 }],
  });

  const dmLog = await t.query(getCombatLog, { playerToken, dmToken });
  const playerLog = await t.query(getCombatLog, { playerToken });

  expect(dmLog.map((e: any) => e.effectText)).toEqual(["second", "first"]);
  expect(playerLog.map((e: any) => e.effectText)).toEqual(["second", "first"]);
});

test("confirm rejects a target combatant from a different game", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const { playerToken: otherPlayer } = await t.mutation(create, {});
  const otherCombatant = await t.mutation(add, {
    playerToken: otherPlayer,
    name: "Other",
    kind: "pc",
    maxHp: 10,
    ac: 12,
    initiative: 1,
    notes: "",
  });
  await expect(
    t.mutation(confirm, {
      playerToken,
      effectText: "x",
      effects: [{ combatantId: otherCombatant, hpDelta: -1 }],
    }),
  ).rejects.toThrow(/Combatant not found/);
});

// ---- Recipe-mode condition math (Stunned/Blinded/Petrified) ----

async function recipeSetup() {
  const t = newTestClient();
  const { playerToken, dmToken } = await t.mutation(create, {});
  const hero = await t.mutation(add, {
    playerToken, name: "Hero", kind: "pc", maxHp: 30, ac: 16, initiative: 10, notes: "",
  });
  const gob = await t.mutation(add, {
    playerToken, name: "Goblin", kind: "enemy", maxHp: 20, ac: 12, initiative: 8, notes: "",
  });
  return { t, playerToken, dmToken, hero, gob };
}


test("Stunned target auto-fails its DEX save (full damage even on a nat 20)", async () => {
  const { t, playerToken, dmToken, hero, gob } = await recipeSetup();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "Fireball", hitType: "save", attackMod: 0, damageDice: [{ type: "d6", count: 8 }], damageMod: 0, damageType: "fire", dc: 15, saveAbility: "dex", critImmune: false, resourceCost: 0, multiTarget: "none" },
  });
  await t.mutation(applyCondition, { playerToken, combatantId: gob, conditionKey: "stunned" });
  const state = await t.query(getGameState, { playerToken, dmToken });
  // 8d6 all 3 → 24 fire. Goblin claims a save d20 = 20 (would normally save: 20 ≥ 15).
  await claimDice(t, playerToken, state, hero, "d6", [3, 3, 3, 3, 3, 3, 3, 3]);
  await claimDice(t, playerToken, state, gob, "d20", [20]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "stunned!",
    recipeId: recipe, targets: [{ combatantId: gob }],
  });

  const after = await t.query(getGameState, { playerToken, dmToken });
  const g = after.combatants.find((c: any) => c.name === "Goblin")!;
  // Auto-fail → full 24 damage, clamped to 0 (not the half-damage a save would give).
  expect(g.hp).toBe(0);
  const log = await t.query(getCombatLog, { playerToken });
  expect(log[0].rollSummary).toContain("auto-fail");
  expect(log[0].rollSummary).toContain("FAIL");
});

test("attacks against a Blinded target resolve with advantage (2 d20s, takes the higher)", async () => {
  const { t, playerToken, dmToken, hero, gob } = await recipeSetup();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "Longsword", hitType: "attack", attackMod: 5, damageDice: [{ type: "d8", count: 1 }], damageMod: 3, damageType: "slashing", dc: 0, saveAbility: "", critImmune: false, resourceCost: 0, multiTarget: "none" },
  });
  await t.mutation(applyCondition, { playerToken, combatantId: gob, conditionKey: "blinded" });
  const state = await t.query(getGameState, { playerToken, dmToken });
  // Two d20s: [4, 18]. Advantage (target is Blinded) takes 18 → 18+5=23 ≥ AC 12 → HIT.
  // The low die (4+5=9 < 12) would miss on its own, so the advantage is load-bearing.
  await claimDice(t, playerToken, state, hero, "d20", [4, 18]);
  await claimDice(t, playerToken, state, hero, "d8", [6]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: gob }],
  });

  const after = await t.query(getGameState, { playerToken, dmToken });
  const g = after.combatants.find((c: any) => c.name === "Goblin")!;
  expect(g.hp).toBe(11); // 20 - (6+3)
  const log = await t.query(getCombatLog, { playerToken });
  expect(log[0].rollSummary).toContain("adv");
  expect(log[0].rollSummary).toContain("HIT");
});

test.each([
  ["A vs A+D", ["invisible"], ["blinded", "invisible"]],
  ["D vs A+D", ["blinded"], ["blinded", "invisible"]],
  ["A+D vs A", ["blinded", "invisible"], ["blinded"]],
  ["A+D vs D", ["blinded", "invisible"], ["invisible"]],
])("all attack sources resolve together: %s is neutral with one d20", async (_label, actorConditions, targetConditions) => {
  const { t, playerToken, dmToken, hero, gob } = await recipeSetup();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "Longsword", hitType: "attack", attackMod: 5, damageDice: [{ type: "d8", count: 1 }], damageMod: 3, damageType: "slashing", dc: 0, saveAbility: "", critImmune: false, resourceCost: 0, multiTarget: "none" },
  });
  for (const conditionKey of actorConditions) {
    await t.mutation(applyCondition, { playerToken, combatantId: hero, conditionKey });
  }
  for (const conditionKey of targetConditions) {
    await t.mutation(applyCondition, { playerToken, combatantId: gob, conditionKey });
  }
  const state = await t.query(getGameState, { playerToken, dmToken });
  // Each row has at least one advantage and one disadvantage across the whole roll.
  await claimDice(t, playerToken, state, hero, "d20", [4]);
  await claimDice(t, playerToken, state, hero, "d8", [6]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: gob }],
  });

  const after = await t.query(getGameState, { playerToken, dmToken });
  expect(after.combatants.find((c: any) => c.name === "Goblin")!.hp).toBe(20);
  const log = await t.query(getCombatLog, { playerToken });
  expect(log[0].rollSummary).toContain("MISS");
  expect(log[0].rollSummary).not.toContain("(adv)");
  expect(log[0].rollSummary).not.toContain("(disadv)");
});

test("manual advOverride 'advantage' on a clean target rolls 2 d20s and takes the higher", async () => {
  const { t, playerToken, dmToken, hero, gob } = await recipeSetup();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "Longsword", hitType: "attack", attackMod: 5, damageDice: [{ type: "d8", count: 1 }], damageMod: 3, damageType: "slashing", dc: 0, saveAbility: "", critImmune: false, resourceCost: 0, multiTarget: "none" },
  });
  // NO condition on the goblin — the advantage comes purely from the toggle.
  const state = await t.query(getGameState, { playerToken, dmToken });
  // [4, 18]: 4+5=9 would miss on its own; advantage takes 18 → 23 ≥ 12 HIT.
  await claimDice(t, playerToken, state, hero, "d20", [4, 18]);
  await claimDice(t, playerToken, state, hero, "d8", [6]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: gob, advOverride: "advantage" }],
  });

  const after = await t.query(getGameState, { playerToken, dmToken });
  const g = after.combatants.find((c: any) => c.name === "Goblin")!;
  expect(g.hp).toBe(11); // 20 - (6+3)
  const log = await t.query(getCombatLog, { playerToken });
  expect(log[0].rollSummary).toContain("adv");
  expect(log[0].rollSummary).toContain("HIT");
});

test("manual advOverride 'none' cancels a Blinded target's condition advantage (1 d20)", async () => {
  const { t, playerToken, dmToken, hero, gob } = await recipeSetup();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "Longsword", hitType: "attack", attackMod: 5, damageDice: [{ type: "d8", count: 1 }], damageMod: 3, damageType: "slashing", dc: 0, saveAbility: "", critImmune: false, resourceCost: 0, multiTarget: "none" },
  });
  await t.mutation(applyCondition, { playerToken, combatantId: gob, conditionKey: "blinded" });
  const state = await t.query(getGameState, { playerToken, dmToken });
  // Blinded would grant advantage (take 18 → HIT); the toggle forces neutral,
  // so only the FIRST claimed d20 counts: 4+5=9 < 12 → MISS.
  await claimDice(t, playerToken, state, hero, "d20", [4, 18]);
  await claimDice(t, playerToken, state, hero, "d8", [6]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: gob, advOverride: "none" }],
  });

  const after = await t.query(getGameState, { playerToken, dmToken });
  const g = after.combatants.find((c: any) => c.name === "Goblin")!;
  expect(g.hp).toBe(20); // untouched — the attack missed
  const log = await t.query(getCombatLog, { playerToken });
  expect(log[0].rollSummary).toContain("MISS");
  expect(log[0].rollSummary).not.toContain("(adv)");
});

test("manual advOverride 'disadvantage' on a save rolls 2 d20s and takes the lower", async () => {
  const { t, playerToken, dmToken, hero, gob } = await recipeSetup();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "Fireball", hitType: "save", attackMod: 0, damageDice: [{ type: "d6", count: 8 }], damageMod: 0, damageType: "fire", dc: 15, saveAbility: "dex", critImmune: false, resourceCost: 0, multiTarget: "none" },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  // 8d6 all 3 → 24 fire. Save d20s [20, 3]: alone the 20 saves (half damage);
  // forced disadvantage takes 3 → 3 < 15 FAIL → full 24 → hp clamps to 0.
  await claimDice(t, playerToken, state, hero, "d6", [3, 3, 3, 3, 3, 3, 3, 3]);
  await claimDice(t, playerToken, state, gob, "d20", [20, 3]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: gob, advOverride: "disadvantage" }],
  });

  const after = await t.query(getGameState, { playerToken, dmToken });
  const g = after.combatants.find((c: any) => c.name === "Goblin")!;
  expect(g.hp).toBe(0);
  const log = await t.query(getCombatLog, { playerToken });
  expect(log[0].rollSummary).toContain("disadv");
  expect(log[0].rollSummary).toContain("FAIL");
});

test("Case 1: a target-only advOverride no longer wipes the actor's own condition advantage", async () => {
  const { t, playerToken, dmToken, hero, gob } = await recipeSetup();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "Longsword", hitType: "attack", attackMod: 5, damageDice: [{ type: "d8", count: 1 }], damageMod: 3, damageType: "slashing", dc: 0, saveAbility: "", critImmune: false, resourceCost: 0, multiTarget: "none" },
  });
  // Actor is Poisoned (disadvantage on their own attack). Target's manual
  // toggle asks for "advantage" (attackAgainst) — before the fix this used to
  // REPLACE the net value outright (→ advantage); now it only supplies the
  // target's own component, which combines with the actor's disadvantage to
  // cancel to "none" per 5e (Case 1).
  await t.mutation(applyCondition, { playerToken, combatantId: hero, conditionKey: "poisoned" });
  const state = await t.query(getGameState, { playerToken, dmToken });
  // Net "none" → only 1 d20 needed. [4]: 4+5=9 < AC 12 → MISS.
  await claimDice(t, playerToken, state, hero, "d20", [4]);
  await claimDice(t, playerToken, state, hero, "d8", [6]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: gob, advOverride: "advantage" }],
  });

  const after = await t.query(getGameState, { playerToken, dmToken });
  const g = after.combatants.find((c: any) => c.name === "Goblin")!;
  expect(g.hp).toBe(20); // untouched — the attack missed (no free advantage from the target toggle)
  const log = await t.query(getCombatLog, { playerToken });
  expect(log[0].rollSummary).toContain("MISS");
  expect(log[0].rollSummary).not.toContain("(adv)");
});

test("Case 1: actorAdvOverride drives the attack roll independent of any target override", async () => {
  const { t, playerToken, dmToken, hero, gob } = await recipeSetup();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "Longsword", hitType: "attack", attackMod: 5, damageDice: [{ type: "d8", count: 1 }], damageMod: 3, damageType: "slashing", dc: 0, saveAbility: "", critImmune: false, resourceCost: 0, multiTarget: "none" },
  });
  // No conditions anywhere — the actor's manual toggle alone grants advantage.
  const state = await t.query(getGameState, { playerToken, dmToken });
  // [4, 18]: 4+5=9 would miss alone; advantage takes 18 → 23 ≥ 12 HIT.
  await claimDice(t, playerToken, state, hero, "d20", [4, 18]);
  await claimDice(t, playerToken, state, hero, "d8", [6]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, actorAdvOverride: "advantage", targets: [{ combatantId: gob }],
  });

  const after = await t.query(getGameState, { playerToken, dmToken });
  const g = after.combatants.find((c: any) => c.name === "Goblin")!;
  expect(g.hp).toBe(11); // 20 - (6+3)
  const log = await t.query(getCombatLog, { playerToken });
  expect(log[0].rollSummary).toContain("adv");
  expect(log[0].rollSummary).toContain("HIT");
});

test("Case 1 Extend: saveMode 'hitOrMiss' — a successful save means MISS, zero damage", async () => {
  const { t, playerToken, dmToken, hero, gob } = await recipeSetup();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "雷鳴爆", hitType: "save", attackMod: 0, damageDice: [{ type: "d6", count: 1 }], damageMod: 0, damageType: "thunder", dc: 15, saveAbility: "dex", critImmune: false, resourceCost: 0, multiTarget: "none" },
  });
  // d6=6 thunder; save d20 [20] ≥ 15 → success. Default mode would halve
  // (3 damage); hitOrMiss mode negates entirely — the Actor MISSED.
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, hero, "d6", [6]);
  await claimDice(t, playerToken, state, gob, "d20", [20]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe,
    targets: [{ combatantId: gob, saveMode: "hitOrMiss" }],
  });

  const after = await t.query(getGameState, { playerToken, dmToken });
  const g = after.combatants.find((c: any) => c.name === "Goblin")!;
  expect(g.hp).toBe(20); // untouched — the save negated everything
  const log = await t.query(getCombatLog, { playerToken });
  expect(log[0].rollSummary).toContain("MISS");
});

test("Case 1 Extend: saveMode 'hitOrMiss' — a failed save means HIT, full damage", async () => {
  const { t, playerToken, dmToken, hero, gob } = await recipeSetup();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "雷鳴爆", hitType: "save", attackMod: 0, damageDice: [{ type: "d6", count: 1 }], damageMod: 0, damageType: "thunder", dc: 15, saveAbility: "dex", critImmune: false, resourceCost: 0, multiTarget: "none" },
  });
  // Save d20 [3] < 15 → fail → full 6 damage, logged as HIT (not FAIL).
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, hero, "d6", [6]);
  await claimDice(t, playerToken, state, gob, "d20", [3]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe,
    targets: [{ combatantId: gob, saveMode: "hitOrMiss" }],
  });

  const after = await t.query(getGameState, { playerToken, dmToken });
  const g = after.combatants.find((c: any) => c.name === "Goblin")!;
  expect(g.hp).toBe(14); // 20 - 6 (full, no halving)
  const log = await t.query(getCombatLog, { playerToken });
  expect(log[0].rollSummary).toContain("HIT");
});

test("Case 1 Extend: the adv/disadv toggle drives the save roll in hitOrMiss mode too", async () => {
  const { t, playerToken, dmToken, hero, gob } = await recipeSetup();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "雷鳴爆", hitType: "save", attackMod: 0, damageDice: [{ type: "d6", count: 1 }], damageMod: 0, damageType: "thunder", dc: 15, saveAbility: "dex", critImmune: false, resourceCost: 0, multiTarget: "none" },
  });
  // Manual disadvantage → 2 save d20s, take the LOWER: [20, 3] → 3 < 15 →
  // fail → HIT, full 6 damage. Without the toggle the 20 would have saved.
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, hero, "d6", [6]);
  await claimDice(t, playerToken, state, gob, "d20", [20, 3]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe,
    targets: [{ combatantId: gob, advOverride: "disadvantage", saveMode: "hitOrMiss" }],
  });

  const after = await t.query(getGameState, { playerToken, dmToken });
  const g = after.combatants.find((c: any) => c.name === "Goblin")!;
  expect(g.hp).toBe(14); // 20 - 6
  const log = await t.query(getCombatLog, { playerToken });
  expect(log[0].rollSummary).toContain("disadv");
  expect(log[0].rollSummary).toContain("HIT");
});

// ---- Healing extra rolls + directed appliesMods ----

/** Like recipeSetup, but keeps the dmToken (enemy HP is withheld from players). */
async function healSetup() {
  const t = newTestClient();
  const { playerToken, dmToken } = await t.mutation(create, {});
  const hero = await t.mutation(add, {
    playerToken, name: "Hero", kind: "pc", maxHp: 30, ac: 16, initiative: 10, notes: "",
  });
  const gob = await t.mutation(add, {
    playerToken, name: "Goblin", kind: "enemy", maxHp: 20, ac: 12, initiative: 8, notes: "",
  });
  return { t, playerToken, dmToken, hero, gob };
}

test("healing extra roll heals the target on a hit (damage still applies)", async () => {
  const { t, playerToken, dmToken, hero, gob } = await healSetup();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "汲取之刃", hitType: "attack", attackMod: 5, damageDice: [{ type: "d8", count: 1 }], damageMod: 3, damageType: "slashing", dc: 0, saveAbility: "", critImmune: false, resourceCost: 0, multiTarget: "none",
      extraRolls: [{ label: "回復", usage: "battle", dice: [{ type: "d4", count: 1 }], damageMod: 2, damageType: "healing" }] },
  });
  // Damage the goblin to 10 so the heal is visible below maxHp.
  await t.mutation(confirm, { playerToken, effectText: "setup", effects: [{ combatantId: gob, hpDelta: -10 }] });
  const state = await t.query(getGameState, { playerToken, dmToken });
  // d20 14+5=19 ≥ 12 HIT → 6+3 = 9 slashing; heal rider d4 3+2 = +5.
  await claimDice(t, playerToken, state, hero, "d20", [14]);
  await claimDice(t, playerToken, state, hero, "d8", [6]);
  await claimDice(t, playerToken, state, hero, "d4", [3]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: gob }],
  });

  const after = await t.query(getGameState, { playerToken, dmToken });
  expect(after.combatants.find((c: any) => c._id === gob).hp).toBe(6); // 10 - 9 + 5
  const log = await t.query(getCombatLog, { playerToken });
  expect(log[0].rollSummary).toContain("回復 +5治療");
});

test("healing extra roll does nothing on a miss", async () => {
  const { t, playerToken, dmToken, hero, gob } = await healSetup();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "汲取之刃", hitType: "attack", attackMod: 5, damageDice: [{ type: "d8", count: 1 }], damageMod: 3, damageType: "slashing", dc: 0, saveAbility: "", critImmune: false, resourceCost: 0, multiTarget: "none",
      extraRolls: [{ label: "回復", usage: "battle", dice: [{ type: "d4", count: 1 }], damageMod: 2, damageType: "healing" }] },
  });
  await t.mutation(confirm, { playerToken, effectText: "setup", effects: [{ combatantId: gob, hpDelta: -10 }] });
  const state = await t.query(getGameState, { playerToken, dmToken });
  // d20 4+5=9 < 12 → MISS: no damage, no heal.
  await claimDice(t, playerToken, state, hero, "d20", [4]);
  await claimDice(t, playerToken, state, hero, "d8", [6]);
  await claimDice(t, playerToken, state, hero, "d4", [3]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: gob }],
  });

  const after = await t.query(getGameState, { playerToken, dmToken });
  expect(after.combatants.find((c: any) => c._id === gob).hp).toBe(10); // untouched
});

test("crit doubles a healing extra roll's dice (damage clamps at 0 first, then the heal lands)", async () => {
  const { t, playerToken, dmToken, hero, gob } = await healSetup();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "汲取之刃", hitType: "attack", attackMod: 5, damageDice: [{ type: "d8", count: 1 }], damageMod: 3, damageType: "slashing", dc: 0, saveAbility: "", critImmune: false, resourceCost: 0, multiTarget: "none",
      extraRolls: [{ label: "回復", usage: "battle", dice: [{ type: "d4", count: 1 }], damageMod: 2, damageType: "healing" }] },
  });
  await t.mutation(confirm, { playerToken, effectText: "setup", effects: [{ combatantId: gob, hpDelta: -10 }] });
  const state = await t.query(getGameState, { playerToken, dmToken });
  // Nat 20 → CRIT: damage (6×2)+3 = 15 → 10-15 clamps to 0; heal (3×2)+2 = +8.
  await claimDice(t, playerToken, state, hero, "d20", [20]);
  await claimDice(t, playerToken, state, hero, "d8", [6]);
  await claimDice(t, playerToken, state, hero, "d4", [3]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: gob }],
  });

  const after = await t.query(getGameState, { playerToken, dmToken });
  expect(after.combatants.find((c: any) => c._id === gob).hp).toBe(8);
});

test("save: a healing rider applies unhalved even on a successful save", async () => {
  const { t, playerToken, dmToken, hero, gob } = await healSetup();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "灼熱祝福", hitType: "save", attackMod: 0, damageDice: [{ type: "d6", count: 1 }], damageMod: 0, damageType: "fire", dc: 15, saveAbility: "dex", critImmune: false, resourceCost: 0, multiTarget: "none",
      extraRolls: [{ label: "回復", usage: "battle", dice: [{ type: "d4", count: 1 }], damageMod: 0, damageType: "healing" }] },
  });
  await t.mutation(confirm, { playerToken, effectText: "setup", effects: [{ combatantId: gob, hpDelta: -10 }] });
  const state = await t.query(getGameState, { playerToken, dmToken });
  // Save 20 ≥ 15 → success → main 6 fire halves to 3; heal d4 2 stays +2 (never halved).
  await claimDice(t, playerToken, state, hero, "d6", [6]);
  await claimDice(t, playerToken, state, hero, "d4", [2]);
  await claimDice(t, playerToken, state, gob, "d20", [20]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: gob }],
  });

  const after = await t.query(getGameState, { playerToken, dmToken });
  expect(after.combatants.find((c: any) => c._id === gob).hp).toBe(9); // 10 - 3 + 2
});

test("automatic heal: healing rider folds into the heal; damage rider applies as damage", async () => {
  const { t, playerToken, dmToken, hero, gob } = await healSetup();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "治療禱言", hitType: "automatic", attackMod: 0, damageDice: [{ type: "d8", count: 1 }], damageMod: 0, damageType: "healing", dc: 0, saveAbility: "", critImmune: false, resourceCost: 0, multiTarget: "none",
      extraRolls: [
        { label: "祝福", usage: "battle", dice: [{ type: "d4", count: 1 }], damageMod: 1, damageType: "healing" },
        { label: "聖火", usage: "battle", dice: [{ type: "d4", count: 1 }], damageMod: 0, damageType: "fire" },
      ] },
  });
  await t.mutation(confirm, { playerToken, effectText: "setup", effects: [{ combatantId: gob, hpDelta: -15 }] });
  const state = await t.query(getGameState, { playerToken, dmToken });
  // Heal = d8 4 + d4 2 + 1 = 7 → 5+7 = 12; then fire rider d4 3 → 12-3 = 9.
  await claimDice(t, playerToken, state, hero, "d8", [4]);
  await claimDice(t, playerToken, state, hero, "d4", [2, 3]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: gob }],
  });

  const after = await t.query(getGameState, { playerToken, dmToken });
  expect(after.combatants.find((c: any) => c._id === gob).hp).toBe(9);
});

test("flat-amount heal (Heal, 70): no dice, damageMod-only healing recipe heals capped at maxHp", async () => {
  const { t, playerToken, dmToken, hero, gob } = await healSetup();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "醫療術", hitType: "automatic", attackMod: 0, damageDice: [], damageMod: 70, damageType: "healing", dc: 0, saveAbility: "", critImmune: false, resourceCost: 0, multiTarget: "none" },
  });
  // Goblin down to 5 of 20 → +70 caps at maxHp, never subtracts.
  await t.mutation(confirm, { playerToken, effectText: "setup", effects: [{ combatantId: gob, hpDelta: -15 }] });

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: gob }],
  });

  const after = await t.query(getGameState, { playerToken, dmToken });
  expect(after.combatants.find((c: any) => c._id === gob).hp).toBe(20);
});

test("appliesMods healing row: instant full heal to EACH checked target, capped, no chip", async () => {
  const { t, playerToken, dmToken, hero, gob } = await healSetup();
  const ally = await t.mutation(add, {
    playerToken, name: "Ally", kind: "pc", maxHp: 20, ac: 14, initiative: 5, notes: "",
  });
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "群體治療", hitType: "automatic", attackMod: 0, damageDice: [], damageMod: 0, damageType: "force", dc: 0, saveAbility: "", critImmune: false, resourceCost: 0, multiTarget: "aoe",
      appliesMods: [{ stat: "healing", mode: "bonus", value: 3, dice: [{ type: "d8", count: 1 }], direction: "targets" }] },
  });
  await t.mutation(confirm, { playerToken, effectText: "setup", effects: [{ combatantId: gob, hpDelta: -15 }] });
  const state = await t.query(getGameState, { playerToken, dmToken });
  // Heal row d8 6 + 3 = 9 to EACH: goblin 5→14; ally already full → capped at 20.
  await claimDice(t, playerToken, state, hero, "d8", [6]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe,
    targets: [{ combatantId: gob }, { combatantId: ally }],
    modTargets: [{ modIndex: 0, combatantIds: [gob, ally] }],
  });

  const after = await t.query(getGameState, { playerToken, dmToken });
  const g = after.combatants.find((c: any) => c._id === gob);
  const a = after.combatants.find((c: any) => c._id === ally);
  expect(g.hp).toBe(14);
  expect(a.hp).toBe(20); // capped at maxHp
  expect(g.effects).toHaveLength(0); // instant — no chip to toggle
  expect(a.effects).toHaveLength(0);
  const log = await t.query(getCombatLog, { playerToken });
  expect(log[0].rollSummary).toContain("heals +9");
});

test("appliesMods direction 'self': heal and chip land on the actor, not the target", async () => {
  const { t, playerToken, dmToken, hero, gob } = await healSetup();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "薩滿之怒", hitType: "automatic", attackMod: 0, damageDice: [], damageMod: 0, damageType: "force", dc: 0, saveAbility: "", critImmune: false, resourceCost: 0, multiTarget: "none",
      appliesMods: [
        { stat: "healing", mode: "bonus", value: 5, direction: "self" },
        { stat: "attack", mode: "advantage", value: 0, direction: "self" },
      ] },
  });
  await t.mutation(confirm, { playerToken, effectText: "setup", effects: [{ combatantId: hero, hpDelta: -10 }] });

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: gob }], modTargets: [],
  });

  const after = await t.query(getGameState, { playerToken, dmToken });
  const h = after.combatants.find((c: any) => c._id === hero);
  const g = after.combatants.find((c: any) => c._id === gob);
  expect(h.hp).toBe(25); // 20 + 5, no dice
  expect(h.effects).toHaveLength(1); // the advantage chip — healing row left none
  expect(h.effects[0].label).toBe("薩滿之怒");
  expect(h.effects[0].specs).toHaveLength(1);
  expect(g.effects).toHaveLength(0);
});

test("appliesMods tempHp row (False Life): dice+value granted to the caster, no chip, hp untouched", async () => {
  const { t, playerToken, dmToken, hero, gob } = await healSetup();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "虛假生命術", hitType: "automatic", attackMod: 0, damageDice: [], damageMod: 0, damageType: "", dc: 0, saveAbility: "", critImmune: false, resourceCost: 0, multiTarget: "none",
      appliesMods: [{ stat: "tempHp", mode: "bonus", value: 4, dice: [{ type: "d4", count: 1 }], direction: "self" }] },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, hero, "d4", [3]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: hero }], modTargets: [],
  });

  const after = await t.query(getGameState, { playerToken, dmToken });
  const h = after.combatants.find((c: any) => c._id === hero);
  const g = after.combatants.find((c: any) => c._id === gob);
  expect(h.tempHp).toBe(7); // d4 3 + 4 — instant grant, direction self
  expect(h.hp).toBe(30); // NOT healing — real HP untouched
  expect(h.effects).toHaveLength(0); // instant — no chip to toggle
  expect(g.tempHp ?? 0).toBe(0);
  const log = await t.query(getCombatLog, { playerToken });
  expect(log[0].rollSummary).toContain("+7臨時");
});

test("tempHp grants don't stack: keep the larger pool (PHB p.198)", async () => {
  const { t, playerToken, dmToken, hero } = await healSetup();
  const grantRecipe = async (value: number) =>
    t.mutation(addRecipe, {
      playerToken, combatantId: hero,
      recipe: { name: `臨時${value}`, hitType: "automatic", attackMod: 0, damageDice: [], damageMod: 0, damageType: "", dc: 0, saveAbility: "", critImmune: false, resourceCost: 0, multiTarget: "none",
        appliesMods: [{ stat: "tempHp", mode: "bonus", value, direction: "self" }] },
    });
  const confirmGrant = async (recipeId: any) =>
    t.mutation(confirm, {
      playerToken, actingCombatantId: hero, effectText: "",
      recipeId, targets: [{ combatantId: hero }], modTargets: [],
    });
  const heroTempHp = async () => {
    const s = await t.query(getGameState, { playerToken, dmToken });
    return s.combatants.find((c: any) => c._id === hero).tempHp;
  };

  await confirmGrant(await grantRecipe(10));
  expect(await heroTempHp()).toBe(10);
  await confirmGrant(await grantRecipe(8));
  expect(await heroTempHp()).toBe(10); // smaller grant — keep existing pool
  await confirmGrant(await grantRecipe(12));
  expect(await heroTempHp()).toBe(12); // larger grant — take the new pool
});

test("tempHp and healing rows on one recipe don't interfere (cursor order = row order)", async () => {
  const { t, playerToken, dmToken, hero, gob } = await healSetup();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "混合祝福", hitType: "automatic", attackMod: 0, damageDice: [], damageMod: 0, damageType: "", dc: 0, saveAbility: "", critImmune: false, resourceCost: 0, multiTarget: "none",
      appliesMods: [
        { stat: "healing", mode: "bonus", value: 1, dice: [{ type: "d8", count: 1 }], direction: "targets" },
        { stat: "tempHp", mode: "bonus", value: 2, dice: [{ type: "d4", count: 1 }], direction: "self" },
      ] },
  });
  await t.mutation(confirm, { playerToken, effectText: "setup", effects: [{ combatantId: gob, hpDelta: -15 }] });
  const state = await t.query(getGameState, { playerToken, dmToken });
  // Heal row d8 6 + 1 = +7 to the goblin; tempHp row d4 3 + 2 = 5 to the caster.
  await claimDice(t, playerToken, state, hero, "d8", [6]);
  await claimDice(t, playerToken, state, hero, "d4", [3]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: gob }],
    modTargets: [{ modIndex: 0, combatantIds: [gob] }],
  });

  const after = await t.query(getGameState, { playerToken, dmToken });
  const h = after.combatants.find((c: any) => c._id === hero);
  const g = after.combatants.find((c: any) => c._id === gob);
  expect(g.hp).toBe(12); // 5 + 7 healing
  expect(g.tempHp ?? 0).toBe(0);
  expect(h.tempHp).toBe(5);
  expect(h.hp).toBe(30);
});

test("legacy appliesMods (no direction, no modTargets) still chips targets[0] only", async () => {
  const { t, playerToken, dmToken, hero, gob } = await healSetup();
  const ally = await t.mutation(add, {
    playerToken, name: "Ally", kind: "pc", maxHp: 20, ac: 14, initiative: 5, notes: "",
  });
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "護盾術", hitType: "automatic", attackMod: 0, damageDice: [], damageMod: 0, damageType: "force", dc: 0, saveAbility: "", critImmune: false, resourceCost: 0, multiTarget: "aoe",
      appliesMods: [{ stat: "ac", mode: "bonus", value: 5 }] },
  });

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: gob }, { combatantId: ally }],
  });

  const after = await t.query(getGameState, { playerToken, dmToken });
  const g = after.combatants.find((c: any) => c._id === gob);
  const a = after.combatants.find((c: any) => c._id === ally);
  expect(g.effects).toHaveLength(1);
  expect(g.effects[0].label).toBe("護盾術");
  expect(a.effects).toHaveLength(0);
});

test("Petrified target resists ALL damage (halved)", async () => {
  const { t, playerToken, dmToken, hero, gob } = await recipeSetup();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "Longsword", hitType: "attack", attackMod: 5, damageDice: [{ type: "d8", count: 1 }], damageMod: 3, damageType: "slashing", dc: 0, saveAbility: "", critImmune: false, resourceCost: 0, multiTarget: "none" },
  });
  await t.mutation(applyCondition, { playerToken, combatantId: gob, conditionKey: "petrified" });
  const state = await t.query(getGameState, { playerToken, dmToken });
  // Petrified grants attacks-against advantage → 2 d20s. [14, 2] → max 14 → 14+5=19 ≥ 12 HIT.
  await claimDice(t, playerToken, state, hero, "d20", [14, 2]);
  await claimDice(t, playerToken, state, hero, "d8", [6]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: gob }],
  });

  const after = await t.query(getGameState, { playerToken, dmToken });
  const g = after.combatants.find((c: any) => c.name === "Goblin")!;
  // 6+3 = 9 slashing → resist-all halves (floor) → 4 damage. 20-4 = 16.
  expect(g.hp).toBe(16);
});
