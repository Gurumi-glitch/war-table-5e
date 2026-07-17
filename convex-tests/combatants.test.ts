import { test, expect } from "vitest";
import { newGame } from "./testHelper";
import { getGameState } from "../convex/games";
import { add, remove, update, setColor, setAlive, advanceTurn, setTurn, resetActionEconomy, rollInitiative } from "../convex/combatants";
import { addCustomModifier } from "../convex/effects";
import { setDieClaim } from "../convex/dice";
import { PALETTE } from "../convex/colors";


test("add creates a combatant with an auto-assigned color and default stats", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const id = await t.mutation(add, {
    playerToken,
    name: "Goblin",
    kind: "enemy",
    maxHp: 7,
    ac: 15,
    initiative: 12,
    notes: "scimitar",
  });

  expect(typeof id).toBe("string");
  const state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.combatants).toHaveLength(1);
  const c = state.combatants[0];
  expect(c.name).toBe("Goblin");
  expect(c.kind).toBe("enemy");
  expect(c.color).toBe(PALETTE[0]); // first auto-assigned color
  expect(c.hp).toBe(7); // starts at maxHp
  expect(c.maxHp).toBe(7);
  expect(c.ac).toBe(15);
  expect(c.initiative).toBe(12);
  expect(c.alive).toBe(true);
  expect(c.actionUsed).toBe(false);
});

test("add auto-assigns the next unused color; later combatants get later colors", async () => {
  const { t, playerToken, dmToken } = await newGame();
  await t.mutation(add, {
    playerToken,
    name: "A",
    kind: "pc",
    maxHp: 10,
    ac: 12,
    initiative: 18,
    notes: "",
  });
  await t.mutation(add, {
    playerToken,
    name: "B",
    kind: "pc",
    maxHp: 10,
    ac: 12,
    initiative: 14,
    notes: "",
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.combatants[0].color).toBe(PALETTE[0]);
  expect(state.combatants[1].color).toBe(PALETTE[1]);
});

test("add works with just the player token (open-buttons ethos)", async () => {
  const { t, playerToken, dmToken } = await newGame();
  // No dmToken required — any player-token client can add combatants.
  const id = await t.mutation(add, {
    playerToken,
    name: "Goblin",
    kind: "enemy",
    maxHp: 7,
    ac: 15,
    initiative: 12,
    notes: "",
  });
  expect(typeof id).toBe("string");
  const state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.combatants).toHaveLength(1);
});

test("setColor lets a combatant's auto-assigned color be overridden", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const id = await t.mutation(add, {
    playerToken,
    name: "A",
    kind: "pc",
    maxHp: 10,
    ac: 12,
    initiative: 18,
    notes: "",
  });
  await t.mutation(setColor, { playerToken, combatantId: id, color: "#ffffff" });
  const state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.combatants[0].color).toBe("#ffffff");
});

test("Frontstage projection withholds combatant dmNotes but keeps other stats", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const id = await t.mutation(add, {
    playerToken,
    name: "Goblin",
    kind: "enemy",
    maxHp: 7,
    ac: 15,
    initiative: 12,
    notes: "scimitar",
    dmNotes: "this is a spy (DM only)",
  });
  // DM sees dmNotes.
  const dmState = await t.query(getGameState, { playerToken, dmToken });
  expect(dmState.combatants[0].dmNotes).toBe("this is a spy (DM only)");

  // Player does not receive dmNotes — and since the enemy-privacy split an
  // ENEMY's hp/ac are withheld (null) too; notes stay public.
  const playerState = await t.query(getGameState, { playerToken });
  expect(playerState.combatants[0].dmNotes).toBeUndefined();
  expect(playerState.combatants[0].ac).toBeNull();
  expect(playerState.combatants[0].hp).toBeNull();
  expect(playerState.combatants[0].notes).toBe("scimitar");
  expect(id).toBeDefined();
});

