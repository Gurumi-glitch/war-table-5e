import { test, expect } from "vitest";
import { claimDice, newGameWithCombatants } from "./testHelper";
import { getGameState } from "../convex/games";
import { add as addCombatant, update as updateCombatant } from "../convex/combatants";
import { setDieClaim, setDieValue } from "../convex/dice";
import { confirm, getCombatLog } from "../convex/combatLog";
import { add as addRecipe, update as updateRecipe } from "../convex/recipes";
import { add as addResource } from "../convex/resources";
import { addCustomModifier } from "../convex/effects";

/**
 * Backend-seam tests for the recipe rules engine at Confirm (issue #7). The
 * engine reads claimed dice server-side and resolves attack/save/automatic/
 * healing with R/V/I, crits, force overrides, and resource consumption. Manual
 * mode (no recipe) remains backward-compatible. Open-buttons (player token only).
 */



test("attack recipe: d20+mod ≥ AC hits and applies damage; claims release after", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "Longsword", hitType: "attack", attackMod: 5, damageDice: [{ type: "d8", count: 1 }], damageMod: 3, damageType: "slashing", dc: 0, saveAbility: "", critImmune: false, resourceCost: 0, multiTarget: "none" },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  // d20=14 (+5 =19 ≥ AC 12), d8=6 (+3 =9 slashing).
  await claimDice(t, playerToken, state, hero, "d20", [14]);
  await claimDice(t, playerToken, state, hero, "d8", [6]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "swing",
    recipeId: recipe, targets: [{ combatantId: gob }],
  });

  const after = await t.query(getGameState, { playerToken, dmToken });
  const g = after.combatants.find((c: any) => c.name === "Goblin")!;
  expect(g.hp).toBe(11); // 20 - 9

  // Acting combatant's claimed dice released.
  const stillClaimed = after.dice.filter((d: any) => d.claimedBy === hero);
  expect(stillClaimed).toHaveLength(0);

  // Log entry recorded with a HIT summary.
  const log = await t.query(getCombatLog, { playerToken });
  expect(log[0].rollSummary).toContain("HIT");
  expect(log[0].effects).toEqual([{ combatantId: gob, name: "Goblin", hpDelta: -9 }]);
});

test("attack nat 20 crits: damage dice doubled, modifier not", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "Longsword", hitType: "attack", attackMod: 5, damageDice: [{ type: "d8", count: 1 }], damageMod: 3, damageType: "slashing", dc: 0, saveAbility: "", critImmune: false, resourceCost: 0, multiTarget: "none" },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, hero, "d20", [20]);
  await claimDice(t, playerToken, state, hero, "d8", [4]);
  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "", recipeId: recipe, targets: [{ combatantId: gob }],
  });
  const after = await t.query(getGameState, { playerToken, dmToken });
  // 4*2 (crit) + 3 = 11 → 20-11 = 9
  expect(after.combatants.find((c: any) => c.name === "Goblin")!.hp).toBe(9);
});

test("attack miss: nat 1 / low roll deals no damage", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "Longsword", hitType: "attack", attackMod: 5, damageDice: [{ type: "d8", count: 1 }], damageMod: 3, damageType: "slashing", dc: 0, saveAbility: "", critImmune: false, resourceCost: 0, multiTarget: "none" },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, hero, "d20", [1]); // nat 1 miss
  await claimDice(t, playerToken, state, hero, "d8", [6]);
  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "", recipeId: recipe, targets: [{ combatantId: gob }],
  });
  const after = await t.query(getGameState, { playerToken, dmToken });
  expect(after.combatants.find((c: any) => c.name === "Goblin")!.hp).toBe(20); // unchanged
});

test("save recipe: fail = full damage, success = half; target's claimed d20 is the save", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "Fireball", hitType: "save", attackMod: 0, damageDice: [{ type: "d6", count: 8 }], damageMod: 0, damageType: "fire", dc: 15, saveAbility: "dex", critImmune: false, resourceCost: 0, multiTarget: "none" },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  // Caster claims 8d6 (each 3 → 24). Target claims a d20 for its save.
  await claimDice(t, playerToken, state, hero, "d6", [3, 3, 3, 3, 3, 3, 3, 3]);

  // Fail: save d20 = 5 (+0 = 5 < 15) → full 24, clamped to 0.
  await claimDice(t, playerToken, state, gob, "d20", [5]);
  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "", recipeId: recipe, targets: [{ combatantId: gob }],
  });
  let after = await t.query(getGameState, { playerToken, dmToken });
  expect(after.combatants.find((c: any) => c.name === "Goblin")!.hp).toBe(0); // 20 - 24 clamped to 0

  // Reset goblin HP, re-claim a fresh save d20 = 16 (success → half of 24 = 12).
  await t.mutation(updateCombatant, { playerToken, combatantId: gob, patch: { hp: 20 } });
  const state2 = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state2, hero, "d6", [3, 3, 3, 3, 3, 3, 3, 3]);
  await claimDice(t, playerToken, state2, gob, "d20", [16]);
  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "", recipeId: recipe, targets: [{ combatantId: gob }],
  });
  after = await t.query(getGameState, { playerToken, dmToken });
  expect(after.combatants.find((c: any) => c.name === "Goblin")!.hp).toBe(8); // 20 - 12
});

