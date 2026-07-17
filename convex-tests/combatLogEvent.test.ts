import { test, expect } from "vitest";
import { claimDice, newGameWithCombatants } from "./testHelper";
import { getGameState } from "../convex/games";
import { confirm, getCombatLog } from "../convex/combatLog";
import { add as addRecipe } from "../convex/recipes";
import { add as addResource } from "../convex/resources";
import { applyCondition } from "../convex/effects";

/**
 * Structured log events (i18n change): every confirm branch dual-writes an
 * `event` twin of `rollSummary`. Each test asserts the event carries the same
 * numbers/outcomes the legacy string reports, so the client's localized
 * rendering can never drift from the authoritative summary.
 */



const sword = {
  name: "Longsword", hitType: "attack", attackMod: 5,
  damageDice: [{ type: "d8", count: 1 }], damageMod: 3, damageType: "slashing",
  dc: 0, saveAbility: "", critImmune: false, resourceCost: 0, multiTarget: "none",
} as const;

const fireball = {
  name: "Fireball", hitType: "save", attackMod: 0,
  damageDice: [{ type: "d6", count: 2 }], damageMod: 0, damageType: "fire",
  dc: 15, saveAbility: "dex", critImmune: false, resourceCost: 0, multiTarget: "aoe",
} as const;

test("attack event: adv + HIT + damage + canonical damageType match the rollSummary", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const recipe = await t.mutation(addRecipe, { playerToken, combatantId: hero, recipe: sword });
  await t.mutation(applyCondition, { playerToken, combatantId: gob, conditionKey: "blinded" });
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, hero, "d20", [4, 18]);
  await claimDice(t, playerToken, state, hero, "d8", [6]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: gob }],
  });

  const log = await t.query(getCombatLog, { playerToken });
  const ev = log[0].event!;
  expect(ev.kind).toBe("attack");
  expect(ev.recipeName).toBe("Longsword");
  expect(ev.targets).toHaveLength(1);
  const tgt = ev.targets[0];
  expect(tgt.name).toBe("Goblin");
  expect(tgt.adv).toBe("advantage");
  expect(tgt.hit).toBe(true);
  expect(tgt.crit).toBeUndefined();
  expect(tgt.damage).toBe(9); // 6 + 3, same number in the string
  expect(tgt.damageType).toBe("slashing");
  expect(log[0].rollSummary).toContain("HIT");
  expect(log[0].rollSummary).toContain("9");
});

test("attack event: MISS carries hit=false and no damage", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const recipe = await t.mutation(addRecipe, { playerToken, combatantId: hero, recipe: sword });
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, hero, "d20", [2]); // 2+5=7 < AC 12
  await claimDice(t, playerToken, state, hero, "d8", [6]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: gob }],
  });

  const ev = (await t.query(getCombatLog, { playerToken }))[0].event!;
  expect(ev.kind).toBe("attack");
  expect(ev.targets[0].hit).toBe(false);
  expect(ev.targets[0].damage).toBeUndefined();
});

test("attack event: nat 20 records crit=true", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const recipe = await t.mutation(addRecipe, { playerToken, combatantId: hero, recipe: sword });
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, hero, "d20", [20]);
  await claimDice(t, playerToken, state, hero, "d8", [6]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: gob }],
  });

  const ev = (await t.query(getCombatLog, { playerToken }))[0].event!;
  expect(ev.targets[0].crit).toBe(true);
  expect(ev.targets[0].damage).toBe(15); // crit doubles the d8: 6*2 + 3
});

test("save event: dc/saveAbility/saveSuccess/saveMode + auto-fail flag", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const recipe = await t.mutation(addRecipe, { playerToken, combatantId: hero, recipe: fireball });
  await t.mutation(applyCondition, { playerToken, combatantId: gob, conditionKey: "stunned" });
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, hero, "d6", [3, 3]);
  await claimDice(t, playerToken, state, gob, "d20", [20]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: gob }],
  });

  const log = await t.query(getCombatLog, { playerToken });
  const ev = log[0].event!;
  expect(ev.kind).toBe("save");
  expect(ev.dc).toBe(15);
  expect(ev.saveAbility).toBe("dex");
  const tgt = ev.targets[0];
  expect(tgt.autoFail).toBe(true); // Stunned auto-fails DEX
  expect(tgt.saveSuccess).toBe(false);
  expect(tgt.saveMode).toBe("damage");
  expect(tgt.damage).toBe(6); // full 2d6=6 on the auto-fail
  expect(log[0].rollSummary).toContain("FAIL");
  expect(log[0].rollSummary).toContain("6");
});