test("statBlock is patchable and withheld from Frontstage like dmNotes", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const id = await t.mutation(add, {
    playerToken,
    name: "Goblin",
    kind: "enemy",
    maxHp: 7,
    ac: 15,
    initiative: 12,
    notes: "",
  });
  // A hand-added enemy has no snapshot yet — the DM gets an explicit null.
  let dmState = await t.query(getGameState, { playerToken, dmToken });
  expect(dmState.combatants[0].statBlock).toBeNull();

  // The on-field editor patches the full 敵人庫 stat block onto the instance.
  const statBlock = {
    source: "custom" as const,
    nameZh: "哥布林",
    nameEn: "Goblin",
    symbol: "",
    role: "",
    themeTags: "",
    size: "小型",
    creatureType: "類人",
    temperament: "",
    threatTier: 1,
    ac: 15,
    hpMax: 7,
    hpFormula: "2d6",
    speedText: "30呎",
    abilities: ["力量", "敏捷", "體質", "智力", "感知", "魅力"].map((key) => ({
      key,
      score: 10,
      mod: 0,
    })),
    saveBonuses: [],
    skills: [],
    senses: "黑暗視覺60呎",
    passivePerception: 9,
    languages: "哥布林語",
    damageResistances: "",
    damageVulnerabilities: "",
    damageImmunities: "",
    conditionImmunities: "",
    traits: [],
    actions: [],
    bonusActions: [],
    reactions: [],
    legendaryActions: [],
    tactics: "",
    encounterNotes: "",
  };
  await t.mutation(update, { playerToken, combatantId: id, patch: { statBlock } });

  // DM sees the snapshot; the player never receives the key (Backstage secret).
  dmState = await t.query(getGameState, { playerToken, dmToken });
  expect(dmState.combatants[0].statBlock).toMatchObject({
    nameZh: "哥布林",
    threatTier: 1,
    speedText: "30呎",
  });
  const playerState = await t.query(getGameState, { playerToken });
  expect(playerState.combatants[0].statBlock).toBeUndefined();
});

test("update edits any stat (manual override authoritative)", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const id = await t.mutation(add, {
    playerToken,
    name: "Goblin",
    kind: "enemy",
    maxHp: 7,
    ac: 15,
    initiative: 12,
    notes: "",
  });
  await t.mutation(update, {
    playerToken,
    combatantId: id,
    patch: { hp: 3, ac: 17, initiative: 20, name: "Goblin Boss", notes: "buffed" },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  const c = state.combatants[0];
  expect(c.hp).toBe(3);
  expect(c.ac).toBe(17);
  expect(c.initiative).toBe(20);
  expect(c.name).toBe("Goblin Boss");
  expect(c.notes).toBe("buffed");
});

test("update works with just the player token (open-buttons ethos)", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const id = await t.mutation(add, {
    playerToken,
    name: "Goblin",
    kind: "enemy",
    maxHp: 7,
    ac: 15,
    initiative: 12,
    notes: "",
  });
  // No dmToken required.
  await t.mutation(update, {
    playerToken,
    combatantId: id,
    patch: { hp: 0 },
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.combatants[0].hp).toBe(0);
});

test("remove deletes a combatant", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const id = await t.mutation(add, {
    playerToken,
    name: "Goblin",
    kind: "enemy",
    maxHp: 7,
    ac: 15,
    initiative: 12,
    notes: "",
  });
  await t.mutation(remove, { playerToken, combatantId: id });
  const state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.combatants).toHaveLength(0);
});

test("issue #18: remove releases any die the combatant had claimed", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const id = await t.mutation(add, {
    playerToken,
    name: "Goblin",
    kind: "enemy",
    maxHp: 7,
    ac: 15,
    initiative: 12,
    notes: "",
  });
  const state = await t.query(getGameState, { playerToken, dmToken });
  const die = state.dice[0];
  await t.mutation(setDieClaim, { playerToken, dieId: die._id, claimedBy: id });
  let after = await t.query(getGameState, { playerToken, dmToken });
  expect(after.dice[0].claimedBy).toBe(id);

  await t.mutation(remove, { playerToken, combatantId: id });

  after = await t.query(getGameState, { playerToken, dmToken });
  expect(after.dice[0].claimedBy).toBeNull();
});

test("setAlive toggles one-click kill and revive (still listed, flagged dead)", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const id = await t.mutation(add, {
    playerToken,
    name: "Goblin",
    kind: "enemy",
    maxHp: 7,
    ac: 15,
    initiative: 12,
    notes: "",
  });
  await t.mutation(setAlive, { playerToken, combatantId: id, alive: false });
  let state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.combatants[0].alive).toBe(false);
  expect(state.combatants).toHaveLength(1); // still listed

  await t.mutation(setAlive, { playerToken, combatantId: id, alive: true });
  state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.combatants[0].alive).toBe(true);
});

