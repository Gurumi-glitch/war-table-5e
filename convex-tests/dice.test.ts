import { test, expect } from "vitest";
import { newGame } from "./testHelper";
import { create, getGameState } from "../convex/games";
import { add } from "../convex/combatants";
import { batchRoll, setDieClaim, rerollDie, setDieValue } from "../convex/dice";
import { BOARD_LAYOUT, DICE_SIDES, DICE_TYPES } from "../convex/dice";


function totalDice(): number {
  return DICE_TYPES.reduce((sum, t) => sum + BOARD_LAYOUT[t], 0);
}

test("create seeds a full board, all unclaimed, values in range", async () => {
  const { t, playerToken } = await newGame();
  const state = await t.query(getGameState, { playerToken });
  expect(state.dice).toHaveLength(totalDice());
  for (const d of state.dice) {
    expect(d.claimedBy).toBeNull();
    expect(d.value).toBeGreaterThanOrEqual(1);
    expect(d.value).toBeLessThanOrEqual(DICE_SIDES[d.type]);
  }
  // Each type has its layout count.
  for (const type of DICE_TYPES) {
    const oftype = state.dice.filter((d: any) => d.type === type);
    expect(oftype).toHaveLength(BOARD_LAYOUT[type]);
  }
});

test("batchRoll (all) refreshes every die value and clears claims", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const combatantId = await t.mutation(add, {
    playerToken,
    name: "A",
    kind: "pc",
    maxHp: 10,
    ac: 12,
    initiative: 18,
    notes: "",
  });

  // Claim one die, then batch-roll all.
  const before = await t.query(getGameState, { playerToken, dmToken });
  const aDie = before.dice[0];
  await t.mutation(setDieClaim, {
    playerToken,
    dieId: aDie._id,
    claimedBy: combatantId,
  });
  let state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.dice[0].claimedBy).toBe(combatantId);

  await t.mutation(batchRoll, { playerToken });

  state = await t.query(getGameState, { playerToken, dmToken });
  for (const d of state.dice) {
    expect(d.claimedBy).toBeNull();
    expect(d.value).toBeGreaterThanOrEqual(1);
    expect(d.value).toBeLessThanOrEqual(DICE_SIDES[d.type as keyof typeof DICE_SIDES]);
  }
});

test("batchRoll(types) only rerolls dice of the given types", async () => {
  const { t, playerToken } = await newGame();
  const before = await t.query(getGameState, { playerToken });
  const d20Before = before.dice.filter((d: any) => d.type === "d20").map((d: any) => d.value);
  const d6Before = before.dice.filter((d: any) => d.type === "d6").map((d: any) => d.value);

  await t.mutation(batchRoll, { playerToken, types: ["d6"] });

  const after = await t.query(getGameState, { playerToken });
  const d20After = after.dice.filter((d: any) => d.type === "d20").map((d: any) => d.value);
  const d6After = after.dice.filter((d: any) => d.type === "d6").map((d: any) => d.value);

  // d20 untouched, d6 refreshed (almost certainly changed).
  expect(d20After).toEqual(d20Before);
  expect(d6After).not.toEqual(d6Before);
});

test("setDieClaim claims and releases a die with just the player token", async () => {
  const { t, playerToken } = await newGame();
  const combatantId = await t.mutation(add, {
    playerToken,
    name: "A",
    kind: "pc",
    maxHp: 10,
    ac: 12,
    initiative: 18,
    notes: "",
  });
  const state = await t.query(getGameState, { playerToken });
  const die = state.dice[0];

  // Claim (player token only — no dmToken).
  await t.mutation(setDieClaim, {
    playerToken,
    dieId: die._id,
    claimedBy: combatantId,
  });
  let after = await t.query(getGameState, { playerToken });
  expect(after.dice[0].claimedBy).toBe(combatantId);

  // Release via null.
  await t.mutation(setDieClaim, {
    playerToken,
    dieId: die._id,
    claimedBy: null,
  });
  after = await t.query(getGameState, { playerToken });
  expect(after.dice[0].claimedBy).toBeNull();
});

test("setDieClaim rejects a combatant from a different game", async () => {
  const { t, playerToken } = await newGame();
  // Second game + its combatant.
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
  const state = await t.query(getGameState, { playerToken });
  const die = state.dice[0];
  await expect(
    t.mutation(setDieClaim, {
      playerToken,
      dieId: die._id,
      claimedBy: otherCombatant,
    }),
  ).rejects.toThrow(/Combatant not found/);
});

test("rerollDie and setDieValue change the value but keep the claim", async () => {
  const { t, playerToken } = await newGame();
  const combatantId = await t.mutation(add, {
    playerToken,
    name: "A",
    kind: "pc",
    maxHp: 10,
    ac: 12,
    initiative: 18,
    notes: "",
  });
  let state = await t.query(getGameState, { playerToken });
  const die = state.dice[0];
  await t.mutation(setDieClaim, {
    playerToken,
    dieId: die._id,
    claimedBy: combatantId,
  });

  await t.mutation(setDieValue, { playerToken, dieId: die._id, value: 20 });
  state = await t.query(getGameState, { playerToken });
  expect(state.dice[0].value).toBe(20);
  expect(state.dice[0].claimedBy).toBe(combatantId); // claim kept

  await t.mutation(rerollDie, { playerToken, dieId: die._id });
  state = await t.query(getGameState, { playerToken });
  expect(state.dice[0].value).toBeGreaterThanOrEqual(1);
  expect(state.dice[0].claimedBy).toBe(combatantId); // claim kept
});

test("getGameState exposes dice with claimedBy (null when unclaimed)", async () => {
  const { t, playerToken } = await newGame();
  const state = await t.query(getGameState, { playerToken });
  expect(state.dice.length).toBeGreaterThan(0);
  expect(state.dice[0].claimedBy).toBeNull();
  expect(typeof state.dice[0].value).toBe("number");
});
