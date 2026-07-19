import { test, expect } from "vitest";
import {
  SRD_RACES,
  SRD_CLASSES,
  SRD_BACKGROUNDS,
  SRD_ARMORS,
} from "./srdContent";
import { startingHpFor, acFor, spellSlotsL1For, modFor } from "./dndCalc";

const race = (id: string) => SRD_RACES.find((r) => r.id === id)!;
const cls = (id: string) => SRD_CLASSES.find((c) => c.id === id)!;

test("ships exactly the SRD set (9 races, 12 classes, Acolyte only)", () => {
  expect(SRD_RACES).toHaveLength(9);
  expect(SRD_CLASSES).toHaveLength(12);
  expect(SRD_BACKGROUNDS.map((b) => b.id)).toEqual(["acolyte"]);
  // each class ships exactly one SRD subclass
  expect(SRD_CLASSES.every((c) => c.subclasses.length === 1)).toBe(true);
});

test("race ASI/speed/size match SRD 01_Races", () => {
  expect(race("high-elf").asi).toEqual({ 敏捷: 2, 智力: 1 });
  expect(race("high-elf").speedFt).toBe(30);
  expect(race("hill-dwarf").asi).toEqual({ 體質: 2, 感知: 1 });
  expect(race("hill-dwarf").speedFt).toBe(25);
  expect(race("rock-gnome").size).toBe("小型");
  // Half-Elf: CHA+2 fixed + two +1 of choice
  expect(race("half-elf").asi).toEqual({ 魅力: 2 });
  expect(race("half-elf").asiChoice).toEqual({ count: 2, amount: 1 });
  // Human: all +1
  expect(race("human").asi).toEqual({ 力量: 1, 敏捷: 1, 體質: 1, 智力: 1, 感知: 1, 魅力: 1 });
});

test("class hit die / saves / caster type match SRD 02_Classes", () => {
  expect(cls("cleric").hitDie).toBe(8);
  expect(cls("cleric").saveProfs).toEqual(["感知", "魅力"]);
  expect(cls("cleric").caster).toBe("full");
  expect(cls("cleric").spellAbility).toBe("感知");
  expect(cls("barbarian").hitDie).toBe(12);
  expect(cls("barbarian").caster).toBe("none");
  expect(cls("wizard").hitDie).toBe(6);
  expect(cls("paladin").caster).toBe("half");
  expect(cls("warlock").caster).toBe("pact");
});

test("only Cleric/Sorcerer/Warlock grant a subclass at L1", () => {
  const l1subs = SRD_CLASSES.filter((c) => c.subclasses[0].l1).map((c) => c.id).sort();
  expect(l1subs).toEqual(["cleric", "sorcerer", "warlock"]);
});

test("Life Domain grants heavy armor at L1 (SRD Cleric § Bonus Proficiency)", () => {
  const life = cls("cleric").subclasses[0];
  expect(life.id).toBe("life-domain");
  expect(life.bonusArmorProfs).toEqual(["重甲"]);
});

test("Acolyte background: Insight + Religion, two languages", () => {
  const acolyte = SRD_BACKGROUNDS[0];
  expect(acolyte.skills).toEqual(["洞悉", "宗教"]);
  expect(acolyte.languages).toBe(2);
});

test("content feeds the derivation engine end-to-end (a L1 SRD cleric)", () => {
  // Life Domain cleric, CON 14 (+2), no armor chosen yet, DEX 10 (+0)
  const cleric = cls("cleric");
  expect(startingHpFor(cleric.hitDie, modFor(14))).toBe(10); // d8 + 2
  expect(spellSlotsL1For(cleric.caster)).toBe(2); // full caster
  // unarmored AC = 10 + DEX
  expect(acFor({ dexMod: 0 }).ac).toBe(10);
});

test("armor rows come from the seed equipment file (13, with the AC math)", () => {
  expect(SRD_ARMORS).toHaveLength(13);
  const chain = SRD_ARMORS.find((a) => a.id === "chain-mail")!;
  expect(chain.cat).toBe("heavy");
  expect(chain.dexBonus).toBe(false); // heavy → no DEX
  expect(acFor({ dexMod: 3, armor: chain, armorLabel: "鏈甲" }).ac).toBe(16);
  const hide = SRD_ARMORS.find((a) => a.id === "hide-armor")!;
  expect(hide.maxBonus).toBe(2); // medium DEX cap
});
