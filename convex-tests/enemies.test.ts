import { test, expect } from "vitest";
import { newGame } from "./testHelper";
import { create } from "../convex/games";
import { update as updateCombatant } from "../convex/combatants";
import { list, create as createEnemy, update as updateEnemy, remove as removeEnemy, seedAll, backfillZhNames, spawn, parseDamage, recipeFromAction, splitTypes } from "../convex/enemies";
import { parseRviText, parseConditionImmunities } from "../convex/enemyFields";
import { ENEMY_SEED } from "../convex/enemySeed";


/** Minimal custom-enemy fields for the editor-CRUD tests. */
function customFields(overrides: Record<string, unknown> = {}) {
  return {
    source: "custom" as const,
    nameZh: "史特拉德的僕從",
    nameEn: "Strahd Servant",
    symbol: "",
    role: "bruiser",
    themeTags: "castle",
    size: "中型",
    creatureType: "不死",
    temperament: "忠誠",
    threatTier: 3,
    ac: 15,
    hpMax: 45,
    hpFormula: "6d8+18",
    speedText: "30呎",
    abilities: [
      { key: "力量", score: 16, mod: 3 },
      { key: "敏捷", score: 12, mod: 1 },
      { key: "體質", score: 16, mod: 3 },
      { key: "智力", score: 8, mod: -1 },
      { key: "感知", score: 10, mod: 0 },
      { key: "魅力", score: 6, mod: -2 },
    ],
    saveBonuses: [],
    skills: [],
    senses: "黑暗視覺60呎",
    passivePerception: 10,
    languages: "通用語",
    damageResistances: "壞死",
    damageVulnerabilities: "",
    damageImmunities: "毒素",
    conditionImmunities: "中毒",
    traits: [],
    actions: [
      {
        name: "利爪",
        kind: "melee_attack",
        to_hit: 5,
        reach_ft: 5,
        target: "1個目標",
        damage: "1d8+3 揮砍",
      },
    ],
    bonusActions: [],
    reactions: [],
    legendaryActions: [],
    tactics: "",
    encounterNotes: "",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test("parseDamage handles zh and en damage strings (type stored canonical)", () => {
  expect(parseDamage("2d4+2 穿刺")).toEqual({
    dice: [{ type: "d4", count: 2 }],
    mod: 2,
    type: "piercing",
  });
  expect(parseDamage("2d6 心靈")).toEqual({
    dice: [{ type: "d6", count: 2 }],
    mod: 0,
    type: "psychic",
  });
  expect(parseDamage("2d4+2 Piercing")).toEqual({
    dice: [{ type: "d4", count: 2 }],
    mod: 2,
    type: "piercing",
  });
  // Unrecognized (compound rider) keeps the raw text — inert but visible.
  expect(parseDamage("1d10+2 穿刺+1d4 死靈")?.type).toBe("穿刺+1d4 死靈");
  expect(parseDamage("特殊效果")).toBeNull();
  expect(parseDamage("")).toBeNull();
});

test("recipeFromAction maps both preserved action shapes", () => {
  // Bestiary attack.
  expect(
    recipeFromAction({
      name: "咬擊",
      kind: "melee_attack",
      to_hit: 4,
      damage: "2d4+2 穿刺",
      on_hit: "DC 12力量豁免，否則倒地。",
    }),
  ).toMatchObject({ name: "咬擊", hitType: "attack", attackMod: 4, damageMod: 2 });

  // Bestiary save.
  expect(
    recipeFromAction({
      name: "霧鳴",
      kind: "save",
      save: "wis",
      dc: 13,
      damage: "2d6 心靈",
    }),
  ).toMatchObject({ hitType: "save", dc: 13, saveAbility: "感知", critImmune: true });

  // SRD attack (attack_bonus + damage list).
  expect(
    recipeFromAction({
      name: "Bite",
      desc: "Melee Weapon Attack: +4 to hit…",
      attack_bonus: 4,
      damage: [
        { damage_type: { name: "Piercing" }, damage_dice: "2d4+2" },
      ],
    }),
  ).toMatchObject({ hitType: "attack", attackMod: 4, damageType: "piercing" });

  // Non-resolvable kinds stay reference text.
  expect(recipeFromAction({ name: "多重攻擊", kind: "multiattack", attacks: [] })).toBeNull();
});

test("splitTypes splits zh/en separators and drops em-dash blanks", () => {
  expect(splitTypes("壞死、毒素")).toEqual(["壞死", "毒素"]);
  expect(splitTypes("necrotic, poison")).toEqual(["necrotic", "poison"]);
  expect(splitTypes("—")).toEqual([]);
  expect(splitTypes("")).toEqual([]);
});

test("parseRviText derives canonical working chips from zh and SRD text", () => {
  // zh with a qualifier: plain types become chips, the qualifier stays text.
  expect(parseRviText("鈍擊、穿刺、揮砍（非魔法）")).toEqual([
    "bludgeoning",
    "piercing",
    "slashing",
  ]);
  // SRD sentence forms, including "and …" and trailing clauses.
  expect(
    parseRviText(
      "cold, bludgeoning, piercing, and slashing from nonmagical weapons that aren't silvered",
    ),
  ).toEqual(["cold", "bludgeoning", "piercing", "slashing"]);
  // Unrecognized fragments are dropped from the chips (stay visible as text).
  expect(parseRviText("damage from spells, radiant")).toEqual(["radiant"]);
  // zh synonyms + dedupe.
  expect(parseRviText("壞死；死靈、火焰")).toEqual(["necrotic", "fire"]);
  expect(parseRviText("")).toEqual([]);
});

test("parseConditionImmunities maps zh/en tokens to curated condition keys", () => {
  expect(parseConditionImmunities("中毒、恐懼")).toEqual([
    "poisoned",
    "frightened",
  ]);
  expect(parseConditionImmunities("Poisoned, Exhaustion, Grappled")).toEqual([
    "poisoned",
    "grappled", // Exhaustion has no curated condition — reference text only.
  ]);
  expect(parseConditionImmunities("")).toEqual([]);
});

// ---------------------------------------------------------------------------
// seedAll
// ---------------------------------------------------------------------------

test("seedAll inserts every template once; re-running is a no-op", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const first = await t.mutation(seedAll, { playerToken, dmToken });
  expect(first).toBe(ENEMY_SEED.length);
  const second = await t.mutation(seedAll, { playerToken, dmToken });
  expect(second).toBe(0);
  const all = await t.query(list, { playerToken, dmToken });
  expect(all).toHaveLength(ENEMY_SEED.length);
});

test("backfillZhNames fills only blank zh names, leaving manual edits intact", async () => {
  const { t, playerToken, dmToken } = await newGame();
  await t.mutation(seedAll, { playerToken, dmToken });
  const all = await t.query(list, { playerToken, dmToken });
  const wolf = all.find((e: any) => e.seedKey === "srd_wolf");
  const goblin = all.find((e: any) => e.seedKey === "srd_goblin");
  // Recreate the pre-overlay state: one row blank, one the DM hand-named.
  const { _id: _w, _creationTime: _wt, ...wolfFields } = wolf;
  await t.mutation(updateEnemy, {
    playerToken,
    dmToken,
    enemyId: wolf._id,
    fields: { ...wolfFields, nameZh: "" },
  });
  const { _id: _g, _creationTime: _gt, ...goblinFields } = goblin;
  await t.mutation(updateEnemy, {
    playerToken,
    dmToken,
    enemyId: goblin._id,
    fields: { ...goblinFields, nameZh: "我的哥布林" },
  });

  const filled = await t.mutation(backfillZhNames, { playerToken, dmToken });
  expect(filled).toBe(1); // only the blanked wolf needed a name

  const after = await t.query(list, { playerToken, dmToken });
  expect(after.find((e: any) => e.seedKey === "srd_wolf").nameZh).toBe("狼");
  // The DM's manual name is never overwritten (ADR-0002).
  expect(after.find((e: any) => e.seedKey === "srd_goblin").nameZh).toBe("我的哥布林");
  // Re-running is a no-op once every row is named.
  expect(await t.mutation(backfillZhNames, { playerToken, dmToken })).toBe(0);
});

test("seedAll preserves the bestiary per-action JSON schema losslessly", async () => {
  const { t, playerToken, dmToken } = await newGame();
  await t.mutation(seedAll, { playerToken, dmToken });
  const all = await t.query(list, { playerToken, dmToken });
  const hound = all.find((e: any) => e.seedKey === "mist_hound");
  expect(hound.nameZh).toBe("霧獵犬");
  // The action block round-trips the CSV JSON exactly (kind/to_hit/damage/on_hit).
  expect(hound.actions).toEqual([
    {
      name: "咬擊",
      kind: "melee_attack",
      to_hit: 4,
      reach_ft: 5,
      target: "1個目標",
      damage: "2d4+2 穿刺",
      on_hit: "目標必須通過DC 12力量豁免，否則倒地。",
    },
  ]);
  expect(hound.traits).toHaveLength(2);
});

// ---------------------------------------------------------------------------
// Custom editor CRUD
// ---------------------------------------------------------------------------

test("custom enemy CRUD: create, update, remove", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const id = await t.mutation(createEnemy, {
    playerToken,
    dmToken,
    fields: customFields(),
  });
  let all = await t.query(list, { playerToken, dmToken });
  expect(all).toHaveLength(1);
  expect(all[0].nameZh).toBe("史特拉德的僕從");
  expect(all[0].source).toBe("custom");

  await t.mutation(updateEnemy, {
    playerToken,
    dmToken,
    enemyId: id,
    fields: customFields({ ac: 17, nameZh: "強化僕從" }),
  });
  all = await t.query(list, { playerToken, dmToken });
  expect(all[0].ac).toBe(17);
  expect(all[0].nameZh).toBe("強化僕從");

  await t.mutation(removeEnemy, { playerToken, dmToken, enemyId: id });
  all = await t.query(list, { playerToken, dmToken });
  expect(all).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Spawn-as-instance
// ---------------------------------------------------------------------------

test("spawn creates an independent combatant with recipes from actions", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const enemyId = await t.mutation(createEnemy, {
    playerToken,
    dmToken,
    fields: customFields(),
  });
  const combatantId = await t.mutation(spawn, { playerToken, dmToken, enemyId });

  const combatant = await t.run((ctx) => ctx.db.get(combatantId));
  expect(combatant).toMatchObject({
    name: "史特拉德的僕從",
    kind: "enemy",
    hp: 45,
    maxHp: 45,
    ac: 15,
    alive: true,
    // R/V/I + 狀態免疫 text derives CANONICAL working keys (壞死→necrotic,
    // 毒素→poison, 中毒→poisoned) so they match recipe damage types in play.
    resist: ["necrotic"],
    immune: ["poison"],
    conditionImmune: ["poisoned"],
  });
  expect(combatant.dmNotes).toContain("利爪");
  // Full 敵人庫 stat block snapshotted per instance (on-field editor), with
  // the template's seedKey stripped (an instance is never re-seeded).
  expect(combatant.statBlock).toMatchObject({
    nameZh: "史特拉德的僕從",
    threatTier: 3,
    hpFormula: "6d8+18",
    speedText: "30呎",
    conditionImmunities: "中毒",
  });
  expect(combatant.statBlock.seedKey).toBeUndefined();

  const recipes = await t.run((ctx) =>
    ctx.db
      .query("recipes")
      .withIndex("byCombatant", (q: any) => q.eq("combatantId", combatantId))
      .collect(),
  );
  expect(recipes).toHaveLength(1);
  expect(recipes[0]).toMatchObject({
    name: "利爪",
    hitType: "attack",
    attackMod: 5,
    damageDice: [{ type: "d8", count: 1 }],
    damageMod: 3,
    damageType: "slashing",
  });
});

test("editing the instance never changes the template, and vice versa", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const enemyId = await t.mutation(createEnemy, {
    playerToken,
    dmToken,
    fields: customFields(),
  });
  const combatantId = await t.mutation(spawn, { playerToken, dmToken, enemyId });

  // Instance → template: no effect.
  await t.mutation(updateCombatant, {
    playerToken,
    combatantId,
    patch: { ac: 22, maxHp: 99 },
  });
  let all = await t.query(list, { playerToken, dmToken });
  expect(all[0].ac).toBe(15);
  expect(all[0].hpMax).toBe(45);

  // Template → instance: no effect.
  await t.mutation(updateEnemy, {
    playerToken,
    dmToken,
    enemyId,
    fields: customFields({ ac: 10, hpMax: 1 }),
  });
  const combatant = await t.run((ctx) => ctx.db.get(combatantId));
  expect(combatant.ac).toBe(22);
  expect(combatant.maxHp).toBe(99);
});