test("R/V/I: fire immunity negates Fireball damage", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  // Make the Goblin immune to fire.
  await t.mutation(updateCombatant, { playerToken, combatantId: gob, patch: { immune: ["fire"] } });
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "Fireball", hitType: "save", attackMod: 0, damageDice: [{ type: "d6", count: 8 }], damageMod: 0, damageType: "fire", dc: 15, saveAbility: "dex", critImmune: false, resourceCost: 0, multiTarget: "none" },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, hero, "d6", [6, 6, 6, 6, 6, 6, 6, 6]);
  await claimDice(t, playerToken, state, gob, "d20", [5]); // fail
  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "", recipeId: recipe, targets: [{ combatantId: gob }],
  });
  const after = await t.query(getGameState, { playerToken, dmToken });
  expect(after.combatants.find((c: any) => c.name === "Goblin")!.hp).toBe(20); // immune → 0 damage
});

test("healing recipe caps at maxHp and subtracts from a Resource pool", async () => {
  const { t, playerToken, dmToken, hero } = await newGameWithCombatants();
  // Hero down to 10 HP.
  await t.mutation(updateCombatant, { playerToken, combatantId: hero, patch: { hp: 10 } });
  const res = await t.mutation(addResource, {
    playerToken, combatantId: hero, label: "Spell Slots", max: 4,
  });
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "Cure Wounds", hitType: "automatic", attackMod: 0, damageDice: [{ type: "d8", count: 1 }], damageMod: 3, damageType: "healing", dc: 0, saveAbility: "", critImmune: true, resourceId: res, resourceCost: 1, multiTarget: "none" },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, hero, "d8", [8]); // heal 8+3 = 11 → 10+11 = 21 (≤ maxHp 30)
  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "heal self",
    recipeId: recipe, targets: [{ combatantId: hero }],
  });
  const after = await t.query(getGameState, { playerToken, dmToken });
  const h = after.combatants.find((c: any) => c.name === "Hero")!;
  expect(h.hp).toBe(21);
  expect(h.resources[0].current).toBe(3); // 4 - 1
});

test("healing caps at maxHp (no overheal)", async () => {
  const { t, playerToken, dmToken, hero } = await newGameWithCombatants();
  // Hero at 28/30; heal 8 → cap at 30 (only +2).
  await t.mutation(updateCombatant, { playerToken, combatantId: hero, patch: { hp: 28 } });
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "Potion", hitType: "automatic", attackMod: 0, damageDice: [{ type: "d8", count: 1 }], damageMod: 3, damageType: "healing", dc: 0, saveAbility: "", critImmune: true, resourceCost: 0, multiTarget: "none" },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, hero, "d8", [8]); // 8+3 = 11
  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "", recipeId: recipe, targets: [{ combatantId: hero }],
  });
  const after = await t.query(getGameState, { playerToken, dmToken });
  expect(after.combatants.find((c: any) => c.name === "Hero")!.hp).toBe(30);
});

test("DM force overrides: force miss → no damage; forceDamage → exact", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "Longsword", hitType: "attack", attackMod: 5, damageDice: [{ type: "d8", count: 1 }], damageMod: 3, damageType: "slashing", dc: 0, saveAbility: "", critImmune: false, resourceCost: 0, multiTarget: "none" },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, hero, "d20", [20]); // would crit-hit
  await claimDice(t, playerToken, state, hero, "d8", [6]);
  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "fudged",
    recipeId: recipe, targets: [{ combatantId: gob, forceOutcome: "miss" }],
  });
  let after = await t.query(getGameState, { playerToken, dmToken });
  expect(after.combatants.find((c: any) => c.name === "Goblin")!.hp).toBe(20); // forced miss

  // Force a specific damage on a fresh confirm.
  await claimDice(t, playerToken, after, hero, "d20", [14]);
  await claimDice(t, playerToken, after, hero, "d8", [6]);
  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "fudged",
    recipeId: recipe, targets: [{ combatantId: gob, forceDamage: 7 }],
  });
  after = await t.query(getGameState, { playerToken, dmToken });
  expect(after.combatants.find((c: any) => c.name === "Goblin")!.hp).toBe(13); // 20 - 7
});

test("manual mode still works (no recipeId): applies HP deltas directly", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "poke",
    effects: [{ combatantId: gob, hpDelta: -6 }],
  });
  const after = await t.query(getGameState, { playerToken, dmToken });
  expect(after.combatants.find((c: any) => c.name === "Goblin")!.hp).toBe(14);
});

test("buff recipe (Shield): applies AC mod as a toggleable effect on the target, no HP change", async () => {
  const { t, playerToken, dmToken, hero } = await newGameWithCombatants();
  // Shield: automatic, no dice, no damage — just grants +5 AC to the target.
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: {
      name: "Shield", hitType: "automatic", attackMod: 0, damageDice: [], damageMod: 0,
      damageType: "", dc: 0, saveAbility: "", critImmune: true, resourceCost: 0,
      multiTarget: "none",
      appliesMods: [{ stat: "ac", mode: "bonus", value: 5, note: "Shield — 1 round" }],
    },
  });
  // Self-cast: target = the actor. No dice need to be claimed (automatic, no damage/heal).
  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "react: Shield",
    recipeId: recipe, targets: [{ combatantId: hero }],
  });

  const after = await t.query(getGameState, { playerToken, dmToken });
  const h = after.combatants.find((c: any) => c.name === "Hero")!;
  // No HP change (pure buff).
  expect(h.hp).toBe(30);
  // One active effect row was created on the target, labeled with the recipe name.
  expect(h.effects).toHaveLength(1);
  expect(h.effects[0]).toMatchObject({
    type: "custom", label: "Shield", active: true,
  });
  expect(h.effects[0].specs).toEqual([{ stat: "ac", mode: "bonus", value: 5, note: "Shield — 1 round" }]);
  // Effective AC reflects the buff: base 16 + 5 = 21.
  expect(h.effectiveAc.value).toBe(21);
  expect(h.effectiveAc.bonus).toBe(5);

  // The log records the granted buff.
  const log = await t.query(getCombatLog, { playerToken });
  expect(log[0].rollSummary).toContain("+5 ac");
  expect(log[0].rollSummary).toContain("Shield");
});

