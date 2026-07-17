import { test, expect } from "vitest";
import { claimDice, newGameWithCombatants, newTestClient } from "./testHelper";
import { create, getGameState } from "../convex/games";
import { create as createCharacter, joinBattle } from "../convex/characters";
import { add as addCombatant, update as updateCombatant } from "../convex/combatants";
import { confirm, getCombatLog } from "../convex/combatLog";
import { add as addRecipe } from "../convex/recipes";
import { add as addResource } from "../convex/resources";
import { toggleEffect } from "../convex/effects";

/**
 * Backend-seam tests for target reactions at Confirm (the target spends their
 * reaction on one of their own recipes — e.g. Shield — whose appliesMods feed
 * THIS resolution's math) and for universal multi-target resolution (every
 * hitType accepts a target list; attacks resolve the one d20 against each
 * target's own Effective AC).
 */



const LONGSWORD = {
  name: "Longsword", hitType: "attack", attackMod: 5,
  damageDice: [{ type: "d8", count: 1 }], damageMod: 3, damageType: "slashing",
  dc: 0, saveAbility: "", critImmune: false, resourceCost: 0, multiTarget: "none",
} as const;

test("attack vs multiple targets: one d20 checked against each target's own AC", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const knight = await t.mutation(addCombatant, {
    playerToken, name: "Knight", kind: "enemy", maxHp: 25, ac: 22, initiative: 5, notes: "",
  });
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero, recipe: LONGSWORD,
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  // d20=14 (+5 = 19): ≥ Goblin AC 12 (hit), < Knight AC 22 (miss).
  await claimDice(t, playerToken, state, hero, "d20", [14]);
  await claimDice(t, playerToken, state, hero, "d8", [6]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "sweep",
    recipeId: recipe, targets: [{ combatantId: gob }, { combatantId: knight }],
  });

  const after = await t.query(getGameState, { playerToken, dmToken });
  expect(after.combatants.find((c: any) => c.name === "Goblin")!.hp).toBe(11); // 20 - 9
  expect(after.combatants.find((c: any) => c.name === "Knight")!.hp).toBe(25); // missed

  const log = await t.query(getCombatLog, { playerToken });
  expect(log[0].rollSummary).toContain("Goblin: HIT");
  expect(log[0].rollSummary).toContain("Knight: MISS");
});

test("automatic heal with multiTarget 'none' accepts several targets (Mass Healing Word)", async () => {
  const { t, playerToken, dmToken, hero } = await newGameWithCombatants();
  const ally = await t.mutation(addCombatant, {
    playerToken, name: "Ally", kind: "pc", maxHp: 20, ac: 14, initiative: 9, notes: "",
  });
  await t.mutation(updateCombatant, { playerToken, combatantId: hero, patch: { hp: 10 } });
  await t.mutation(updateCombatant, { playerToken, combatantId: ally, patch: { hp: 18 } });
  const recipe = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: {
      name: "Mass Healing Word", hitType: "automatic", attackMod: 0,
      damageDice: [{ type: "d4", count: 1 }], damageMod: 2, damageType: "healing",
      dc: 0, saveAbility: "", critImmune: true, resourceCost: 0, multiTarget: "none",
    },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, hero, "d4", [3]); // 3+2 = 5 heal each

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: recipe, targets: [{ combatantId: hero }, { combatantId: ally }],
  });

  const after = await t.query(getGameState, { playerToken, dmToken });
  expect(after.combatants.find((c: any) => c.name === "Hero")!.hp).toBe(15); // 10 + 5
  expect(after.combatants.find((c: any) => c.name === "Ally")!.hp).toBe(20); // 18 + 5 capped at max
});

test("reaction Shield: +5 AC turns the hit into a miss; reaction spent; buff stays as a toggleable chip", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  // Wolf's bite would hit Hero (d20 14 + 5 = 19 ≥ AC 16)...
  const bite = await t.mutation(addRecipe, {
    playerToken, combatantId: gob,
    recipe: { ...LONGSWORD, name: "Bite", damageType: "piercing" },
  });
  // ...but Hero reacts with Shield (+5 AC → 21 > 19 → miss).
  const shield = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: {
      name: "Shield", hitType: "automatic", attackMod: 0, damageDice: [], damageMod: 0,
      damageType: "", dc: 0, saveAbility: "", critImmune: true, resourceCost: 0,
      multiTarget: "none", appliesMods: [{ stat: "ac", mode: "bonus", value: 5 }],
    },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, gob, "d20", [14]);
  await claimDice(t, playerToken, state, gob, "d8", [6]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: gob, effectText: "",
    recipeId: bite, targets: [{ combatantId: hero, reactionRecipeId: shield }],
  });

  const after = await t.query(getGameState, { playerToken, dmToken });
  const h = after.combatants.find((c: any) => c.name === "Hero")!;
  expect(h.hp).toBe(30); // missed — no damage
  expect(h.reactionUsed).toBe(true); // reaction economy spent
  // The Shield buff persists as an active, reversible effect chip (+5 AC).
  const chip = h.effects.find((e: any) => e.label === "Shield");
  expect(chip).toBeDefined();
  expect(chip!.active).toBe(true);
  expect(h.effectiveAc.value).toBe(21);
  // Toggling it off reverts (manual expiry when the round ends).
  await t.mutation(toggleEffect, { playerToken, effectId: chip!._id, active: false });
  const reverted = await t.query(getGameState, { playerToken, dmToken });
  expect(reverted.combatants.find((c: any) => c.name === "Hero")!.effectiveAc.value).toBe(16);

  const log = await t.query(getCombatLog, { playerToken });
  expect(log[0].rollSummary).toContain("Hero (Shield!): MISS");
});