test("combatants are displayed in initiative order (highest first)", async () => {
  const { t, playerToken, dmToken } = await newGame();
  await t.mutation(add, { playerToken, name: "Slow", kind: "pc", maxHp: 10, ac: 12, initiative: 5, notes: "" });
  await t.mutation(add, { playerToken, name: "Fast", kind: "pc", maxHp: 10, ac: 12, initiative: 20, notes: "" });
  await t.mutation(add, { playerToken, name: "Mid", kind: "pc", maxHp: 10, ac: 12, initiative: 12, notes: "" });
  const state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.combatants.map((c: any) => c.name)).toEqual(["Fast", "Mid", "Slow"]);
});

test("advanceTurn moves the current turn to the next combatant in order and wraps", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const fast = await t.mutation(add, { playerToken, name: "Fast", kind: "pc", maxHp: 10, ac: 12, initiative: 20, notes: "" });
  const mid = await t.mutation(add, { playerToken, name: "Mid", kind: "pc", maxHp: 10, ac: 12, initiative: 12, notes: "" });
  const slow = await t.mutation(add, { playerToken, name: "Slow", kind: "pc", maxHp: 10, ac: 12, initiative: 5, notes: "" });

  // No turn yet.
  let state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.currentTurnId).toBeNull();

  // First advance starts at the top of the order.
  await t.mutation(advanceTurn, { playerToken });
  state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.currentTurnId).toBe(fast);
  expect(state.round).toBe(1);

  await t.mutation(advanceTurn, { playerToken });
  state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.currentTurnId).toBe(mid);

  await t.mutation(advanceTurn, { playerToken });
  state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.currentTurnId).toBe(slow);

  // Wrap: back to the top, round increments.
  await t.mutation(advanceTurn, { playerToken });
  state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.currentTurnId).toBe(fast);
  expect(state.round).toBe(2);
});

test("setTurn lets anyone force whose turn it is (override)", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const fast = await t.mutation(add, { playerToken, name: "Fast", kind: "pc", maxHp: 10, ac: 12, initiative: 20, notes: "" });
  const slow = await t.mutation(add, { playerToken, name: "Slow", kind: "pc", maxHp: 10, ac: 12, initiative: 5, notes: "" });

  await t.mutation(setTurn, { playerToken, combatantId: slow });
  const state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.currentTurnId).toBe(slow);
  expect(fast).toBeDefined();
});

test("resetActionEconomy clears action/bonus/reaction flags for all combatants", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const id = await t.mutation(add, { playerToken, name: "A", kind: "pc", maxHp: 10, ac: 12, initiative: 10, notes: "" });
  await t.mutation(update, {
    playerToken,
    combatantId: id,
    patch: { actionUsed: true, bonusUsed: true, reactionUsed: true },
  });
  await t.mutation(resetActionEconomy, { playerToken });
  const state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.combatants[0].actionUsed).toBe(false);
  expect(state.combatants[0].bonusUsed).toBe(false);
  expect(state.combatants[0].reactionUsed).toBe(false);
});

test("rollInitiative sets d20+modifier for everyone; modifier comes from the Conds initiative bonus", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const hero = await t.mutation(add, { playerToken, name: "Hero", kind: "pc", maxHp: 10, ac: 12, initiative: 0, notes: "" });
  const goblin = await t.mutation(add, { playerToken, name: "Goblin", kind: "enemy", maxHp: 7, ac: 13, initiative: 0, notes: "" });

  // Hero has a +3 initiative modifier (for now entered as a Conds custom modifier;
  // in the future this comes from the 六人角色卡 Dex mod).
  await t.mutation(addCustomModifier, {
    playerToken,
    combatantId: hero,
    label: "+3 Initiative",
    specs: [{ stat: "initiative", mode: "bonus", value: 3 }],
  });

  await t.mutation(rollInitiative, { playerToken });
  const state = await t.query(getGameState, { playerToken, dmToken });
  const h = state.combatants.find((c: any) => c._id === hero)!;
  const g = state.combatants.find((c: any) => c._id === goblin)!;

  // Hero: d20 (1..20) + 3 → 4..23. Goblin: d20 only → 1..20.
  expect(h.initiative).toBeGreaterThanOrEqual(4);
  expect(h.initiative).toBeLessThanOrEqual(23);
  expect(g.initiative).toBeGreaterThanOrEqual(1);
  expect(g.initiative).toBeLessThanOrEqual(20);
  // The base initiative field was overwritten with the rolled final result.
  expect(h.initiative).not.toBe(0);
  expect(g.initiative).not.toBe(0);
});
