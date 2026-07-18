import { test, expect } from "vitest";
import { newGame, newTestClient } from "./testHelper";
import { create as createGame, getGameState } from "../convex/games";
import {
  create as createCharacter,
  update as updateCharacter,
  remove as removeCharacter,
  list as listCharacters,
  joinBattle,
  seedAll,
} from "../convex/characters";
import {
  add as addCombatant,
  update as updateCombatant,
  remove as removeCombatant,
  rollInitiative,
} from "../convex/combatants";
import { add as addRecipe } from "../convex/recipes";
import { add as addResource } from "../convex/resources";
import { addCustomModifier } from "../convex/effects";
import { confirm } from "../convex/combatLog";
import { setDieClaim, setDieValue } from "../convex/dice";
import type { DieType } from "../convex/dice";

/**
 * Backend-seam tests for issue #9 step 1: the global `characters` table and
 * the live link. A linked PC's hp/maxHp/ac live ON the character card;
 * recipes/resources/effects are character-owned and persist across Games;
 * combat writes (row edits, Confirm damage, resource consumption) land on the
 * card; removing the combatant never touches the card.
 */

/** Full card fields for `characters.create` (a sample-card-shaped fixture). */
function charFields(overrides: Record<string, unknown> = {}) {
  return {
    player: "測試玩家",
    nameZh: "測試角色",
    nameEn: "TestHero",
    race: "蓮花半身人",
    classesText: "聖騎士 1",
    level: 1,
    alignment: "混亂善良",
    statusText: "正常",
    hp: 12,
    maxHp: 12,
    ac: 15,
    acFormula: "鎖子甲 + 盾牌",
    speedText: "25呎",
    initBonus: 0,
    pb: 2,
    abilities: [{ key: "力量", score: 16, mod: 3 }],
    attackText: "命中 +5",
    savesText: "感知、魅力",
    skillsText: "運動、歷史",
    toolsText: "皮匠工具",
    goldText: "15 金幣",
    refs: [{ title: "聖療", body: "治療能量池 = 聖騎士等級 × 5" }],
    story: "示範用的角色故事。",
    ...overrides,
  };
}

/** Set + claim dice of `type` for a combatant (same helper as recipes tests). */
async function claimDice(
  t: ReturnType<typeof newTestClient>,
  playerToken: string,
  combatantId: string,
  type: DieType,
  values: number[],
) {
  const state = await t.query(getGameState, { playerToken });
  const oftype = state.dice
    .filter((d: any) => d.type === type && d.claimedBy === null)
    .slice(0, values.length);
  for (let i = 0; i < oftype.length; i++) {
    await t.mutation(setDieValue, { playerToken, dieId: oftype[i]._id, value: values[i] });
    await t.mutation(setDieClaim, { playerToken, dieId: oftype[i]._id, claimedBy: combatantId });
  }
}

test("create/list/update: PATCH semantics change only provided fields; hp clamps to maxHp", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const charId = await t.mutation(createCharacter, {
    playerToken,
    fields: charFields(),
  });

  // Dirty-fields-only Save: a one-field patch leaves everything else alone.
  await t.mutation(updateCharacter, {
    playerToken, characterId: charId, patch: { level: 2 },
  });
  let cards = await t.query(listCharacters, { playerToken });
  expect(cards).toHaveLength(1);
  expect(cards[0].level).toBe(2);
  expect(cards[0].nameZh).toBe("測試角色");
  expect(cards[0].hp).toBe(12);

  // hp clamps to [0, maxHp] against the effective maxHp.
  await t.mutation(updateCharacter, {
    playerToken, characterId: charId, patch: { hp: 99 },
  });
  cards = await t.query(listCharacters, { playerToken });
  expect(cards[0].hp).toBe(12);
});

