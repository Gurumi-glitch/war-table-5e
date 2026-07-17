import { test, expect } from "vitest";
import {
  applyDamageType,
  canonicalDamageType,
  computeDamage,
  computeHeal,
  applyHpWithTemp,
  grantTempHp,
  resolveAttack,
  resolveAutomatic,
  resolveSave,
} from "../convex/rules";

/**
 * Pure unit tests for the 5e rules engine (issue #7). Hit/miss vs AC, save vs
 * DC, R/V/I, nat-20 crit (dice doubled, not mod; saves excluded), healing cap,
 * and DM force overrides. Plus advantage/disadvantage (2d20 → max/min) and
 * save auto-fail (Stunned/Paralyzed/Petrified/Unconscious on STR/DEX).
 */

const noRvi = { resist: [], vuln: [], immune: [] };

test("resolveAttack: d20 + mod ≥ AC hits; nat 20 always hits + crits", () => {
  const hit = resolveAttack({
    d20s: [14], advantage: "none", attackMod: 3, targetAc: 16, damageDiceValues: [5], damageMod: 2,
    damageType: "slashing", rvi: noRvi, critImmune: false,
  });
  expect(hit.hit).toBe(true); // 14+3=17 ≥ 16
  expect(hit.crit).toBe(false);
  expect(hit.damage).toBe(7); // 5+2

  const miss = resolveAttack({
    d20s: [10], advantage: "none", attackMod: 3, targetAc: 16, damageDiceValues: [5], damageMod: 2,
    damageType: "slashing", rvi: noRvi, critImmune: false,
  });
  expect(miss.hit).toBe(false); // 10+3=13 < 16
  expect(miss.damage).toBe(0);

  const crit = resolveAttack({
    d20s: [20], advantage: "none", attackMod: -5, targetAc: 30, damageDiceValues: [5], damageMod: 2,
    damageType: "slashing", rvi: noRvi, critImmune: false,
  });
  expect(crit.hit).toBe(true); // nat 20 hits regardless
  expect(crit.crit).toBe(true);
  expect(crit.damage).toBe(12); // dice doubled (5*2) + mod 2, not (5+2)*2
});

test("nat 1 always misses; critImmune suppresses the crit (still hits on nat 20)", () => {
  const fumble = resolveAttack({
    d20s: [1], advantage: "none", attackMod: 30, targetAc: 5, damageDiceValues: [6], damageMod: 0,
    damageType: "slashing", rvi: noRvi, critImmune: false,
  });
  expect(fumble.hit).toBe(false);

  const noCrit = resolveAttack({
    d20s: [20], advantage: "none", attackMod: 0, targetAc: 5, damageDiceValues: [6], damageMod: 0,
    damageType: "force", rvi: noRvi, critImmune: true,
  });
  expect(noCrit.hit).toBe(true);
  expect(noCrit.crit).toBe(false);
  expect(noCrit.damage).toBe(6); // not doubled
});

test("resolveAttack advantage takes the higher die; disadvantage the lower", () => {
  // Advantage: 4 vs 18 → use 18, +3 = 21 ≥ 16 hit.
  const adv = resolveAttack({
    d20s: [4, 18], advantage: "advantage", attackMod: 3, targetAc: 16, damageDiceValues: [5], damageMod: 2,
    damageType: "slashing", rvi: noRvi, critImmune: false,
  });
  expect(adv.hit).toBe(true);
  expect(adv.attackTotal).toBe(21);

  // Disadvantage: 4 vs 18 → use 4, +3 = 7 < 16 miss.
  const dis = resolveAttack({
    d20s: [4, 18], advantage: "disadvantage", attackMod: 3, targetAc: 16, damageDiceValues: [5], damageMod: 2,
    damageType: "slashing", rvi: noRvi, critImmune: false,
  });
  expect(dis.hit).toBe(false);
});

test("resolveAttack advantage crits if either die is 20; disadvantage crits only if both are 20", () => {
  const advCrit = resolveAttack({
    d20s: [20, 2], advantage: "advantage", attackMod: 0, targetAc: 30, damageDiceValues: [5], damageMod: 0,
    damageType: "slashing", rvi: noRvi, critImmune: false,
  });
  expect(advCrit.hit).toBe(true);
  expect(advCrit.crit).toBe(true);

  // Disadvantage with [20, 15]: effective die is 15 → hits AC 10 but NOT a crit.
  const disNoCritHit = resolveAttack({
    d20s: [20, 15], advantage: "disadvantage", attackMod: 0, targetAc: 10, damageDiceValues: [5], damageMod: 0,
    damageType: "slashing", rvi: noRvi, critImmune: false,
  });
  expect(disNoCritHit.hit).toBe(true); // effective 15 ≥ 10
  expect(disNoCritHit.crit).toBe(false); // effective die 15, not 20
});