test("buff effect is revertible: toggling it off drops the AC bonus back to base", async () => {
  const { t, playerToken, dmToken, hero } = await newGameWithCombatants();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: {
      name: "Shield", hitType: "automatic", attackMod: 0, damageDice: [], damageMod: 0,
      damageType: "", dc: 0, saveAbility: "", critImmune: true, resourceCost: 0,
      multiTarget: "none",
      appliesMods: [{ stat: "ac", mode: "bonus", value: 5 }],
    },
  });
  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: hero }],
  });
  let after = await t.query(getGameState, { playerToken, dmToken });
  const effectId = after.combatants.find((c: any) => c.name === "Hero")!.effects[0]._id;
  expect(after.combatants.find((c: any) => c.name === "Hero")!.effectiveAc.value).toBe(21);

  // Toggle the Shield effect off (reuses the #5 reversal lever).
  const { toggleEffect } = await import("../convex/effects");
  await t.mutation(toggleEffect, { playerToken, effectId, active: false });

  after = await t.query(getGameState, { playerToken, dmToken });
  const h = after.combatants.find((c: any) => c.name === "Hero")!;
  expect(h.effectiveAc.value).toBe(16); // back to base — Shield's round ended
});

test("recipe mode works with just the player token (open-buttons ethos)", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "Longsword", hitType: "attack", attackMod: 5, damageDice: [{ type: "d8", count: 1 }], damageMod: 3, damageType: "slashing", dc: 0, saveAbility: "", critImmune: false, resourceCost: 0, multiTarget: "none" },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, hero, "d20", [14]);
  await claimDice(t, playerToken, state, hero, "d8", [6]);
  // No dmToken anywhere.
  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: gob }],
  });
  const after = await t.query(getGameState, { playerToken, dmToken });
  expect(after.combatants.find((c: any) => c.name === "Goblin")!.hp).toBe(11);
});

test("a custom 'attack: bonus' modifier on the actor adds to the to-hit roll (previously silently ignored)", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "Longsword", hitType: "attack", attackMod: 5, damageDice: [{ type: "d8", count: 1 }], damageMod: 3, damageType: "slashing", dc: 0, saveAbility: "", critImmune: false, resourceCost: 0, multiTarget: "none" },
  });
  await t.mutation(addCustomModifier, {
    playerToken, combatantId: hero, label: "+3 to hit",
    specs: [{ stat: "attack", mode: "bonus", value: 3 }],
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  // 8 + 5(recipe) + 3(modifier) = 16 ≥ AC 12 → hit. Without the modifier this misses (13 < ... wait AC 12, 13≥12 hits anyway) —
  // use a target with AC 17 so ONLY the +3 modifier makes it land.
  await t.mutation(updateCombatant, { playerToken, combatantId: gob, patch: { ac: 17 } });
  await claimDice(t, playerToken, state, hero, "d20", [9]); // 9+5=14 <17 (would miss); 9+5+3=17 ≥17 hits
  await claimDice(t, playerToken, state, hero, "d8", [6]);
  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: gob }],
  });
  const after = await t.query(getGameState, { playerToken, dmToken });
  expect(after.combatants.find((c: any) => c.name === "Goblin")!.hp).toBe(11); // 20 - 9, so it hit
});

test("a custom 'attackAgainst: bonus' modifier on the target adds to the attacker's roll against them", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  await t.mutation(updateCombatant, { playerToken, combatantId: gob, patch: { ac: 17 } });
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "Longsword", hitType: "attack", attackMod: 5, damageDice: [{ type: "d8", count: 1 }], damageMod: 3, damageType: "slashing", dc: 0, saveAbility: "", critImmune: false, resourceCost: 0, multiTarget: "none" },
  });
  await t.mutation(addCustomModifier, {
    playerToken, combatantId: gob, label: "Marked (+3 to hit against)",
    specs: [{ stat: "attackAgainst", mode: "bonus", value: 3 }],
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, hero, "d20", [9]); // 9+5=14 <17; +3 from target's marker = 17 ≥17 hits
  await claimDice(t, playerToken, state, hero, "d8", [6]);
  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: gob }],
  });
  const after = await t.query(getGameState, { playerToken, dmToken });
  expect(after.combatants.find((c: any) => c.name === "Goblin")!.hp).toBe(11); // 20 - 9, so it hit
});

