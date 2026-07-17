import { test, expect } from "vitest";
import {
  ABILITY_KEYS,
  SKILLS,
  defaultSaves,
  defaultSkills,
  modFor,
  modByKey,
  nextSkillProf,
  pbForLevel,
  recalcCard,
  saveTotal,
  skillTotal,
  spellAttackFn,
  spellDcFn,
} from "./dndCalc";

test("modFor: floor((score - 10) / 2) across the common range", () => {
  expect(modFor(8)).toBe(-1); // the user's WIS 8 → -1 example
  expect(modFor(10)).toBe(0);
  expect(modFor(12)).toBe(1);
  expect(modFor(14)).toBe(2);
  expect(modFor(15)).toBe(2); // rounds down
  expect(modFor(16)).toBe(3);
  expect(modFor(20)).toBe(5);
});

test("saveTotal / skillTotal / spell formulas match the sample spellcaster", () => {
  const pb = 2;
  // CON mod 2, proficient → 4
  expect(saveTotal(2, pb, true)).toBe(4);
  // CHA mod 2, not proficient → 2
  expect(saveTotal(2, pb, false)).toBe(2);
  // Arcana: INT mod 2, proficient → 4
  expect(skillTotal(2, pb, "proficient")).toBe(4);
  // Perception: WIS mod 1, proficient → 3
  expect(skillTotal(1, pb, "proficient")).toBe(3);
  // expertise doubles PB: WIS mod 1 + 2×2 = 5
  expect(skillTotal(1, pb, "expertise")).toBe(5);
  // Spell attack = CHA mod 2 + PB 2 = 4
  expect(spellAttackFn(2, pb)).toBe(4);
  // Spell DC = 8 + CHA mod 2 + PB 2 = 12
  expect(spellDcFn(2, pb)).toBe(12);
});

test("pbForLevel follows the 5e PC table (2 + floor((lv-1)/4)), clamped 1–20", () => {
  expect(pbForLevel(1)).toBe(2);
  expect(pbForLevel(4)).toBe(2);
  expect(pbForLevel(5)).toBe(3);
  expect(pbForLevel(8)).toBe(3);
  expect(pbForLevel(9)).toBe(4);
  expect(pbForLevel(12)).toBe(4);
  expect(pbForLevel(13)).toBe(5);
  expect(pbForLevel(16)).toBe(5);
  expect(pbForLevel(17)).toBe(6);
  expect(pbForLevel(20)).toBe(6);
  // out-of-table inputs clamp instead of extrapolating
  expect(pbForLevel(0)).toBe(2);
  expect(pbForLevel(-3)).toBe(2);
  expect(pbForLevel(25)).toBe(6);
});

test("nextSkillProf cycles none → proficient → expertise → none", () => {
  expect(nextSkillProf("none")).toBe("proficient");
  expect(nextSkillProf("proficient")).toBe("expertise");
  expect(nextSkillProf("expertise")).toBe("none");
});

test("SKILLS has 18 entries; ABILITY_KEYS has 6; every skill ability is valid", () => {
  expect(SKILLS).toHaveLength(18);
  expect(ABILITY_KEYS).toHaveLength(6);
  for (const s of SKILLS) {
    expect((ABILITY_KEYS as readonly string[]).includes(s.ability)).toBe(true);
  }
});

test("defaultSaves / defaultSkills build 6 / 18 non-proficient rows with totals", () => {
  const mods = modByKey([
    { key: "力量", score: 8, mod: 0 },
    { key: "敏捷", score: 12, mod: 0 },
    { key: "體質", score: 14, mod: 0 },
    { key: "智力", score: 14, mod: 0 },
    { key: "感知", score: 12, mod: 0 },
    { key: "魅力", score: 15, mod: 0 },
  ]);
  const saves = defaultSaves(mods, 2);
  expect(saves).toHaveLength(6);
  expect(saves.every((s) => s.prof === false)).toBe(true);
  expect(saves.find((s) => s.key === "力量")!.total).toBe(-1); // mod -1, no prof
  expect(saves.find((s) => s.key === "魅力")!.total).toBe(2); // mod 2

  const skills = defaultSkills(mods, 2);
  expect(skills).toHaveLength(18);
  expect(skills.every((s) => s.prof === "none")).toBe(true);
  expect(skills.find((s) => s.key === "運動")!.total).toBe(-1); // STR
  expect(skills.find((s) => s.key === "奧秘")!.total).toBe(2); // INT
});

test("recalcCard: changing a score ripples to mods, saves, skills, spell, initiative", () => {
  const base = {
    abilities: [
      { key: "力量", score: 10, mod: 0 },
      { key: "敏捷", score: 10, mod: 0 },
      { key: "體質", score: 10, mod: 0 },
      { key: "智力", score: 10, mod: 0 },
      { key: "感知", score: 10, mod: 0 },
      { key: "魅力", score: 10, mod: 0 },
    ],
    pb: 2,
    initBonus: 0,
    saves: defaultSaves(modByKey([{ key: "力量", score: 10, mod: 0 }, { key: "敏捷", score: 10, mod: 0 }, { key: "體質", score: 10, mod: 0 }, { key: "智力", score: 10, mod: 0 }, { key: "感知", score: 10, mod: 0 }, { key: "魅力", score: 10, mod: 0 }]), 2),
    skills: defaultSkills(modByKey([{ key: "力量", score: 10, mod: 0 }, { key: "敏捷", score: 10, mod: 0 }, { key: "體質", score: 10, mod: 0 }, { key: "智力", score: 10, mod: 0 }, { key: "感知", score: 10, mod: 0 }, { key: "魅力", score: 10, mod: 0 }]), 2),
    spellcastingAbility: "魅力",
    spellAttack: 0,
    spellDc: 0,
  };
  // Bump CHA to 18 (mod +4) and mark CHA save + Persuasion proficient.
  base.abilities[5].score = 18;
  base.saves[5].prof = true; // 魅力 save
  base.skills[17].prof = "proficient"; // 說服 (CHA)
  const out = recalcCard(base);

  expect(out.abilities[5].mod).toBe(4);
  expect(out.initBonus).toBe(0); // DEX still 10 → 0
  expect(out.saves[5].total).toBe(6); // CHA mod 4 + PB 2
  expect(out.skills[17].total).toBe(6); // 說服: CHA 4 + PB 2
  expect(out.spellAttack).toBe(6); // CHA 4 + PB 2
  expect(out.spellDc).toBe(14); // 8 + 4 + 2

  // DEX bump ripples to initiative.
  base.abilities[1].score = 14; // DEX mod +2
  const out2 = recalcCard(base);
  expect(out2.initBonus).toBe(2);

  // With level present, pb is re-derived from it and cascades everywhere.
  const out3 = recalcCard({ ...base, level: 9, pb: 99 });
  expect(out3.pb).toBe(4); // level 9 → +4, ignores the stale pb input
  expect(out3.saves[5].total).toBe(8); // CHA mod 4 + PB 4
  expect(out3.spellDc).toBe(16); // 8 + 4 + 4

  // Without level (legacy callers), pb passes through unchanged.
  expect(recalcCard(base).pb).toBe(2);
});