test("resolveAttack disadvantage fumbles if either die is 1", () => {
  const disFumble = resolveAttack({
    d20s: [1, 18], advantage: "disadvantage", attackMod: 30, targetAc: 5, damageDiceValues: [6], damageMod: 0,
    damageType: "slashing", rvi: noRvi, critImmune: false,
  });
  expect(disFumble.hit).toBe(false); // effective die 1 → auto-miss despite +30
});

test("applyDamageType: immunity negates, vulnerability doubles, resistance halves", () => {
  expect(applyDamageType(10, "fire", { resist: ["fire"], vuln: [], immune: [] }).applied).toBe(5);
  expect(applyDamageType(10, "fire", { resist: [], vuln: ["fire"], immune: [] }).applied).toBe(20);
  expect(applyDamageType(10, "fire", { resist: [], vuln: [], immune: ["fire"] }).applied).toBe(0);
  expect(applyDamageType(10, "fire", { resist: [], vuln: [], immune: [] }).applied).toBe(10);
  // Both vuln + resist: ×2 then floor(/2) = original (10).
  expect(applyDamageType(10, "fire", { resist: ["fire"], vuln: ["fire"], immune: [] }).applied).toBe(10);
  // Odd number: 11 vuln→22 resist→11 (floor).
  expect(applyDamageType(11, "fire", { resist: ["fire"], vuln: ["fire"], immune: [] }).applied).toBe(11);
});

test("canonicalDamageType normalizes zh/en/case/qualifiers to engine keys", () => {
  expect(canonicalDamageType("fire")).toBe("fire");
  expect(canonicalDamageType("火焰")).toBe("fire");
  expect(canonicalDamageType("Piercing")).toBe("piercing");
  expect(canonicalDamageType("穿刺")).toBe("piercing");
  expect(canonicalDamageType("壞死")).toBe("necrotic"); // synonym of 死靈
  expect(canonicalDamageType("揮砍（非魔法）")).toBe("slashing"); // qualifier stripped
  expect(canonicalDamageType("radiant (from stoneskin)")).toBe("radiant");
  expect(canonicalDamageType("聖水")).toBeNull(); // homebrew — unrecognized
});

test("applyDamageType matches across zh/en spellings (both sides normalized)", () => {
  // 敵人庫 zh chip vs a PC recipe's English damage type.
  expect(applyDamageType(10, "fire", { resist: ["火焰"], vuln: [], immune: [] }).applied).toBe(5);
  // PC English chip vs a bestiary attack's zh damage type.
  expect(applyDamageType(10, "穿刺", { resist: ["piercing"], vuln: [], immune: [] }).applied).toBe(5);
  // SRD capitalization.
  expect(applyDamageType(10, "Piercing", { resist: [], vuln: [], immune: ["piercing"] }).negated).toBe(true);
  // Unrecognized homebrew types still match themselves exactly.
  expect(applyDamageType(10, "聖水", { resist: ["聖水"], vuln: [], immune: [] }).applied).toBe(5);
  expect(applyDamageType(10, "聖水", { resist: ["fire"], vuln: [], immune: [] }).applied).toBe(10);
});

test("applyDamageType: resistAll (Petrified) halves every non-immune type", () => {
  expect(applyDamageType(10, "fire", { resist: [], vuln: [], immune: [], resistAll: true }).applied).toBe(5);
  expect(applyDamageType(10, "slashing", { resist: [], vuln: [], immune: [], resistAll: true }).applied).toBe(5);
  // Immunity still wins over resistAll.
  expect(applyDamageType(10, "fire", { resist: [], vuln: [], immune: ["fire"], resistAll: true }).applied).toBe(0);
  // Vuln then resistAll: 10 ×2 = 20, floor(/2) = 10.
  expect(applyDamageType(10, "fire", { resist: [], vuln: ["fire"], immune: [], resistAll: true }).applied).toBe(10);
});