test("attack advantage + attackAgainst disadvantage from different sources cancel to neutral (1 d20, not 2)", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "Longsword", hitType: "attack", attackMod: 5, damageDice: [{ type: "d8", count: 1 }], damageMod: 3, damageType: "slashing", dc: 0, saveAbility: "", critImmune: false, resourceCost: 0, multiTarget: "none" },
  });
  // Actor has a custom "attack: advantage"; target has a custom "attackAgainst: disadvantage" —
  // opposite sources, still cancel per 5e (any adv + any dis = none).
  await t.mutation(addCustomModifier, {
    playerToken, combatantId: hero, label: "Adv self",
    specs: [{ stat: "attack", mode: "advantage", value: 0 }],
  });
  await t.mutation(addCustomModifier, {
    playerToken, combatantId: gob, label: "Dis vs me",
    specs: [{ stat: "attackAgainst", mode: "disadvantage", value: 0 }],
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, hero, "d20", [14]); // only 1 needed — cancelled to neutral
  await claimDice(t, playerToken, state, hero, "d8", [6]);
  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: gob }],
  });
  const after = await t.query(getGameState, { playerToken, dmToken });
  expect(after.combatants.find((c: any) => c.name === "Goblin")!.hp).toBe(11); // 20 - 9, resolved with 1 d20
  const log = await t.query(getCombatLog, { playerToken });
  expect(log[0].rollSummary).not.toContain("adv");
  expect(log[0].rollSummary).not.toContain("disadv");
});

test("a custom 'save: override' modifier fixes the save bonus, replacing card save + manual bonus", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "Fireball", hitType: "save", attackMod: 0, damageDice: [{ type: "d6", count: 8 }], damageMod: 0, damageType: "fire", dc: 15, saveAbility: "dex", critImmune: false, resourceCost: 0, multiTarget: "none" },
  });
  // Override the goblin's save bonus to +10 (its actual card save is 0/unlinked).
  await t.mutation(addCustomModifier, {
    playerToken, combatantId: gob, label: "Save fixed at +10",
    specs: [{ stat: "save", mode: "override", value: 10 }],
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, hero, "d6", [3, 3, 3, 3, 3, 3, 3, 3]); // 24 fire
  await claimDice(t, playerToken, state, gob, "d20", [6]); // 6+10=16 ≥15 → save (half); without override 6+0=6<15 fail
  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: gob }],
  });
  const after = await t.query(getGameState, { playerToken, dmToken });
  expect(after.combatants.find((c: any) => c.name === "Goblin")!.hp).toBe(8); // 20 - 12 (half of 24)
});

test("rollInitiative with a custom 'initiative: advantage' modifier stays in [1+mod, 20+mod] (no crash, no overflow)", async () => {
  const { t, playerToken, dmToken, hero } = await newGameWithCombatants();
  await t.mutation(addCustomModifier, {
    playerToken, combatantId: hero, label: "Adv: Initiative",
    specs: [{ stat: "initiative", mode: "advantage", value: 0 }],
  });
  const { rollInitiative } = await import("../convex/combatants");
  // The actual "roll 2, take the higher" logic is covered deterministically by
  // rollD20WithAdvantage's unit tests (dice.helpers.test.ts); this just checks
  // rollInitiative wires advantageFor("initiative") through without error and
  // the result stays in range (rollInitiative's own rng isn't injectable).
  await t.mutation(rollInitiative, { playerToken });
  const state = await t.query(getGameState, { playerToken, dmToken });
  const init = state.combatants.find((c: any) => c.name === "Hero")!.initiative;
  expect(init).toBeGreaterThanOrEqual(1);
  expect(init).toBeLessThanOrEqual(20);
});

test("manual damageType override changes R/V/I lookup for the resolution", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  // Goblin is immune to fire but not to cold.
  await t.mutation(updateCombatant, { playerToken, combatantId: gob, patch: { immune: ["fire"] } });
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "Firebolt", hitType: "attack", attackMod: 5, damageDice: [{ type: "d8", count: 1 }], damageMod: 3, damageType: "fire", dc: 0, saveAbility: "", critImmune: false, resourceCost: 0, multiTarget: "none" },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, hero, "d20", [14]); // 14+5=19 ≥ AC 12 hit
  await claimDice(t, playerToken, state, hero, "d8", [6]); // 6+3=9

  // Fire is immune → 0, so the recipe's OWN damage type would deal no damage.
  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: gob }],
  });
  let after = await t.query(getGameState, { playerToken, dmToken });
  expect(after.combatants.find((c: any) => c.name === "Goblin")!.hp).toBe(20); // immune, no damage

  // Override to cold (not immune) → the same 9 damage now lands.
  await claimDice(t, playerToken, after, hero, "d20", [14]);
  await claimDice(t, playerToken, after, hero, "d8", [6]);
  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, damageType: "cold", targets: [{ combatantId: gob }],
  });
  after = await t.query(getGameState, { playerToken, dmToken });
  expect(after.combatants.find((c: any) => c.name === "Goblin")!.hp).toBe(11); // 20 - 9
  const log = await t.query(getCombatLog, { playerToken });
  expect(log[0].rollSummary).toContain("9");
});

