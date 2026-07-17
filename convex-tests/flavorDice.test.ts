import { test, expect } from "vitest";
import { newGame } from "./testHelper";
import { roll as rollFlavor, list as listFlavor } from "../convex/flavorDice";


test("any caller can roll a flavor die at any time; result is shared/synced", async () => {
  const { t, playerToken } = await newGame();
  // No combat, nobody's turn, only the player token — still rolls.
  await t.mutation(rollFlavor, { playerToken, type: "d20" });
  const dice = await t.query(listFlavor, { playerToken });
  const d20 = dice.find((d: any) => d.type === "d20");
  expect(d20).toBeDefined();
  expect(d20.value).toBeGreaterThanOrEqual(1);
  expect(d20.value).toBeLessThanOrEqual(20);
  // The other six types exist (board lazily seeded) but are not yet rolled.
  expect(dice).toHaveLength(7);
  expect(dice.filter((d: any) => d.value === null)).toHaveLength(6);
});

test("rolling a flavor die never touches the combat dice table or the combat log", async () => {
  const { t, playerToken } = await newGame();
  const before = await t.run(async (ctx: any) => ({
    dice: await ctx.db.query("dice").collect(),
    log: await ctx.db.query("combatLog").collect(),
  }));

  await t.mutation(rollFlavor, { playerToken, type: "d6" });
  await t.mutation(rollFlavor, { playerToken, type: "d100" });

  const after = await t.run(async (ctx: any) => ({
    dice: await ctx.db.query("dice").collect(),
    log: await ctx.db.query("combatLog").collect(),
  }));

  // Combat Dice Board unchanged (same rows, same values, none claimed) and no
  // combat-log entry appended — flavor rolls live entirely in `flavorDice`.
  expect(after.dice).toHaveLength(before.dice.length);
  expect(after.dice.map((d: any) => d.value)).toEqual(
    before.dice.map((d: any) => d.value),
  );
  expect(after.dice.every((d: any) => d.claimedBy === undefined)).toBe(true);
  expect(after.log).toHaveLength(0);
});

test("re-rolling a type replaces only that die's value; board stays one row per type", async () => {
  const { t, playerToken } = await newGame();
  await t.mutation(rollFlavor, { playerToken, type: "d20" });
  await t.mutation(rollFlavor, { playerToken, type: "d20" });
  const dice = await t.query(listFlavor, { playerToken });
  // Still exactly one d20 row (no accumulation, unlike the batch combat board).
  expect(dice.filter((d: any) => d.type === "d20")).toHaveLength(1);
  expect(dice).toHaveLength(7);
});