test("spawning an SRD template maps attack_bonus/damage-list actions to recipes", async () => {
  const { t, playerToken, dmToken } = await newGame();
  await t.mutation(seedAll, { playerToken, dmToken });
  const all = await t.query(list, { playerToken, dmToken });
  const wolf = all.find((e: any) => e.seedKey === "srd_wolf");
  const combatantId = await t.mutation(spawn, {
    playerToken,
    dmToken,
    enemyId: wolf._id,
  });
  const recipes = await t.run((ctx) =>
    ctx.db
      .query("recipes")
      .withIndex("byCombatant", (q: any) => q.eq("combatantId", combatantId))
      .collect(),
  );
  expect(recipes).toHaveLength(1);
  expect(recipes[0]).toMatchObject({
    name: "Bite",
    hitType: "attack",
    attackMod: 4,
    damageDice: [{ type: "d4", count: 2 }],
    damageMod: 2,
  });
});

// ---------------------------------------------------------------------------
// DM gating (backend-enforced, not just hidden UI)
// ---------------------------------------------------------------------------

test("every enemy-DB function rejects a non-DM token", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const enemyId = await t.mutation(createEnemy, {
    playerToken,
    dmToken,
    fields: customFields(),
  });
  const bad = { playerToken, dmToken: "wrong" };
  await expect(t.query(list, bad)).rejects.toThrow("DM token required");
  await expect(
    t.mutation(createEnemy, { ...bad, fields: customFields() }),
  ).rejects.toThrow("DM token required");
  await expect(
    t.mutation(updateEnemy, { ...bad, enemyId, fields: customFields() }),
  ).rejects.toThrow("DM token required");
  await expect(t.mutation(removeEnemy, { ...bad, enemyId })).rejects.toThrow(
    "DM token required",
  );
  await expect(t.mutation(seedAll, bad)).rejects.toThrow("DM token required");
  await expect(t.mutation(spawn, { ...bad, enemyId })).rejects.toThrow(
    "DM token required",
  );
});