test("save event: hitOrMiss mode — successful save records MISS semantics, zero damage", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const recipe = await t.mutation(addRecipe, { playerToken, combatantId: hero, recipe: fireball });
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, hero, "d6", [3, 3]);
  await claimDice(t, playerToken, state, gob, "d20", [20]); // 20 ≥ 15 saves

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: gob, saveMode: "hitOrMiss" }],
  });

  const ev = (await t.query(getCombatLog, { playerToken }))[0].event!;
  expect(ev.targets[0].saveMode).toBe("hitOrMiss");
  expect(ev.targets[0].saveSuccess).toBe(true);
  expect(ev.targets[0].damage).toBeUndefined(); // negated entirely
});

test("auto event: automatic damage recipe → kind 'auto' with damage + type", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { ...sword, name: "Cloud", hitType: "automatic", damageType: "poison" },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, hero, "d8", [4]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: gob }],
  });

  const ev = (await t.query(getCombatLog, { playerToken }))[0].event!;
  expect(ev.kind).toBe("auto");
  expect(ev.targets[0].damage).toBe(7); // 4 + 3
  expect(ev.targets[0].damageType).toBe("poison");
});

test("heal event: healing recipe → kind 'heal' with the applied (capped) heal", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  // Wound the goblin so the heal isn't fully capped.
  await t.mutation(confirm, {
    playerToken, effectText: "", effects: [{ combatantId: gob, hpDelta: -10 }],
  });
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: { ...sword, name: "Cure", hitType: "automatic", damageType: "healing", damageMod: 2 },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, hero, "d8", [5]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: gob }],
  });

  const ev = (await t.query(getCombatLog, { playerToken }))[0].event!;
  expect(ev.kind).toBe("heal");
  expect(ev.targets[0].heal).toBe(7); // 5 + 2
  expect(ev.targets[0].damage).toBeUndefined();
});

test("darts event: kind 'darts' with per-target dart counts and force damage", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: {
      // `automatic` matches the Magic Missile seed: darts is a variant of
      // automatic, so darts resolution only fires there (#33).
      name: "Magic Missile", hitType: "automatic", attackMod: 0,
      damageDice: [], damageMod: 1, damageType: "force",
      dc: 0, saveAbility: "", critImmune: true, resourceCost: 0, multiTarget: "darts",
    },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, hero, "d4", [2, 3]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: gob, darts: 2 }],
  });

  const ev = (await t.query(getCombatLog, { playerToken }))[0].event!;
  expect(ev.kind).toBe("darts");
  expect(ev.targets[0].darts).toBe(2);
  expect(ev.targets[0].damage).toBe(7); // (2+1) + (3+1)
  expect(ev.targets[0].damageType).toBe("force");
});

// Each dart carries the recipe's damageMod, not a hardcoded +1 (#62).
test.each([
  { damageMod: 1, expected: 7 }, // (2+1) + (3+1)
  { damageMod: 3, expected: 11 }, // (2+3) + (3+3)
  { damageMod: 0, expected: 5 }, // 2 + 3
])("darts: per-dart mod is recipe.damageMod ($damageMod)", async ({ damageMod, expected }) => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: {
      name: "Magic Missile", hitType: "automatic", attackMod: 0,
      damageDice: [], damageMod, damageType: "force",
      dc: 0, saveAbility: "", critImmune: true, resourceCost: 0, multiTarget: "darts",
    },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, hero, "d4", [2, 3]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: gob, darts: 2 }],
  });

  const ev = (await t.query(getCombatLog, { playerToken }))[0].event!;
  expect(ev.targets[0].damage).toBe(expected);
});