test("battle-usage extraRoll adds a second damage roll (own type) to an attack that hits", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: {
      name: "Flame Tongue", hitType: "attack", attackMod: 5,
      damageDice: [{ type: "d8", count: 1 }], damageMod: 3, damageType: "slashing",
      dc: 0, saveAbility: "", critImmune: false, resourceCost: 0, multiTarget: "none",
      extraRolls: [
        { label: "Fire Rider", usage: "battle", dice: [{ type: "d6", count: 1 }], damageMod: 0, damageType: "fire" },
      ],
    },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  // d20=14 (+5=19≥12 hit), d8=6 (main dmg 6+3=9), d6=4 (rider +4 fire).
  await claimDice(t, playerToken, state, hero, "d20", [14]);
  await claimDice(t, playerToken, state, hero, "d8", [6]);
  await claimDice(t, playerToken, state, hero, "d6", [4]);
  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: gob }],
  });
  const after = await t.query(getGameState, { playerToken, dmToken });
  expect(after.combatants.find((c: any) => c.name === "Goblin")!.hp).toBe(7); // 20 - (9+4)
  const log = await t.query(getCombatLog, { playerToken });
  expect(log[0].rollSummary).toContain("Fire Rider +4");
});

test("battle-usage extraRoll does NOT apply when the attack misses", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: {
      name: "Flame Tongue", hitType: "attack", attackMod: 5,
      damageDice: [{ type: "d8", count: 1 }], damageMod: 3, damageType: "slashing",
      dc: 0, saveAbility: "", critImmune: false, resourceCost: 0, multiTarget: "none",
      extraRolls: [
        { label: "Fire Rider", usage: "battle", dice: [{ type: "d6", count: 1 }], damageMod: 0, damageType: "fire" },
      ],
    },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, hero, "d20", [1]); // nat 1 miss
  await claimDice(t, playerToken, state, hero, "d8", [6]);
  await claimDice(t, playerToken, state, hero, "d6", [4]);
  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: gob }],
  });
  const after = await t.query(getGameState, { playerToken, dmToken });
  expect(after.combatants.find((c: any) => c.name === "Goblin")!.hp).toBe(20); // untouched
});

test("roleplay-usage extraRoll is claimed and noted in the log, with no damage effect", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: {
      name: "Thunderwave", hitType: "save", attackMod: 0,
      damageDice: [{ type: "d8", count: 2 }], damageMod: 0, damageType: "thunder",
      dc: 13, saveAbility: "con", critImmune: true, resourceCost: 0, multiTarget: "none",
      extraRolls: [
        { label: "Push direction", usage: "roleplay", dice: [{ type: "d4", count: 1 }], damageMod: 0, damageType: "" },
      ],
    },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, hero, "d8", [4, 4]); // 8 thunder
  await claimDice(t, playerToken, state, hero, "d4", [3]); // push-direction flavor roll
  await claimDice(t, playerToken, state, gob, "d20", [5]); // fail
  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: gob }],
  });
  const after = await t.query(getGameState, { playerToken, dmToken });
  expect(after.combatants.find((c: any) => c.name === "Goblin")!.hp).toBe(12); // 20 - 8, unaffected by the d4
  const log = await t.query(getCombatLog, { playerToken });
  expect(log[0].rollSummary).toContain("Push direction: 3");
});

test("recipe overrides: attackMod/damageMod overrides change the resolution", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "Longsword", hitType: "attack", attackMod: 5, damageDice: [{ type: "d8", count: 1 }], damageMod: 3, damageType: "slashing", dc: 0, saveAbility: "", critImmune: false, resourceCost: 0, multiTarget: "none" },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, hero, "d20", [14]); // 14 + override 0 = 14 ≥ AC 12 hit
  await claimDice(t, playerToken, state, hero, "d8", [6]); // 6 + override 10 = 16
  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, attackMod: 0, damageMod: 10, targets: [{ combatantId: gob }],
  });
  const after = await t.query(getGameState, { playerToken, dmToken });
  expect(after.combatants.find((c: any) => c.name === "Goblin")!.hp).toBe(4); // 20 - 16
});

// ---- Stage B: multi-target (AoE + darts) ----

test("AoE save (Fireball): each target rolls its own save; fail=full, save=half", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const orc = await t.mutation(addCombatant, {
    playerToken, name: "Orc", kind: "enemy", maxHp: 30, ac: 13, initiative: 6, notes: "",
  });
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "Fireball", hitType: "save", attackMod: 0, damageDice: [{ type: "d6", count: 8 }], damageMod: 0, damageType: "fire", dc: 15, saveAbility: "dex", critImmune: false, resourceCost: 0, multiTarget: "aoe" },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  // Actor claims 8d6 (each 3 → 24). Goblin fails (d20=5 → full 24, clamped to 0). Orc saves (d20=16 → half 12).
  await claimDice(t, playerToken, state, hero, "d6", [3, 3, 3, 3, 3, 3, 3, 3]);
  // Two targets must Claim DISTINCT d20s (claimDice uses a stale snapshot, so
  // claim them by index to avoid both grabbing the first d20).
  const d20s = state.dice.filter((d: any) => d.type === "d20");
  await t.mutation(setDieValue, { playerToken, dieId: d20s[0]._id, value: 5 });
  await t.mutation(setDieClaim, { playerToken, dieId: d20s[0]._id, claimedBy: gob });
  await t.mutation(setDieValue, { playerToken, dieId: d20s[1]._id, value: 16 });
  await t.mutation(setDieClaim, { playerToken, dieId: d20s[1]._id, claimedBy: orc });
  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "Fireball!",
    recipeId: recipe,
    targets: [{ combatantId: gob }, { combatantId: orc }],
  });
  const after = await t.query(getGameState, { playerToken, dmToken });
  expect(after.combatants.find((c: any) => c.name === "Goblin")!.hp).toBe(0); // 20 - 24 clamped
  expect(after.combatants.find((c: any) => c.name === "Orc")!.hp).toBe(18); // 30 - 12 (save half)
  // Both targets' save d20s released.
  const d20Claimed = after.dice.filter((d: any) => d.type === "d20" && d.claimedBy);
  expect(d20Claimed).toHaveLength(0);
  // Log records both per-target outcomes.
  const log = await t.query(getCombatLog, { playerToken });
  expect(log[0].rollSummary).toContain("Goblin");
  expect(log[0].rollSummary).toContain("Orc");
  expect(log[0].effects).toHaveLength(2);
});