test("reaction Shield on a LINKED PC (character-owned recipe, direction 自身): +5 AC applies before the hit check", async () => {
  const t = newTestClient();
  const { playerToken, dmToken } = await t.mutation(create, {});
  const charId = await t.mutation(createCharacter, {
    playerToken,
    fields: {
      player: "測試玩家", nameZh: "測試角色", nameEn: "TestHero", race: "蓮花半身人",
      classesText: "聖騎士 1", level: 1, alignment: "混亂善良", statusText: "正常",
      hp: 12, maxHp: 12, ac: 15, acFormula: "鎖子甲 + 盾牌", speedText: "25呎",
      initBonus: 0, pb: 2, abilities: [{ key: "力量", score: 16, mod: 3 }],
      attackText: "", savesText: "", skillsText: "", toolsText: "", goldText: "",
      refs: [], story: "",
    },
  });
  const pc = await t.mutation(joinBattle, { playerToken, characterId: charId });
  // 護盾術 lives on the CHARACTER (issue #9) and its row is self-directed
  // (the new direction field) — the reaction path must still apply it.
  const shield = await t.mutation(addRecipe, {
    playerToken, characterId: charId,
    recipe: {
      name: "護盾術", hitType: "automatic", attackMod: 0, damageDice: [], damageMod: 0,
      damageType: "", dc: 0, saveAbility: "", critImmune: true, resourceCost: 0,
      multiTarget: "none",
      appliesMods: [{ stat: "ac", mode: "bonus", value: 5, direction: "self" }],
    },
  });
  const gob = await t.mutation(addCombatant, {
    playerToken, name: "Goblin", kind: "enemy", maxHp: 20, ac: 12, initiative: 8, notes: "",
  });
  const bite = await t.mutation(addRecipe, {
    playerToken, combatantId: gob,
    recipe: { ...LONGSWORD, name: "Bite", damageType: "piercing" },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  // d20 12 + 5 = 17: ≥ card AC 15 (would hit) but < 20 with 護盾術 → MISS.
  await claimDice(t, playerToken, state, gob, "d20", [12]);
  await claimDice(t, playerToken, state, gob, "d8", [6]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: gob, effectText: "",
    recipeId: bite, targets: [{ combatantId: pc, reactionRecipeId: shield }],
  });

  const after = await t.query(getGameState, { playerToken, dmToken });
  const h = after.combatants.find((c: any) => c._id === pc)!;
  expect(h.hp).toBe(12); // missed — the +5 folded in BEFORE the hit check
  expect(h.reactionUsed).toBe(true);
  const log = await t.query(getCombatLog, { playerToken });
  expect(log[0].rollSummary).toContain("測試角色 (護盾術!): MISS");
});

test("reaction consumes its linked resource (spell slot)", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const bite = await t.mutation(addRecipe, {
    playerToken, combatantId: gob,
    recipe: { ...LONGSWORD, name: "Bite", damageType: "piercing" },
  });
  const slots = await t.mutation(addResource, {
    playerToken, combatantId: hero, label: "Lv1 slots", max: 3,
  });
  const shield = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: {
      name: "Shield", hitType: "automatic", attackMod: 0, damageDice: [], damageMod: 0,
      damageType: "", dc: 0, saveAbility: "", critImmune: true,
      resourceId: slots, resourceCost: 1, multiTarget: "none",
      appliesMods: [{ stat: "ac", mode: "bonus", value: 5 }],
    },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, gob, "d20", [14]);
  await claimDice(t, playerToken, state, gob, "d8", [6]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: gob, effectText: "",
    recipeId: bite, targets: [{ combatantId: hero, reactionRecipeId: shield }],
  });

  const after = await t.query(getGameState, { playerToken, dmToken });
  const h = after.combatants.find((c: any) => c.name === "Hero")!;
  expect(h.resources.find((r: any) => r.label === "Lv1 slots")!.current).toBe(2);
});

test("reaction with a save bonus feeds the target's saving throw", async () => {
  const { t, playerToken, dmToken, hero, gob } = await newGameWithCombatants();
  const fireball = await t.mutation(addRecipe, {
    playerToken, combatantId: hero,
    recipe: {
      name: "Fireball", hitType: "save", attackMod: 0,
      damageDice: [{ type: "d6", count: 8 }], damageMod: 0, damageType: "fire",
      dc: 15, saveAbility: "dex", critImmune: false, resourceCost: 0, multiTarget: "aoe",
    },
  });
  const ward = await t.mutation(addRecipe, {
    playerToken, combatantId: gob,
    recipe: {
      name: "Ward", hitType: "automatic", attackMod: 0, damageDice: [], damageMod: 0,
      damageType: "", dc: 0, saveAbility: "", critImmune: true, resourceCost: 0,
      multiTarget: "none", appliesMods: [{ stat: "save", mode: "bonus", value: 2 }],
    },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  await claimDice(t, playerToken, state, hero, "d6", [3, 3, 3, 3, 3, 3, 3, 3]); // 24
  // Save d20 = 13: without the Ward 13 < 15 fails; with +2 it saves → half (12).
  await claimDice(t, playerToken, state, gob, "d20", [13]);

  await t.mutation(confirm, {
    playerToken, actingCombatantId: hero, effectText: "",
    recipeId: fireball, targets: [{ combatantId: gob, reactionRecipeId: ward }],
  });

  const after = await t.query(getGameState, { playerToken, dmToken });
  expect(after.combatants.find((c: any) => c.name === "Goblin")!.hp).toBe(8); // 20 - 12
  const log = await t.query(getCombatLog, { playerToken });
  expect(log[0].rollSummary).toContain("Goblin (Ward!): SAVE");
});