test("computeDamage: crit doubles dice not mod; half-on-save floors", () => {
  const crit = computeDamage({
    diceValues: [4, 3], damageMod: 5, crit: true, damageType: "slashing", rvi: noRvi, half: false,
  });
  expect(crit.applied).toBe(19); // (4+3)*2 + 5
  expect(crit.doubled).toBe(true);

  const half = computeDamage({
    diceValues: [4, 3], damageMod: 5, crit: false, damageType: "fire", rvi: noRvi, half: true,
  });
  expect(half.applied).toBe(6); // floor((7+5)/2)
  expect(half.halved).toBe(true);

  // Healing bypasses R/V/I and never halves.
  const heal = computeDamage({
    diceValues: [4], damageMod: 3, crit: false, damageType: "healing",
    rvi: { resist: ["healing"], vuln: [], immune: ["healing"] }, half: true,
  });
  expect(heal.applied).toBe(7);
});

test("resolveSave: success halves damage, failure full; saves never crit", () => {
  const fail = resolveSave({
    saveD20s: [5], advantage: "none", autoFail: false, saveBonus: 2, dc: 15, damageDiceValues: [6, 6], damageMod: 0,
    damageType: "fire", rvi: noRvi,
  });
  expect(fail.success).toBe(false); // 5+2=7 < 15
  expect(fail.damage).toBe(12); // full

  const saved = resolveSave({
    saveD20s: [13], advantage: "none", autoFail: false, saveBonus: 2, dc: 15, damageDiceValues: [6, 6], damageMod: 0,
    damageType: "fire", rvi: noRvi,
  });
  expect(saved.success).toBe(true); // 13+2=15 ≥ 15
  expect(saved.damage).toBe(6); // floor(12/2)
});

test("resolveSave applies the target's R/V/I before halving", () => {
  const res = resolveSave({
    saveD20s: [20], advantage: "none", autoFail: false, saveBonus: 0, dc: 15, damageDiceValues: [10], damageMod: 0,
    damageType: "fire", rvi: { resist: ["fire"], vuln: [], immune: [] },
  });
  expect(res.success).toBe(true);
  // 10 → resist 5 → half floor(5/2) = 2
  expect(res.damage).toBe(2);
});

test("resolveSave autoFail forces failure (full damage) even with a nat 20; forceOutcome 'save' still wins", () => {
  const autoFail = resolveSave({
    saveD20s: [20], advantage: "none", autoFail: true, saveBonus: 10, dc: 5, damageDiceValues: [6, 6], damageMod: 0,
    damageType: "fire", rvi: noRvi,
  });
  expect(autoFail.success).toBe(false); // Stunned: STR/DEX auto-fails despite 20+10 ≥ 5
  expect(autoFail.damage).toBe(12); // full damage

  // DM authority (ADR-0002): forceOutcome "save" overrides the auto-fail.
  const forced = resolveSave({
    saveD20s: [20], advantage: "none", autoFail: true, saveBonus: 10, dc: 5, damageDiceValues: [6, 6], damageMod: 0,
    damageType: "fire", rvi: noRvi, forceOutcome: "save",
  });
  expect(forced.success).toBe(true);
  expect(forced.damage).toBe(6); // half
});

test("resolveSave advantage takes the higher die; disadvantage the lower", () => {
  const adv = resolveSave({
    saveD20s: [4, 18], advantage: "advantage", autoFail: false, saveBonus: 0, dc: 15, damageDiceValues: [10], damageMod: 0,
    damageType: "fire", rvi: noRvi,
  });
  expect(adv.success).toBe(true); // effective 18 ≥ 15
  expect(adv.saveTotal).toBe(18);

  const dis = resolveSave({
    saveD20s: [4, 18], advantage: "disadvantage", autoFail: false, saveBonus: 0, dc: 15, damageDiceValues: [10], damageMod: 0,
    damageType: "fire", rvi: noRvi,
  });
  expect(dis.success).toBe(false); // effective 4 < 15
});

test("resolveAutomatic: no d20, no crit; R/V/I applies", () => {
  const res = resolveAutomatic({
    damageDiceValues: [3, 3], damageMod: 1, damageType: "force",
    rvi: { resist: [], vuln: ["force"], immune: [] },
  });
  expect(res.damage).toBe(14); // (3+3+1)*2
});

test("computeHeal caps at maxHp", () => {
  const full = computeHeal({ diceValues: [8], healMod: 5, currentHp: 20, maxHp: 25 });
  expect(full.newHp).toBe(25);
  expect(full.heal).toBe(5); // 20+13 capped to 25 → +5

  const notCapped = computeHeal({ diceValues: [4], healMod: 2, currentHp: 10, maxHp: 30 });
  expect(notCapped.newHp).toBe(16);
  expect(notCapped.heal).toBe(6);
});