test("AoE save + R/V/I: fire-immune target takes 0, others take full on fail", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const orc = await t.mutation(addCombatant, {
    playerToken, name: "Orc", kind: "enemy", maxHp: 30, ac: 13, initiative: 6, notes: "",
  });
  await t.mutation(updateCombatant, { playerToken, combatantId: gob, patch: { immune: ["fire"] } });
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "Fireball", hitType: "save", attackMod: 0, damageDice: [{ type: "d6", count: 8 }], damageMod: 0, damageType: "fire", dc: 15, saveAbility: "dex", critImmune: false, resourceCost: 0, multiTarget: "aoe" },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, hero, "d6", [3, 3, 3, 3, 3, 3, 3, 3]); // 24
  const d20s = state.dice.filter((d: any) => d.type === "d20");
  await t.mutation(setDieValue, { playerToken, dieId: d20s[0]._id, value: 5 }); // gob fail
  await t.mutation(setDieClaim, { playerToken, dieId: d20s[0]._id, claimedBy: gob });
  await t.mutation(setDieValue, { playerToken, dieId: d20s[1]._id, value: 5 }); // orc fail
  await t.mutation(setDieClaim, { playerToken, dieId: d20s[1]._id, claimedBy: orc });
  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe,
    targets: [{ combatantId: gob }, { combatantId: orc }],
  });
  const after = await t.query(getGameState, { playerToken, dmToken });
  expect(after.combatants.find((c: any) => c.name === "Goblin")!.hp).toBe(20); // immune → 0 dmg
  expect(after.combatants.find((c: any) => c.name === "Orc")!.hp).toBe(6); // 30 - 24
});

test("darts (Magic Missile): each claimed d4 = one dart (d4+1), split per target, no crit", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const orc = await t.mutation(addCombatant, {
    playerToken, name: "Orc", kind: "enemy", maxHp: 30, ac: 13, initiative: 6, notes: "",
  });
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "Magic Missile", hitType: "automatic", attackMod: 0, damageDice: [{ type: "d4", count: 1 }], damageMod: 1, damageType: "force", dc: 0, saveAbility: "", critImmune: true, resourceCost: 0, multiTarget: "darts" },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  // Claim 3 d4s (values 2,3,1) — one per dart. Consumed in board order.
  await claimDice(t, playerToken, state, hero, "d4", [2, 3, 1]);
  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "Magic Missile!",
    recipeId: recipe,
    targets: [{ combatantId: gob, darts: 2 }, { combatantId: orc, darts: 1 }],
  });
  const after = await t.query(getGameState, { playerToken, dmToken });
  // Goblin: 2 darts (d4=2,3) → (2+1)+(3+1)=7 → 20-7=13.
  expect(after.combatants.find((c: any) => c.name === "Goblin")!.hp).toBe(13);
  // Orc: 1 dart (d4=1) → 1+1=2 → 30-2=28.
  expect(after.combatants.find((c: any) => c.name === "Orc")!.hp).toBe(28);
  // Force is critImmune — d4s not doubled.
  const log = await t.query(getCombatLog, { playerToken });
  expect(log[0].rollSummary).toContain("Magic Missile");
  expect(log[0].effects).toHaveLength(2);
});

test("darts errors when assigned darts exceed claimed d4s", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "Magic Missile", hitType: "automatic", attackMod: 0, damageDice: [{ type: "d4", count: 1 }], damageMod: 1, damageType: "force", dc: 0, saveAbility: "", critImmune: true, resourceCost: 0, multiTarget: "darts" },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, hero, "d4", [2]); // only 1 d4
  await expect(
    t.mutation(confirm, {
      playerToken, actingCombatantId: hero, effectText: "",
      recipeId: recipe,
      targets: [{ combatantId: gob, darts: 3 }], // 3 darts but 1 d4
    }),
  ).rejects.toThrow(/darts.*d4s/);
});