test("update persists the structured saves/skills/spell fields", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const charId = await t.mutation(createCharacter, {
    playerToken, fields: charFields(),
  });
  await t.mutation(updateCharacter, {
    playerToken,
    characterId: charId,
    patch: {
      spellcastingAbility: "魅力",
      spellAttack: 4,
      spellDc: 12,
      passivePerception: 10,
      saves: [{ key: "魅力", prof: true, total: 4 }],
      skills: [{ key: "說服", ability: "魅力", prof: "proficient", total: 4 }],
    },
  });
  const cards = await t.query(listCharacters, { playerToken });
  expect(cards[0].spellcastingAbility).toBe("魅力");
  expect(cards[0].spellAttack).toBe(4);
  expect(cards[0].spellDc).toBe(12);
  expect(cards[0].saves).toEqual([{ key: "魅力", prof: true, total: 4 }]);
  expect(cards[0].skills).toEqual([
    { key: "說服", ability: "魅力", prof: "proficient", total: 4 },
  ]);
});

test("joinBattle: linked pc combatant, one per Game, re-joinable after Remove", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const charId = await t.mutation(createCharacter, {
    playerToken, fields: charFields(),
  });

  const combatantId = await t.mutation(joinBattle, { playerToken, characterId: charId });
  const state = await t.query(getGameState, { playerToken, dmToken });
  const c = state.combatants.find((x: any) => x._id === combatantId)!;
  expect(c.characterId).toBe(charId);
  expect(c.kind).toBe("pc");
  expect(c.name).toBe("測試角色");
  expect(c.initiative).toBe(0);
  expect(c.hp).toBe(12);

  // One character = one combatant per Game.
  await expect(
    t.mutation(joinBattle, { playerToken, characterId: charId }),
  ).rejects.toThrow(/already in this battle/);

  // Remove re-enables joining; the card is untouched.
  await t.mutation(removeCombatant, { playerToken, combatantId });
  const again = await t.mutation(joinBattle, { playerToken, characterId: charId });
  expect(again).toBeTruthy();
});

test("live link: combat-row hp/ac edits write through to the card; card edits show in the Game", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const charId = await t.mutation(createCharacter, {
    playerToken, fields: charFields(),
  });
  const combatantId = await t.mutation(joinBattle, { playerToken, characterId: charId });

  // Combat-row edit → card.
  await t.mutation(updateCombatant, {
    playerToken, combatantId, patch: { hp: 7, ac: 18 },
  });
  const cards = await t.query(listCharacters, { playerToken });
  expect(cards[0].hp).toBe(7);
  expect(cards[0].ac).toBe(18);

  // Card edit → Game view (projection reads the card live).
  await t.mutation(updateCharacter, {
    playerToken, characterId: charId, patch: { maxHp: 20, hp: 20 },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  const c = state.combatants.find((x: any) => x._id === combatantId)!;
  expect(c.hp).toBe(20);
  expect(c.maxHp).toBe(20);
  expect(c.ac).toBe(18);

  // Per-Game fields stay on the combatant row (never touch the card).
  await t.mutation(updateCombatant, {
    playerToken, combatantId, patch: { initiative: 15, notes: "battle scribble" },
  });
  const after = await t.query(listCharacters, { playerToken });
  expect(after[0].hp).toBe(20);
});

test("cross-game persistence: damage in Game A is visible in Game B via the shared card", async () => {
  const t = newTestClient();
  const { playerToken: tokenA } = await t.mutation(createGame, {});
  const { playerToken: tokenB } = await t.mutation(createGame, {});
  const charId = await t.mutation(createCharacter, {
    playerToken: tokenA, fields: charFields(),
  });
  const inA = await t.mutation(joinBattle, { playerToken: tokenA, characterId: charId });
  const inB = await t.mutation(joinBattle, { playerToken: tokenB, characterId: charId });

  // Manual-mode Confirm damage in Game A lands on the card…
  await t.mutation(confirm, {
    playerToken: tokenA, effectText: "trap",
    effects: [{ combatantId: inA, hpDelta: -5 }],
  });

  // …and Game B's projection shows it without any write in B.
  const stateB = await t.query(getGameState, { playerToken: tokenB });
  const cB = stateB.combatants.find((x: any) => x._id === inB)!;
  expect(cB.hp).toBe(7);
});

test("recipes/resources on a linked PC are character-owned: they survive Remove and re-join", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const charId = await t.mutation(createCharacter, {
    playerToken, fields: charFields(),
  });
  const combatantId = await t.mutation(joinBattle, { playerToken, characterId: charId });

  const poolId = await t.mutation(addResource, {
    playerToken, combatantId, label: "聖療池", max: 5,
  });
  await t.mutation(addRecipe, {
    playerToken, combatantId,
    recipe: {
      name: "聖療：治療", hitType: "automatic", attackMod: 0,
      damageDice: [{ type: "d8", count: 1 }], damageMod: 0, damageType: "healing",
      dc: 0, saveAbility: "", critImmune: true, resourceId: poolId,
      resourceCost: 1, multiTarget: "none",
    },
  });

  // Remove the combatant — character-owned children must survive.
  await t.mutation(removeCombatant, { playerToken, combatantId });
  const rejoined = await t.mutation(joinBattle, { playerToken, characterId: charId });
  const state = await t.query(getGameState, { playerToken, dmToken });
  const c = state.combatants.find((x: any) => x._id === rejoined)!;
  expect(c.resources.map((r: any) => r.label)).toEqual(["聖療池"]);
  expect(c.recipes.map((r: any) => r.name)).toEqual(["聖療：治療"]);
});

