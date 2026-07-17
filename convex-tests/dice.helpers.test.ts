import { test, expect } from "vitest";
import {
  rollDie,
  rollD20WithAdvantage,
  summarizeRoll,
  DICE_SIDES,
  DICE_TYPES,
  BOARD_LAYOUT,
} from "../convex/dice";

test("rollDie returns values in [1, sides] and covers the range with a seeded rng", () => {
  // Seeded rng cycling a deterministic sequence.
  let n = 0;
  const rng = () => {
    n = (n + 1) % 1000;
    return (n % 1000) / 1000;
  };
  const seen = new Set<number>();
  for (let i = 0; i < 1000; i++) {
    const v = rollDie(6, rng);
    expect(v).toBeGreaterThanOrEqual(1);
    expect(v).toBeLessThanOrEqual(6);
    seen.add(v);
  }
  // A uniform rng over 1000 draws of a d6 should hit every face.
  expect(seen.size).toBe(6);
});

test("rollDie with rng=0 lands on 1 (floor of 0)", () => {
  expect(rollDie(20, () => 0)).toBe(1);
  expect(rollDie(20, () => 0.999)).toBe(20);
});

test("rollD20WithAdvantage: neutral rolls exactly 1 die", () => {
  const rolls = [0.2, 0.9]; // would be 5 then 19 if both consumed
  let i = 0;
  const rng = () => rolls[i++];
  expect(rollD20WithAdvantage("none", rng)).toBe(5);
  expect(i).toBe(1); // only the first rng() call was consumed
});

test("rollD20WithAdvantage: advantage rolls 2 dice and takes the higher", () => {
  const rolls = [0.2, 0.9]; // → 5, 19
  let i = 0;
  const rng = () => rolls[i++];
  expect(rollD20WithAdvantage("advantage", rng)).toBe(19);
});

test("rollD20WithAdvantage: disadvantage rolls 2 dice and takes the lower", () => {
  const rolls = [0.2, 0.9]; // → 5, 19
  let i = 0;
  const rng = () => rolls[i++];
  expect(rollD20WithAdvantage("disadvantage", rng)).toBe(5);
});

test("DICE_SIDES matches each type", () => {
  for (const t of DICE_TYPES) {
    expect(DICE_SIDES[t]).toBe(Number(t.slice(1)));
  }
});

test("BOARD_LAYOUT has an entry for every type and is positive", () => {
  for (const t of DICE_TYPES) {
    expect(BOARD_LAYOUT[t]).toBeGreaterThan(0);
  }
  expect(Object.keys(BOARD_LAYOUT).length).toBe(DICE_TYPES.length);
});

test("summarizeRoll returns empty string for no claimed dice", () => {
  expect(summarizeRoll([])).toBe("");
});

test("summarizeRoll formats a single die without a count prefix", () => {
  expect(summarizeRoll([{ type: "d20", value: 14 }])).toBe("d20: 14");
});

test("summarizeRoll groups multiple of a type with sum", () => {
  const out = summarizeRoll([
    { type: "d6", value: 4 },
    { type: "d6", value: 2 },
    { type: "d6", value: 5 },
  ]);
  expect(out).toBe("3d6: 4+2+5 = 11");
});

test("summarizeRoll lists multiple d20s (advantage) instead of summing them", () => {
  // Two d20s = advantage/disadvantage; the engine picks one, so never "6+13 = 19".
  const out = summarizeRoll([
    { type: "d20", value: 6 },
    { type: "d20", value: 13 },
  ]);
  expect(out).toBe("2d20: 6, 13");
});

test("summarizeRoll joins multiple types in board order", () => {
  // Pass them out of order; output should follow DICE_TYPES order (d20 before d6).
  const out = summarizeRoll([
    { type: "d6", value: 3 },
    { type: "d20", value: 14 },
  ]);
  expect(out).toBe("d20: 14 · d6: 3");
});

test("summarizeRoll mixes single and grouped types", () => {
  const out = summarizeRoll([
    { type: "d20", value: 14 },
    { type: "d6", value: 4 },
    { type: "d6", value: 2 },
  ]);
  expect(out).toBe("d20: 14 · 2d6: 4+2 = 6");
});
