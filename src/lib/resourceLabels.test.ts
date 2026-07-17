import { test, expect } from "vitest";
import { headerFor, parseSlotLevel, romanFor } from "./resourceLabels";

test("parseSlotLevel matches the English presets", () => {
  expect(parseSlotLevel("L1 slots")).toBe(1);
  expect(parseSlotLevel("L2 slots")).toBe(2);
  expect(parseSlotLevel("L10 slots")).toBe(10);
});

test("parseSlotLevel matches 六人角色卡-style Chinese labels", () => {
  expect(parseSlotLevel("L1 法術位")).toBe(1);
  expect(parseSlotLevel("L9 法術位")).toBe(9);
  expect(parseSlotLevel("1級法術位")).toBe(1);
  expect(parseSlotLevel("3 級法術位")).toBe(3);
});

test("parseSlotLevel does not false-positive on non-slot resources", () => {
  expect(parseSlotLevel("Ki")).toBeNull();
  expect(parseSlotLevel("Rage")).toBeNull();
  expect(parseSlotLevel("Lay on Hands")).toBeNull();
  expect(parseSlotLevel("聖療池")).toBeNull();
  expect(parseSlotLevel("魔法飛彈奧秘")).toBeNull();
});

test("parseSlotLevel rejects an out-of-range level", () => {
  expect(parseSlotLevel("L11 slots")).toBeNull();
  expect(parseSlotLevel("L0 slots")).toBeNull();
});

test("romanFor renders I-X", () => {
  expect(romanFor(1)).toBe("I");
  expect(romanFor(4)).toBe("IV");
  expect(romanFor(9)).toBe("IX");
  expect(romanFor(10)).toBe("X");
});

test("headerFor: Roman numeral for a parsed slot level, else the label as-is", () => {
  expect(headerFor("L1 slots")).toBe("I");
  expect(headerFor("L2 法術位")).toBe("II");
  expect(headerFor("Ki")).toBe("Ki");
  expect(headerFor("Lay on Hands")).toBe("Lay on Hands");
});