test("applyHpWithTemp: damage absorbs temp HP first, overflow hits real HP (PHB p.198)", () => {
  // 20/30 hp + 5 temp, take 7 → lose 5 temp, take 2 → 18/30, 0 temp.
  const r = applyHpWithTemp({ hp: 20, maxHp: 30, tempHp: 5, delta: -7 });
  expect(r.hp).toBe(18);
  expect(r.tempHp).toBe(0);

  // 20/30 + 5 temp, take 3 → fully absorbed by temp, hp untouched.
  const absorbed = applyHpWithTemp({ hp: 20, maxHp: 30, tempHp: 5, delta: -3 });
  expect(absorbed.hp).toBe(20);
  expect(absorbed.tempHp).toBe(2);

  // No temp: damage hits hp directly, floored at 0.
  const noTemp = applyHpWithTemp({ hp: 4, maxHp: 30, tempHp: 0, delta: -10 });
  expect(noTemp.hp).toBe(0);
  expect(noTemp.tempHp).toBe(0);
});

test("applyHpWithTemp: healing caps at maxHp and never restores temp HP (PHB p.198)", () => {
  // Heal past max → capped; temp unchanged.
  const capped = applyHpWithTemp({ hp: 20, maxHp: 25, tempHp: 5, delta: 13 });
  expect(capped.hp).toBe(25);
  expect(capped.tempHp).toBe(5);

  // Heal below max → full heal; temp untouched.
  const heal = applyHpWithTemp({ hp: 10, maxHp: 30, tempHp: 4, delta: 6 });
  expect(heal.hp).toBe(16);
  expect(heal.tempHp).toBe(4);
});

test("applyHpWithTemp: temp HP is not capped by maxHp (can exceed it)", () => {
  // A character at full HP can still hold a temp pool larger than the hp deficit.
  const full = applyHpWithTemp({ hp: 30, maxHp: 30, tempHp: 12, delta: -5 });
  expect(full.hp).toBe(30); // temp absorbs all 5
  expect(full.tempHp).toBe(7);
});

test("grantTempHp: does not stack — take the larger pool (PHB p.198)", () => {
  expect(grantTempHp(10, 12)).toBe(12); // new > old → take new
  expect(grantTempHp(10, 8)).toBe(10); // old > new → keep old
  expect(grantTempHp(0, 5)).toBe(5);
  expect(grantTempHp(10, 0)).toBe(10); // zero grant is a no-op
  expect(grantTempHp(10, -3)).toBe(10); // negative grant is a no-op
});

test("force overrides: force hit/miss/save/fail and forceDamage win over the engine", () => {
  const forcedHit = resolveAttack({
    d20s: [2], advantage: "none", attackMod: 0, targetAc: 30, damageDiceValues: [5], damageMod: 2,
    damageType: "slashing", rvi: noRvi, critImmune: false, forceOutcome: "hit",
  });
  expect(forcedHit.hit).toBe(true); // would normally miss
  expect(forcedHit.crit).toBe(false); // not a nat 20
  expect(forcedHit.damage).toBe(7);

  const forcedMiss = resolveAttack({
    d20s: [20], advantage: "none", attackMod: 30, targetAc: 5, damageDiceValues: [5], damageMod: 2,
    damageType: "slashing", rvi: noRvi, critImmune: false, forceOutcome: "miss",
  });
  expect(forcedMiss.hit).toBe(false); // nat 20 forced to miss
  expect(forcedMiss.damage).toBe(0);

  const forcedDamage = resolveAttack({
    d20s: [14], advantage: "none", attackMod: 3, targetAc: 16, damageDiceValues: [5], damageMod: 2,
    damageType: "slashing", rvi: noRvi, critImmune: false, forceOutcome: "hit", forceDamage: 42,
  });
  expect(forcedDamage.damage).toBe(42);

  const forcedSave = resolveSave({
    saveD20s: [2], advantage: "none", autoFail: false, saveBonus: 0, dc: 30, damageDiceValues: [10], damageMod: 0,
    damageType: "fire", rvi: noRvi, forceOutcome: "save",
  });
  expect(forcedSave.success).toBe(true);
  expect(forcedSave.damage).toBe(5); // half of 10
});
