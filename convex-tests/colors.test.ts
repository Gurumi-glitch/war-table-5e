import { test, expect } from "vitest";
import { PALETTE, pickNextColor } from "../convex/colors";

test("pickNextColor returns the first palette color when none are used", () => {
  expect(pickNextColor([])).toBe(PALETTE[0]);
});

test("pickNextColor returns the first unused palette color", () => {
  expect(pickNextColor([PALETTE[0], PALETTE[1]])).toBe(PALETTE[2]);
});

test("pickNextColor skips used colors even if out of order", () => {
  // PALETTE[0] and PALETTE[2] are taken; the next free is PALETTE[1].
  expect(pickNextColor([PALETTE[0], PALETTE[2]])).toBe(PALETTE[1]);
});

test("pickNextColor wraps around the palette when all are used", () => {
  const allUsed = [...PALETTE];
  // Every palette color is taken, so it starts a second cycle at PALETTE[0].
  expect(pickNextColor(allUsed)).toBe(PALETTE[0]);
});

test("pickNextColor ignores colors not in the palette", () => {
  expect(pickNextColor(["hotpink", PALETTE[0]])).toBe(PALETTE[1]);
});