test("darts + hitType save: darts still split across targets, each target rolls its own save (#33)", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const orc = await t.mutation(addCombatant, {
    playerToken, name: "Orc", kind: "enemy", maxHp: 30, ac: 13, initiative: 6, notes: "",
  });
  // A DM-edited Magic Missile that lets its targets save. darts is orthogonal
  // to hitType: it still splits the d4s per target, the save only gates them.
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "Magic Missile (save variant)", hitType: "save", attackMod: 0, damageDice: [{ type: "d4", count: 1 }], damageMod: 1, damageType: "force", dc: 15, saveAbility: "dex", critImmune: true, resourceCost: 0, multiTarget: "darts" },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  // Caster claims 3 d4s (2,3,1) — still one per dart, split 2/1 across targets.
  await claimDice(t, playerToken, state, hero, "d4", [2, 3, 1]);
  // Each target rolls its OWN save. Goblin fails (5 < 15), Orc saves (18 ≥ 15).
  // Claimed by index — claimDice's stale snapshot would hand both the same d20.
  const d20s = state.dice.filter((d: any) => d.type === "d20");
  await t.mutation(setDieValue, { playerToken, dieId: d20s[0]._id, value: 5 });
  await t.mutation(setDieClaim, { playerToken, dieId: d20s[0]._id, claimedBy: gob });
  await t.mutation(setDieValue, { playerToken, dieId: d20s[1]._id, value: 18 });
  await t.mutation(setDieClaim, { playerToken, dieId: d20s[1]._id, claimedBy: orc });
  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "", recipeId: recipe,
    targets: [{ combatantId: gob, darts: 2 }, { combatantId: orc, darts: 1 }],
  });
  const after = await t.query(getGameState, { playerToken, dmToken });
  // Goblin: 2 darts (2,3) → (2+1)+(3+1)=7, save failed → full 7 → 20-7 = 13.
  expect(after.combatants.find((c: any) => c.name === "Goblin")!.hp).toBe(13);
  // Orc: 1 dart (1) → 1+1=2, saved → half → 1 → 30-1 = 29.
  expect(after.combatants.find((c: any) => c.name === "Orc")!.hp).toBe(29);
  // The log reports the gate that ran, and still carries each dart count.
  const ev = (await t.query(getCombatLog, { playerToken }))[0].event!;
  expect(ev.kind).toBe("save");
  expect(ev.targets[0]).toMatchObject({ darts: 2, saveSuccess: false, damage: 7 });
  expect(ev.targets[1]).toMatchObject({ darts: 1, saveSuccess: true, damage: 1 });
});

test("darts + hitType attack: one attack roll, resolved against each target's own AC (#33)", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  // Orc AC 20 — the same swing that hits the Goblin (AC 13) misses this one.
  const orc = await t.mutation(addCombatant, {
    playerToken, name: "Orc", kind: "enemy", maxHp: 30, ac: 20, initiative: 6, notes: "",
  });
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "Magic Missile (attack variant)", hitType: "attack", attackMod: 0, damageDice: [{ type: "d4", count: 1 }], damageMod: 1, damageType: "force", dc: 0, saveAbility: "", critImmune: true, resourceCost: 0, multiTarget: "darts" },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  // ONE d20 for the whole action (15) + 3 d4s for the darts.
  await claimDice(t, playerToken, state, hero, "d20", [15]);
  await claimDice(t, playerToken, state, hero, "d4", [2, 3, 1]);
  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "", recipeId: recipe,
    targets: [{ combatantId: gob, darts: 2 }, { combatantId: orc, darts: 1 }],
  });
  const after = await t.query(getGameState, { playerToken, dmToken });
  // Goblin: 15 ≥ AC 13 → hit → 2 darts (2,3) = 7 → 20-7 = 13.
  expect(after.combatants.find((c: any) => c.name === "Goblin")!.hp).toBe(13);
  // Orc: 15 < AC 20 → miss → its dart deals nothing.
  expect(after.combatants.find((c: any) => c.name === "Orc")!.hp).toBe(30);
  const ev = (await t.query(getCombatLog, { playerToken }))[0].event!;
  expect(ev.kind).toBe("attack");
  expect(ev.targets[0]).toMatchObject({ darts: 2, hit: true, damage: 7 });
  expect(ev.targets[1]).toMatchObject({ darts: 1, hit: false });
});

test("AoE heal (Mass Cure Wounds): each target healed, capped at its own maxHp", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  // Hero at 25/30, Goblin at 18/20.
  await t.mutation(updateCombatant, { playerToken, combatantId: hero, patch: { hp: 25 } });
  await t.mutation(updateCombatant, { playerToken, combatantId: gob, patch: { hp: 18 } });
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { name: "Mass Cure Wounds", hitType: "automatic", attackMod: 0, damageDice: [{ type: "d8", count: 3 }], damageMod: 4, damageType: "healing", dc: 0, saveAbility: "", critImmune: true, resourceCost: 0, multiTarget: "none" },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  // 3d8 = 4+5+6 = 15, +4 = 19 heal to each target.
  await claimDice(t, playerToken, state, hero, "d8", [4, 5, 6]);
  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "mass heal",
    recipeId: recipe,
    targets: [{ combatantId: hero }, { combatantId: gob }],
  });
  const after = await t.query(getGameState, { playerToken, dmToken });
  // Hero: 25 + 19 = 44 → cap 30 (+5).
  expect(after.combatants.find((c: any) => c.name === "Hero")!.hp).toBe(30);
  // Goblin: 18 + 19 = 37 → cap 20 (+2).
  expect(after.combatants.find((c: any) => c.name === "Goblin")!.hp).toBe(20);
});