test("conditions on a linked PC live on the card and feed Confirm's effective AC", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const charId = await t.mutation(createCharacter, {
    playerToken, fields: charFields({ ac: 15 }),
  });
  const heroId = await t.mutation(joinBattle, { playerToken, characterId: charId });
  const wolfId = await t.mutation(addCombatant, {
    playerToken, name: "恐狼", kind: "enemy", maxHp: 26, ac: 14, initiative: 11, notes: "",
  });
  const biteId = await t.mutation(addRecipe, {
    playerToken, combatantId: wolfId,
    recipe: {
      name: "撲咬", hitType: "attack", attackMod: 5,
      damageDice: [{ type: "d6", count: 1 }], damageMod: 2, damageType: "piercing",
      dc: 0, saveAbility: "", critImmune: false, resourceCost: 0, multiTarget: "none",
    },
  });

  // d20 12 + 5 = 17 ≥ AC 15 → hit; the damage lands on the CARD.
  await claimDice(t, playerToken, wolfId, "d20", [12]);
  await claimDice(t, playerToken, wolfId, "d6", [4]);
  await t.mutation(confirm, {
    playerToken, actingCombatantId: wolfId, effectText: "bite",
    recipeId: biteId, targets: [{ combatantId: heroId }],
  });
  let cards = await t.query(listCharacters, { playerToken });
  expect(cards[0].hp).toBe(6); // 12 - (4+2)

  // Shield (+5 AC) applied via the combatant goes character-owned…
  await t.mutation(addCustomModifier, {
    playerToken, combatantId: heroId, label: "護盾術",
    specs: [{ stat: "ac", mode: "bonus", value: 5 }],
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  const hero = state.combatants.find((x: any) => x._id === heroId)!;
  expect(hero.effectiveAc.value).toBe(20);
  expect(hero.effects.map((e: any) => e.label)).toEqual(["護盾術"]);

  // …and the same swing now misses (17 < 20): card hp unchanged.
  await claimDice(t, playerToken, wolfId, "d20", [12]);
  await claimDice(t, playerToken, wolfId, "d6", [4]);
  await t.mutation(confirm, {
    playerToken, actingCombatantId: wolfId, effectText: "bite again",
    recipeId: biteId, targets: [{ combatantId: heroId }],
  });
  cards = await t.query(listCharacters, { playerToken });
  expect(cards[0].hp).toBe(6);
});

test("Confirm consumes a character-owned resource and heals onto the card", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const charId = await t.mutation(createCharacter, {
    playerToken, fields: charFields(),
  });
  const combatantId = await t.mutation(joinBattle, { playerToken, characterId: charId });
  const poolId = await t.mutation(addResource, {
    playerToken, combatantId, label: "聖療池", max: 5,
  });
  const healId = await t.mutation(addRecipe, {
    playerToken, combatantId,
    recipe: {
      name: "聖療：治療", hitType: "automatic", attackMod: 0,
      damageDice: [{ type: "d8", count: 1 }], damageMod: 0, damageType: "healing",
      dc: 0, saveAbility: "", critImmune: true, resourceId: poolId,
      resourceCost: 2, multiTarget: "none",
    },
  });

  // Hurt the PC (write-through), then heal: d8=3 → hp 4+3=7; pool 5→3.
  await t.mutation(updateCombatant, { playerToken, combatantId, patch: { hp: 4 } });
  await claimDice(t, playerToken, combatantId, "d8", [3]);
  await t.mutation(confirm, {
    playerToken, actingCombatantId: combatantId, effectText: "lay on hands",
    recipeId: healId, targets: [{ combatantId }],
  });

  const cards = await t.query(listCharacters, { playerToken });
  expect(cards[0].hp).toBe(7);
  const state = await t.query(getGameState, { playerToken, dmToken });
  const c = state.combatants.find((x: any) => x._id === combatantId)!;
  expect(c.resources[0].current).toBe(3);
});

