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
  startingHpFor,
  acFor,
  STANDARD_ARRAY,
  POINT_BUY_BUDGET,
  pointBuyCost,
  pointBuyTotal,
  applyRacialAsi,
  spellSlotsL1For,
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
    passivePerception: 0,
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

test("passivePerception = 10 + Perception total (SRD § Passive Checks)", () => {
  // WIS 15 (+2), Perception proficient (PB +2) → 10 + 2 + 2 = 14 (SRD example).
  const wis15 = [
    { key: "力量", score: 10, mod: 0 },
    { key: "敏捷", score: 10, mod: 0 },
    { key: "體質", score: 10, mod: 0 },
    { key: "智力", score: 10, mod: 0 },
    { key: "感知", score: 15, mod: 0 },
    { key: "魅力", score: 10, mod: 0 },
  ];
  const mods = modByKey(wis15);
  const skills = defaultSkills(mods, 2).map((s) =>
    s.key === "察覺" ? { ...s, prof: "proficient" as const, total: skillTotal(mods["感知"] ?? 0, 2, "proficient") } : s,
  );
  const proficient = recalcCard({
    abilities: wis15,
    pb: 2,
    initBonus: 0,
    saves: defaultSaves(mods, 2),
    skills,
    spellcastingAbility: "",
    spellAttack: 0,
    spellDc: 0,
    passivePerception: 0,
  });
  expect(proficient.passivePerception).toBe(14); // 10 + WIS 2 + PB 2

  // Expertise doubles the PB contribution: 10 + 2 + 2×2 = 16.
  const expertise = recalcCard({
    ...proficient,
    skills: skills.map((s) =>
      s.key === "察覺" ? { ...s, prof: "expertise" as const, total: skillTotal(mods["感知"] ?? 0, 2, "expertise") } : s,
    ),
  });
  expect(expertise.passivePerception).toBe(16);

  // Not proficient: 10 + WIS 2 = 12.
  const none = recalcCard({
    ...proficient,
    skills: defaultSkills(mods, 2),
  });
  expect(none.passivePerception).toBe(12);

  // A manual passivePerception override survives recalc only if the inputs it
  // derives from are unchanged — recalcCard is the full reset, so it always
  // re-derives. (The granular card-window handlers preserve overrides; that's
  // covered by the component tests.) Here we assert the formula root.
  expect(recalcCard({ ...proficient, passivePerception: 99 }).passivePerception).toBe(14);
});

// --- character-builder: L1 derivation ---

test("startingHpFor: hit die max + CON mod", () => {
  expect(startingHpFor(10, 2)).toBe(12); // d10 class, CON 14
  expect(startingHpFor(8, -1)).toBe(7); // d8 class, CON 8
  expect(startingHpFor(6, 0)).toBe(6); // d6 wizard, CON 10
});

test("acFor: every SRD armor category branch", () => {
  // 無甲 = 10 + DEX
  expect(acFor({ dexMod: 3 })).toEqual({ ac: 13, acFormula: "無甲 10 + 敏 3" });
  // 輕甲 = base + full DEX (leather base 11, DEX +2)
  expect(acFor({ dexMod: 2, armor: { base: 11, dexBonus: true }, armorLabel: "皮甲" }).ac).toBe(13);
  // 中甲 = base + min(DEX, 2) — hide base 12, DEX +3 → 14 not 15
  expect(acFor({ dexMod: 3, armor: { base: 12, dexBonus: true, maxBonus: 2 }, armorLabel: "獸皮甲" }).ac).toBe(14);
  // 重甲 = base, no DEX — chain mail base 16, DEX +3 → 16
  expect(acFor({ dexMod: 3, armor: { base: 16, dexBonus: false }, armorLabel: "鏈甲" })).toEqual({
    ac: 16,
    acFormula: "鏈甲 16",
  });
  // 盾 stacks +2 — leather (11) + DEX 2 + shield 2 = 15
  expect(acFor({ dexMod: 2, armor: { base: 11, dexBonus: true }, armorLabel: "皮甲", shield: true }).ac).toBe(15);
  // 法師護甲 = 13 + DEX
  expect(acFor({ dexMod: 3, unarmoredBase: 13 })).toEqual({ ac: 16, acFormula: "法師護甲 13 + 敏 3" });
  // 無甲防禦 = 10 + DEX + CON/WIS
  expect(acFor({ dexMod: 2, unarmoredExtraMod: 3 }).ac).toBe(15);
});

test("ability-score methods: standard array + point buy budget", () => {
  expect([...STANDARD_ARRAY]).toEqual([15, 14, 13, 12, 10, 8]);
  expect(POINT_BUY_BUDGET).toBe(27);
  expect(pointBuyCost(8)).toBe(0);
  expect(pointBuyCost(14)).toBe(7);
  expect(pointBuyCost(15)).toBe(9);
  expect(Number.isNaN(pointBuyCost(16))).toBe(true); // out of range
  // A legal 27-point spread (15,15,15,8,8,8 = 9+9+9 = 27)
  expect(pointBuyTotal([15, 15, 15, 8, 8, 8])).toBe(27);
  expect(pointBuyTotal([15, 14, 13, 12, 10, 8])).toBe(27); // standard array equivalent
});

test("applyRacialAsi: adds per-key increments and re-derives mods", () => {
  const base = ABILITY_KEYS.map((key) => ({ key, score: 14, mod: modFor(14) }));
  const out = applyRacialAsi(base, { 敏捷: 2, 智力: 1 });
  const dex = out.find((a) => a.key === "敏捷")!;
  const int = out.find((a) => a.key === "智力")!;
  const str = out.find((a) => a.key === "力量")!;
  expect(dex).toEqual({ key: "敏捷", score: 16, mod: 3 });
  expect(int).toEqual({ key: "智力", score: 15, mod: 2 });
  expect(str).toEqual({ key: "力量", score: 14, mod: 2 }); // untouched
});

test("spellSlotsL1For: caster types", () => {
  expect(spellSlotsL1For("full")).toBe(2);
  expect(spellSlotsL1For("pact")).toBe(1);
  expect(spellSlotsL1For("half")).toBe(0);
  expect(spellSlotsL1For("none")).toBe(0);
});