// Crit doubles the dart dice but never the per-dart mods (#62 keeps this).
test("darts: crit doubles the dart dice, not the per-dart damageMod", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: {
      name: "Crit Missile", hitType: "attack", attackMod: 0,
      damageDice: [], damageMod: 3, damageType: "force",
      dc: 0, saveAbility: "", critImmune: false, resourceCost: 0, multiTarget: "darts",
    },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, hero, "d20", [20]);
  await claimDice(t, playerToken, state, hero, "d4", [2, 3]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: gob, darts: 2 }],
  });

  const ev = (await t.query(getCombatLog, { playerToken }))[0].event!;
  expect(ev.targets[0].crit).toBe(true);
  // (2+3)*2 dice + 2 darts × 3 mod = 10 + 6; the mods are NOT doubled.
  expect(ev.targets[0].damage).toBe(16);
});

test("forced outcome: DM forceOutcome/forceDamage marks the target forced", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const recipe = await t.mutation(addRecipe, { playerToken, combatantId: hero, recipe: sword });
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, hero, "d8", [6]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe,
    targets: [{ combatantId: gob, forceOutcome: "hit", forceDamage: 4 }],
  });

  const ev = (await t.query(getCombatLog, { playerToken }))[0].event!;
  expect(ev.targets[0].forced).toBe(true);
  expect(ev.targets[0].hit).toBe(true);
  expect(ev.targets[0].damage).toBe(4);
});

test("manual event: kind 'manual' with the claimed dice snapshot", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, hero, "d20", [14]);
  await claimDice(t, playerToken, state, hero, "d6", [4]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "slash",
    effects: [{ combatantId: gob, hpDelta: -4 }],
  });

  const ev = (await t.query(getCombatLog, { playerToken }))[0].event!;
  expect(ev.kind).toBe("manual");
  expect(ev.claimedDice).toEqual(
    expect.arrayContaining([
      { type: "d20", value: 14 },
      { type: "d6", value: 4 },
    ]),
  );
});

test("spent resources land on the event; appliesMods produce grants/heals", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const pool = await t.mutation(addResource, {
    playerToken, combatantId: hero, label: "L1 slots", max: 2, current: 2,
  });
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: {
      ...sword, name: "Bless Strike",
      appliesMods: [
        { stat: "ac", mode: "bonus", value: 2 },
        { stat: "healing", mode: "bonus", value: 5 },
      ],
    },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, hero, "d20", [18]);
  await claimDice(t, playerToken, state, hero, "d8", [6]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: gob }],
    spendResources: [{ resourceId: pool, amount: 1 }],
  });

  const ev = (await t.query(getCombatLog, { playerToken }))[0].event!;
  expect(ev.spent).toEqual([{ label: "L1 slots", amount: 1 }]);
  expect(ev.grants).toEqual([
    { to: "Goblin", mods: [{ mode: "bonus", stat: "ac", value: 2 }] },
  ]);
  expect(ev.heals).toEqual([{ amount: 5, tempHp: false, to: ["Goblin"] }]);
});

test("reaction: the event names the target's reaction recipe", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const attack = await t.mutation(addRecipe, { playerToken, combatantId: hero, recipe: sword });
  const shield = await t.mutation(addRecipe, {
    playerToken, combatantId: gob,
    recipe: {
      name: "Shield", hitType: "automatic", attackMod: 0, damageDice: [],
      damageMod: 0, damageType: "force", dc: 0, saveAbility: "", critImmune: false,
      resourceCost: 0, multiTarget: "none",
      appliesMods: [{ stat: "ac", mode: "bonus", value: 5 }],
    },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, hero, "d20", [10]); // 10+5=15 ≥ 12 but < 17 with Shield
  await claimDice(t, playerToken, state, hero, "d8", [6]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: attack, targets: [{ combatantId: gob, reactionRecipeId: shield }],
  });

  const ev = (await t.query(getCombatLog, { playerToken }))[0].event!;
  expect(ev.targets[0].reactionName).toBe("Shield");
  expect(ev.targets[0].hit).toBe(false); // Shield turned the hit into a miss
});