test("rollInitiative uses the card's 先攻 bonus for linked PCs", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const charId = await t.mutation(createCharacter, {
    playerToken, fields: charFields({ initBonus: 100 }),
  });
  const combatantId = await t.mutation(joinBattle, { playerToken, characterId: charId });

  await t.mutation(rollInitiative, { playerToken });
  const state = await t.query(getGameState, { playerToken, dmToken });
  const c = state.combatants.find((x: any) => x._id === combatantId)!;
  // d20 (1..20) + 100 — impossible without the card's bonus.
  expect(c.initiative).toBeGreaterThanOrEqual(101);
  expect(c.initiative).toBeLessThanOrEqual(120);
});

/**
 * Demo seed (prep-public-release). The friend group's own six cards left the
 * repo when it went public; `seedAll` now seeds the four SRD samples, and the
 * property worth guarding is that NO private seed came along for the ride.
 */

test("seedAll: 4 SRD demo cards; idempotent (re-run inserts nothing, resets nothing)", async () => {
  const { t, playerToken } = await newGame();

  expect(await t.mutation(seedAll, { playerToken })).toBe(4);
  let cards = await t.query(listCharacters, { playerToken });
  expect(cards).toHaveLength(4);
  expect(cards.map((c: any) => c.seedKey).sort()).toEqual([
    "demo_cleric",
    "demo_fighter",
    "demo_rogue",
    "demo_wizard",
  ]);

  // Damage a seeded card, then re-run: nothing inserted, live state kept.
  const fighter = cards.find((c: any) => c.seedKey === "demo_fighter")!;
  await t.mutation(updateCharacter, {
    playerToken, characterId: fighter._id, patch: { hp: 3 },
  });
  expect(await t.mutation(seedAll, { playerToken })).toBe(0);
  cards = await t.query(listCharacters, { playerToken });
  expect(cards).toHaveLength(4);
  expect(cards.find((c: any) => c.seedKey === "demo_fighter")!.hp).toBe(3);
});

test("the demo seed carries none of the friend group's cards", async () => {
  const { t, playerToken } = await newGame();
  await t.mutation(seedAll, { playerToken });
  const cards = await t.query(listCharacters, { playerToken });

  // Asserted as an allowlist rather than a denylist of the retired CSV's
  // seedKeys: writing those keys down here would republish the very list the
  // seed split exists to keep out of a public repo.
  expect(cards).not.toHaveLength(0);
  for (const card of cards) {
    expect(card.seedKey).toMatch(/^demo_/);
  }
});

