import { test, expect } from "vitest";
import {
  enemyMatchesQuery,
  enemySearchTerms,
  type EnemySearchable,
} from "./enemySearch";

const make = (over: Partial<EnemySearchable>): EnemySearchable => ({
  nameZh: "",
  nameEn: "",
  creatureType: "",
  themeTags: "",
  role: "",
  ...over,
});

test("empty / whitespace query matches everything", () => {
  const wolf = make({ nameZh: "狼", nameEn: "Wolf" });
  expect(enemyMatchesQuery(wolf, "")).toBe(true);
  expect(enemyMatchesQuery(wolf, "   ")).toBe(true);
  expect(enemySearchTerms("   ")).toEqual([]);
});

test("matches on any searchable field, case-insensitive", () => {
  const wolf = make({
    nameZh: "恐狼",
    nameEn: "Dire Wolf",
    creatureType: "野獸",
    themeTags: "forest pack",
    role: "brute",
  });
  expect(enemyMatchesQuery(wolf, "狼")).toBe(true);
  expect(enemyMatchesQuery(wolf, "WOLF")).toBe(true);
  expect(enemyMatchesQuery(wolf, "野獸")).toBe(true);
  expect(enemyMatchesQuery(wolf, "pack")).toBe(true);
  expect(enemyMatchesQuery(wolf, "brute")).toBe(true);
});

test("whitespace splits into AND terms — every term must appear", () => {
  const wolf = make({ nameEn: "Dire Wolf", themeTags: "forest" });
  expect(enemyMatchesQuery(wolf, "dire wolf")).toBe(true);
  expect(enemyMatchesQuery(wolf, "wolf forest")).toBe(true); // across fields
  expect(enemyMatchesQuery(wolf, "wolf dragon")).toBe(false); // dragon absent
  expect(enemySearchTerms("  dire   wolf ")).toEqual(["dire", "wolf"]);
});

test("no match when a term is absent from all fields", () => {
  const rat = make({ nameZh: "巨鼠", nameEn: "Giant Rat" });
  expect(enemyMatchesQuery(rat, "狼")).toBe(false);
});