test("recipes.update links a resource (Confirm consumes) and an absent resourceId unlinks", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const pool = await t.mutation(addResource, {
    playerToken, combatantId: hero, label: "L1 slots", max: 2,
  });
  const fields = {
    name: "Burning Hands", hitType: "save", attackMod: 0,
    damageDice: [{ type: "d6", count: 3 }], damageMod: 0, damageType: "fire",
    dc: 13, saveAbility: "dex", critImmune: true, resourceCost: 1,
    multiTarget: "none",
  };
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero, recipe: fields,
  });

  // Link via update (the "consumes" dropdown flow).
  await t.mutation(updateRecipe, {
    playerToken, recipeId: recipe, patch: { ...fields, resourceId: pool },
  });
  let state = await t.query(getGameState, { playerToken, dmToken });
  const heroView = () => state.combatants.find((c: any) => c.name === "Hero")!;
  expect(heroView().recipes[0].resourceId).toBe(pool);

  // Confirm consumes the linked pool (target claims a save d20).
  await claimDice(t, playerToken, state, hero, "d6", [3, 3, 3]);
  await claimDice(t, playerToken, state, gob, "d20", [15]);
  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "burn",
    recipeId: recipe, targets: [{ combatantId: gob }],
  });
  state = await t.query(getGameState, { playerToken, dmToken });
  expect(heroView().resources[0].current).toBe(1); // 2 - 1

  // Update WITHOUT resourceId unlinks (the form always sends the full shape).
  await t.mutation(updateRecipe, {
    playerToken, recipeId: recipe, patch: fields,
  });
  state = await t.query(getGameState, { playerToken, dmToken });
  expect(heroView().recipes[0].resourceId).toBeNull();
});

test("recipes.update rejects linking a resource owned by someone else", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const gobPool = await t.mutation(addResource, {
    playerToken, combatantId: gob, label: "Goblin pool", max: 1,
  });
  const fields = {
    name: "Longsword", hitType: "attack", attackMod: 5,
    damageDice: [{ type: "d8", count: 1 }], damageMod: 3, damageType: "slashing",
    dc: 0, saveAbility: "", critImmune: false, resourceCost: 1,
    multiTarget: "none",
  };
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero, recipe: fields,
  });
  await expect(
    t.mutation(updateRecipe, {
      playerToken, recipeId: recipe, patch: { ...fields, resourceId: gobPool },
    }),
  ).rejects.toThrow(/Resource not found/);
});

test("BG3-style arming: spendResources spends every armed pool once, replacing the recipe's auto-consume", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const slots = await t.mutation(addResource, {
    playerToken, combatantId: hero, label: "L1 法術位", max: 2,
  });
  const arcana = await t.mutation(addResource, {
    playerToken, combatantId: hero, label: "魔法飛彈奧秘", max: 2,
  });
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: {
      name: "魔法飛彈", hitType: "automatic", attackMod: 0,
      damageDice: [{ type: "d4", count: 1 }], damageMod: 1, damageType: "force",
      dc: 0, saveAbility: "", critImmune: true, resourceId: slots,
      resourceCost: 1, multiTarget: "darts",
    },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, hero, "d4", [3]);

  // Arm BOTH pools; the recipe's own L1 link must NOT double-spend.
  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "missiles",
    recipeId: recipe, targets: [{ combatantId: gob, darts: 1 }],
    spendResources: [{ resourceId: slots }, { resourceId: arcana }],
  });
  let after = await t.query(getGameState, { playerToken, dmToken });
  let heroView = after.combatants.find((c: any) => c.name === "Hero")!;
  const byLabel = (label: string) =>
    heroView.resources.find((r: any) => r.label === label)!;
  expect(byLabel("L1 法術位").current).toBe(1); // 2 - 1, not 0
  expect(byLabel("魔法飛彈奧秘").current).toBe(1); // 2 - 1

  // The log records what was spent.
  const log = await t.query(getCombatLog, { playerToken });
  expect(log[0].rollSummary).toContain("spent L1 法術位, 魔法飛彈奧秘");

  // An EMPTY armed list is authoritative too: nothing is spent even though
  // the recipe links a pool (untoggled = spend nothing; override wins).
  const state2 = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state2, hero, "d4", [2]);
  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "free cast",
    recipeId: recipe, targets: [{ combatantId: gob, darts: 1 }],
    spendResources: [],
  });
  after = await t.query(getGameState, { playerToken, dmToken });
  heroView = after.combatants.find((c: any) => c.name === "Hero")!;
  expect(byLabel("L1 法術位").current).toBe(1); // unchanged
});

test("BG3-style arming: amounts respected; arming someone else's pool throws", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const pool = await t.mutation(addResource, {
    playerToken, combatantId: hero, label: "聖療池", max: 5,
  });
  const gobPool = await t.mutation(addResource, {
    playerToken, combatantId: gob, label: "Goblin pool", max: 1,
  });
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: {
      name: "聖療：治療", hitType: "automatic", attackMod: 0,
      damageDice: [], damageMod: 0, damageType: "healing",
      dc: 0, saveAbility: "", critImmune: true, resourceCost: 0,
      multiTarget: "none",
    },
  });

  await t.mutation(updateCombatant, { playerToken, combatantId: hero, patch: { hp: 20 } });
  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "heal 3",
    recipeId: recipe, targets: [{ combatantId: hero, forceDamage: 3 }],
    spendResources: [{ resourceId: pool, amount: 3 }],
  });
  const after = await t.query(getGameState, { playerToken, dmToken });
  const heroView = after.combatants.find((c: any) => c.name === "Hero")!;
  expect(heroView.resources.find((r: any) => r.label === "聖療池")!.current).toBe(2); // 5 - 3

  await expect(
    t.mutation(confirm, {
      playerToken, actingCombatantId: hero, effectText: "steal",
      recipeId: recipe, targets: [{ combatantId: hero }],
      spendResources: [{ resourceId: gobPool }],
    }),
  ).rejects.toThrow(/Armed resource/);
});