test("demo cards are global, so every Game's card menu can see them", async () => {
  const { t, playerToken } = await newGame();
  await t.mutation(seedAll, { playerToken });
  const other = await t.mutation(createGame, {});
  // Seeded cards carry no gameId even on the playground — a visitor arriving
  // at a fresh Game must find something to fight with.
  expect(await t.query(listCharacters, { playerToken: other.playerToken })).toHaveLength(4);
});

test("demo spot-check 示範法師: slots, 魔法飛彈 auto-hit + slot link, 護盾術 buff", async () => {
  const { t, playerToken, dmToken } = await newGame();
  await t.mutation(seedAll, { playerToken });
  const cards = await t.query(listCharacters, { playerToken });
  const wizard = cards.find((x: any) => x.seedKey === "demo_wizard")!;

  expect(wizard.level).toBe(3);
  expect(wizard.spellDc).toBe(13);
  const slots = wizard.resources.find((r: any) => r.label === "1 環法術位")!;
  expect([slots.current, slots.max]).toEqual([4, 4]);

  // 魔法飛彈: always hits, never crits, and spends an L1 slot.
  const mm = wizard.recipes.find((r: any) => r.name === "魔法飛彈")!;
  expect(mm.hitType).toBe("automatic");
  expect(mm.critImmune).toBe(true);
  expect(mm.resourceId).toBe(slots._id);
  expect(mm.resourceCost).toBe(1);

  // 護盾術 carries the +5 AC buff — the demo's one-click tour of the
  // reversible-modifier model.
  const shield = wizard.recipes.find((r: any) => r.name === "護盾術")!;
  expect(shield.appliesMods).toEqual([
    expect.objectContaining({ stat: "ac", mode: "bonus", value: 5 }),
  ]);

  // A demo card joins battle like any other card.
  const combatantId = await t.mutation(joinBattle, { playerToken, characterId: wizard._id });
  const state = await t.query(getGameState, { playerToken, dmToken });
  const view = state.combatants.find((x: any) => x._id === combatantId)!;
  expect(view.hp).toBe(17);
  expect(view.recipes.map((r: any) => r.name).sort()).toEqual([
    "火焰箭", "燃燒之手", "護盾術", "魔法飛彈",
  ].sort());
});

test("demo spot-check 示範戰士: 第二風 heals from its own once-per-rest pool", async () => {
  const { t, playerToken } = await newGame();
  await t.mutation(seedAll, { playerToken });
  const cards = await t.query(listCharacters, { playerToken });
  const fighter = cards.find((x: any) => x.seedKey === "demo_fighter")!;

  const pool = fighter.resources.find((r: any) => r.label === "第二風")!;
  expect([pool.current, pool.max]).toEqual([1, 1]);
  const secondWind = fighter.recipes.find((r: any) => r.name === "第二風")!;
  expect(secondWind.hitType).toBe("automatic");
  expect(secondWind.damageType).toBe("healing");
  expect(secondWind.resourceId).toBe(pool._id);
});

test("characters.remove unlinks combatants (frozen stats) and deletes character-owned children", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const charId = await t.mutation(createCharacter, {
    playerToken, fields: charFields(),
  });
  const combatantId = await t.mutation(joinBattle, { playerToken, characterId: charId });
  await t.mutation(addResource, { playerToken, combatantId, label: "聖療池", max: 5 });
  await t.mutation(updateCombatant, { playerToken, combatantId, patch: { hp: 9 } });

  await t.mutation(removeCharacter, { playerToken, characterId: charId });

  expect(await t.query(listCharacters, { playerToken })).toHaveLength(0);
  const state = await t.query(getGameState, { playerToken, dmToken });
  const c = state.combatants.find((x: any) => x._id === combatantId)!;
  // Unlinked but still fighting with the stats it had.
  expect(c.characterId).toBeNull();
  expect(c.hp).toBe(9);
  expect(c.resources).toHaveLength(0);
});
