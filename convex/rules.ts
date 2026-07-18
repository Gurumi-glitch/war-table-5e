/**
 * The 5e rules-calc engine (issue #7 / PRD US25–US29). PURE module — no Convex
 * runtime — imported by the backend Confirm (authoritative) and the frontend
 * preview. Like `modifiers.ts` and `dice.ts` helpers.
 *
 * Resolution model:
 * - **Attack** (d20 vs AC): d20 + attackMod ≥ target AC → hit; nat 20 → hit +
 *   crit (double the damage DICE, not the modifier); nat 1 → miss. Crit applies
 *   unless `critImmune`.
 * - **Save** (d20 vs DC): target's d20 + saveBonus ≥ dc → success. Damaging
 *   save spells deal half on a successful save. Saves NEVER crit.
 * - **Automatic** (no d20): no hit/save check — Magic Missile, healing. Never
 *   crit (Magic Missile is `critImmune`).
 *
 * Damage type / R/V/I: immunity negates (0); vulnerability doubles; resistance
 * halves (floor). Applied in order: immune → 0, else vuln (×2) then resist
 * (floor /2). Healing ("healing") bypasses R/V/I entirely.
 *
 * The DM is always the authority (ADR-0002): `forceOutcome` (hit/miss/save/fail)
 * and `forceDamage` override any computed value.
 */

import type { DieType } from "./diceHelpers";
import type { Advantage, ModifierSpec } from "./modifiers";

/** A recipe's hit type. */
export type HitType = "attack" | "save" | "automatic";

/** One dice term in a recipe's damage/heal expression, e.g. { type: "d6", count: 2 } = 2d6. */
export type DiceTerm = { type: DieType; count: number };

/** How an extra roll's dice are used: flavor-only, or added as damage. */
export type ExtraRollUsage = "roleplay" | "battle";

/**
 * A recipe-defined extra dice roll beyond the main attack/damage roll — e.g. a
 * d4 rolled for flavor (which direction to push something) or a second damage
 * roll (an elemental rider stacked on the weapon's base damage). Claimed and
 * consumed alongside the main roll's dice at Confirm, in the order the recipe
 * lists them, AFTER the main damage dice.
 * - `roleplay`: dice are claimed and recorded in the log; no math (no
 *   damageType/damageMod effect).
 * - `battle`: dice + damageMod are added to each target's damage, following
 *   the SAME hit/save/crit result as the main roll — own `damageType` for
 *   R/V/I, so a "1d4 fire" rider on a slashing weapon stays fire. A
 *   `"healing"` damageType HEALS the target instead (same gating; crit
 *   doubles the dice; never halved by a save).
 * v1 scope cut: not wired into `multiTarget: "darts"` at any hitType (darts
 * splits the actor's d4s per target, and extra rolls drawing from the same
 * claimed dice would collide with that allocation).
 */
export type ExtraRoll = {
  label: string;
  usage: ExtraRollUsage;
  dice: DiceTerm[];
  damageMod: number;
  damageType: string;
};

/** A recipe definition (mirrors the stored shape; pure module has no table). */
export type Recipe = {
  hitType: HitType;
  attackMod: number;
  damageDice: DiceTerm[];
  damageMod: number;
  damageType: string;
  dc: number;
  saveAbility: string;
  critImmune: boolean;
  resourceCost: number;
  multiTarget: "none" | "aoe" | "darts";
  // Modifier specs applied to the target on Confirm (non-damage buffs: Shield
  // +5 AC, True Strike adv. attack, …). Reuses the #5 Modifier model. Applied
  // by the Confirm handler, not the damage math here.
  appliesMods: ModifierSpec[];
  // Extra dice rolls beyond the main roll (issue: manual adv/disadv + extra
  // rolls request) — roleplay flavor dice or a second battle damage roll.
  extraRolls: ExtraRoll[];
};

/** A combatant's damage-type modifiers (the R/V/I lists on the combatant doc). */
export type DamageTypeMods = {
  resist: readonly string[];
  vuln: readonly string[];
  immune: readonly string[];
  /** True while a resist-all condition is active (Petrified) — halves every non-immune type. */
  resistAll?: boolean;
};

/** DM override of the computed outcome. */
export type ForceOutcome = "hit" | "miss" | "save" | "fail";

export type AttackResult = {
  hit: boolean;
  crit: boolean;
  attackTotal: number;
  nat20: boolean;
  nat1: boolean;
  damage: number;
  damageBreakdown: string;
};

export type SaveResult = {
  success: boolean;
  saveTotal: number;
  damage: number;
  damageBreakdown: string;
};

export type AutomaticResult = {
  damage: number;
  damageBreakdown: string;
};

export type HealResult = {
  heal: number;
  newHp: number;
  breakdown: string;
};

/**
 * Resolve an attack roll: d20 + attackMod vs targetAc. Nat 20 = hit + crit
 * (unless critImmune); nat 1 = miss. `forceOutcome` overrides hit/miss (and
 * suppresses crit when forced to miss). Returns the per-target damage after
 * R/V/I (and crit doubling) — or 0 on a miss.
 *
 * Advantage/disadvantage: `d20s` holds 1 die (neutral) or 2 (adv or disadv).
 * The effective die is the higher on advantage, the lower on disadvantage, else
 * the first. Nat-20/nat-1 are read off the EFFECTIVE die — this yields correct
 * 5e semantics (adv crits if either die is 20; adv fumbles only if both are 1;
 * disadv fumbles if either die is 1; disadv crits only if both are 20).
 */
export function resolveAttack(args: {
  d20s: readonly number[];
  advantage: Advantage;
  attackMod: number;
  targetAc: number;
  damageDiceValues: readonly number[];
  damageMod: number;
  damageType: string;
  rvi: DamageTypeMods;
  critImmune: boolean;
  forceOutcome?: ForceOutcome;
  forceDamage?: number | null;
}): AttackResult {
  const ds = args.d20s.length > 0 ? args.d20s : [1];
  const d20 =
    args.advantage === "advantage"
      ? Math.max(...ds)
      : args.advantage === "disadvantage"
        ? Math.min(...ds)
        : ds[0];
  const nat20 = d20 === 20;
  const nat1 = d20 === 1;
  const attackTotal = d20 + args.attackMod;
  let hit = nat20 || (!nat1 && attackTotal >= args.targetAc);
  let crit = nat20 && !args.critImmune;
  if (args.forceOutcome === "hit") {
    hit = true;
  } else if (args.forceOutcome === "miss") {
    hit = false;
    crit = false;
  }

  let damage = 0;
  let damageBreakdown = "";
  if (hit) {
    const raw = computeDamage({
      diceValues: args.damageDiceValues,
      damageMod: args.damageMod,
      crit,
      damageType: args.damageType,
      rvi: args.rvi,
      half: false,
    });
    damage = args.forceDamage ?? raw.applied;
    damageBreakdown = raw.breakdown;
  }
  return {
    hit,
    crit,
    attackTotal,
    nat20,
    nat1,
    damage,
    damageBreakdown,
  };
}

/**
 * Resolve a saving throw: d20 + saveBonus vs dc. Success → half damage (floor)
 * for damaging saves; failure → full. Saves never crit. `forceOutcome`
 * ("save"/"fail") overrides the save result — including overriding an auto-fail
 * (DM authority, ADR-0002): a Stunned target still saves if the DM forces "save".
 *
 * `saveD20s` holds 1 die (neutral) or 2 (adv or disadv); the effective die is
 * the higher on advantage, lower on disadvantage, else the first. `autoFail`
 * (Stunned/Paralyzed/Petrified/Unconscious on STR/DEX) forces failure unless
 * `forceOutcome:"save"`.
 */
export function resolveSave(args: {
  saveD20s: readonly number[];
  advantage: Advantage;
  autoFail: boolean;
  saveBonus: number;
  dc: number;
  damageDiceValues: readonly number[];
  damageMod: number;
  damageType: string;
  rvi: DamageTypeMods;
  forceOutcome?: ForceOutcome;
  forceDamage?: number | null;
}): SaveResult {
  const ds = args.saveD20s.length > 0 ? args.saveD20s : [1];
  const saveD20 =
    args.advantage === "advantage"
      ? Math.max(...ds)
      : args.advantage === "disadvantage"
        ? Math.min(...ds)
        : ds[0];
  const saveTotal = saveD20 + args.saveBonus;
  let success = args.autoFail ? false : saveTotal >= args.dc;
  if (args.forceOutcome === "save") success = true;
  else if (args.forceOutcome === "fail") success = false;

  const raw = computeDamage({
    diceValues: args.damageDiceValues,
    damageMod: args.damageMod,
    crit: false, // saves never crit
    damageType: args.damageType,
    rvi: args.rvi,
    half: success, // save-for-half on success
  });
  const damage = args.forceDamage ?? raw.applied;
  return { success, saveTotal, damage, damageBreakdown: raw.breakdown };
}

/**
 * Resolve an automatic action (no d20): Magic Missile, healing. Never crits.
 * Healing (damageType "healing") is routed to `computeHeal` by the caller via
 * `isHeal`; here we compute damage (R/V/I applied) for non-heal automatic.
 */
export function resolveAutomatic(args: {
  damageDiceValues: readonly number[];
  damageMod: number;
  damageType: string;
  rvi: DamageTypeMods;
  forceDamage?: number | null;
}): AutomaticResult {
  const raw = computeDamage({
    diceValues: args.damageDiceValues,
    damageMod: args.damageMod,
    crit: false,
    damageType: args.damageType,
    rvi: args.rvi,
    half: false,
  });
  const damage = args.forceDamage ?? raw.applied;
  return { damage, damageBreakdown: raw.breakdown };
}

/**
 * Compute damage from rolled dice values + a flat mod, applying crit (double the
 * dice, not the mod), then R/V/I, then save-for-half. `damageType === "healing"`
 * bypasses R/V/I (handled by `computeHeal` instead, but guarded here too).
 */
export function computeDamage(args: {
  diceValues: readonly number[];
  damageMod: number;
  crit: boolean;
  damageType: string;
  rvi: DamageTypeMods;
  half: boolean;
}): { applied: number; raw: number; breakdown: string; doubled: boolean; halved: boolean; negated: boolean } {
  const diceSum = args.diceValues.reduce((s, v) => s + v, 0);
  const doubledDice = args.crit ? diceSum * 2 : diceSum;
  const preMod = doubledDice;
  const raw = preMod + args.damageMod;

  // Healing bypasses R/V/I and never halves.
  if (args.damageType === "healing") {
    return {
      applied: raw,
      raw,
      breakdown: describe(raw, diceSum, args.damageMod, args.crit, false, false, args.damageType),
      doubled: args.crit,
      halved: false,
      negated: false,
    };
  }

  const typed = applyDamageType(raw, args.damageType, args.rvi);
  let applied = typed.applied;
  let halved = false;
  if (args.half) {
    applied = Math.floor(applied / 2);
    halved = true;
  }
  return {
    applied,
    raw,
    breakdown: describe(applied, diceSum, args.damageMod, args.crit, halved, typed.negated, args.damageType),
    doubled: args.crit,
    halved,
    negated: typed.negated,
  };
}

/**
 * Apply resistance/vulnerability/immunity to a raw damage amount. Immune → 0;
 * else vulnerability ×2, then resistance floor(/2). Healing bypasses (caller).
 */
export function applyDamageType(
  raw: number,
  damageType: string,
  mods: DamageTypeMods,
): { applied: number; negated: boolean } {
  // Both sides normalize through the alias map (zh/en/case/qualifiers) so a
  // 火焰 chip matches a "fire" attack; unrecognized strings match themselves.
  const canon = (s: string) => canonicalDamageType(s) ?? s.trim();
  const type = canon(damageType);
  const has = (list: readonly string[]) => list.some((t) => canon(t) === type);
  if (has(mods.immune)) {
    return { applied: 0, negated: true };
  }
  let applied = raw;
  if (has(mods.vuln)) applied = applied * 2;
  // Resistance to the type OR a resist-all condition (Petrified) halves, floor.
  if (has(mods.resist) || mods.resistAll) {
    applied = Math.floor(applied / 2);
  }
  return { applied, negated: false };
}

/**
 * Compute healing: dice + mod, added to currentHp, capped at maxHp. Healing is
 * not affected by R/V/I and never crits.
 */
export function computeHeal(args: {
  diceValues: readonly number[];
  healMod: number;
  currentHp: number;
  maxHp: number;
}): HealResult {
  const heal = args.diceValues.reduce((s, v) => s + v, 0) + args.healMod;
  const newHp = Math.min(args.maxHp, args.currentHp + heal);
  const actual = newHp - args.currentHp;
  return {
    heal: actual,
    newHp,
    breakdown: `${args.currentHp} + ${heal} → ${newHp}${actual < heal ? " (capped)" : ""}`,
  };
}

export type HpWithTempResult = {
  hp: number;
  tempHp: number;
  breakdown: string;
  /**
   * SRD § Instant Death: when damage reduces you to 0 and the remaining damage
   * (after temp absorption + bringing HP to 0) meets or exceeds your hit point
   * maximum, you die. This is a NON-BLOCKING flag — the DM decides whether to
   * apply death (forceOutcome kill) or just leave the combatant downed
   * (ADR-0002: manual override always wins; ADR-0008: non-blocking warning
   * pattern, like cantAct). Never auto-kills, never touches death saves (v2).
   */
  instantDeath: boolean;
};

/**
 * Resolve an HP delta against a combatant's full HP state, honouring 临时生命值
 * (PHB p.198). This is the single authority for "temp absorbs first, then real
 * HP, then clamp" — `computeDamage`/`computeHeal` only produce a delta; the
 * state transition lives here.
 *
 * - delta < 0 (damage): subtract from `tempHp` first; overflow hits `hp`,
 *   floored at 0. Temp HP can absorb part of a hit (5 temp vs 7 dmg → 0 temp, 2 hp).
 * - delta > 0 (healing): added to `hp`, capped at `maxHp`. Healing never restores
 *   temp HP (PHB p.198), so `tempHp` is returned unchanged.
 *
 * `tempHp` is NOT capped by `maxHp` — PHB p.198: temporary hit points can exceed
 * your maximum. Use `grantTempHp` to set the pool (it doesn't stack).
 */
export function applyHpWithTemp(args: {
  hp: number;
  maxHp: number;
  tempHp: number;
  delta: number;
}): HpWithTempResult {
  if (args.delta < 0) {
    const dmg = -args.delta;
    const absorbed = Math.min(args.tempHp, dmg);
    const tempHp = args.tempHp - absorbed;
    const remaining = dmg - absorbed;
    const hp = Math.max(0, args.hp - remaining);
    // SRD § Instant Death: overflow = damage left after HP hits 0. If that
    // equals or exceeds maxHp, the target should die (DM decides; non-blocking).
    const overflow = Math.max(0, remaining - args.hp);
    const instantDeath = overflow >= args.maxHp;
    const tempNote = args.tempHp > 0 ? `${args.tempHp}temp → ${tempHp}temp, ` : "";
    const deathNote = instantDeath
      ? ` ⚠ 即死:剩餘傷害 ≥ maxHp(${args.maxHp})`
      : "";
    return {
      hp,
      tempHp,
      breakdown: `${tempNote}${args.hp} −${remaining} → ${hp}${deathNote}`,
      instantDeath,
    };
  }
  // Healing: cap at maxHp, leave temp untouched.
  const uncapped = args.hp + args.delta;
  const hp = Math.min(args.maxHp, uncapped);
  return {
    hp,
    tempHp: args.tempHp,
    breakdown: `${args.hp} +${args.delta} → ${hp}${hp < uncapped ? " (capped)" : ""}`,
    instantDeath: false,
  };
}

/**
 * Grant temporary HP (PHB p.198). Temp HP does NOT stack: when you gain new temp
 * HP while you still have some, you choose to keep the old or take the new — not
 * add. `max` models the common table default (take the larger pool); a DM who
 * wants to keep the smaller old pool manually overwrites the field (ADR-0002:
 * manual override always wins). `granted <= 0` is a no-op (nothing granted).
 */
export function grantTempHp(currentTemp: number, granted: number): number {
  if (granted <= 0) return currentTemp;
  return Math.max(currentTemp, granted);
}

/** Build a human-readable damage/heal breakdown for the combat log. */
function describe(
  applied: number,
  diceSum: number,
  damageMod: number,
  crit: boolean,
  halved: boolean,
  negated: boolean,
  damageType: string,
): string {
  if (negated) return `${damageTypeLabel(damageType)} immune → 0`;
  const parts: string[] = [`${diceSum}${crit ? "×2" : ""}`];
  if (damageMod !== 0) parts.push(`${damageMod > 0 ? "+" : ""}${damageMod}`);
  parts.push(`= ${applied}${halved ? " (half)" : ""} ${damageTypeLabel(damageType)}`);
  return parts.join(" ");
}

/** All damage types the engine recognizes (informational; any string is allowed). */
export const DAMAGE_TYPES: readonly string[] = [
  "slashing",
  "piercing",
  "bludgeoning",
  "fire",
  "cold",
  "lightning",
  "thunder",
  "acid",
  "poison",
  "force",
  "necrotic",
  "radiant",
  "psychic",
  "healing",
];

/** zh display labels for the canonical damage types (stored keys stay English). */
export const DAMAGE_TYPE_LABELS: Record<string, string> = {
  slashing: "揮砍",
  piercing: "穿刺",
  bludgeoning: "鈍擊",
  fire: "火焰",
  cold: "寒冷",
  lightning: "閃電",
  thunder: "雷鳴",
  acid: "酸性",
  poison: "毒素",
  force: "力場",
  necrotic: "死靈",
  radiant: "光耀",
  psychic: "心靈",
  healing: "治療",
};

// Accepted spellings → canonical key: the English keys, the zh labels, plus
// synonyms observed in the bestiary / character-sheet data.
const DAMAGE_TYPE_ALIASES: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const key of DAMAGE_TYPES) {
    m[key] = key;
    m[DAMAGE_TYPE_LABELS[key]] = key;
  }
  return Object.assign(m, {
    壞死: "necrotic",
    冷凍: "cold",
    強酸: "acid",
    毒: "poison",
    精神: "psychic",
  });
})();

/**
 * Normalize a damage-type spelling to its canonical English key, or null when
 * unrecognized. Case-insensitive; strips （…）/(…) qualifiers (非魔法, "from
 * stoneskin") — the qualifier stays visible in the source text while the plain
 * type drives the math (the DM overrides at Confirm when it shouldn't apply).
 */
export function canonicalDamageType(raw: string): string | null {
  const t = raw.replace(/[（(][^（）()]*[）)]/g, "").trim().toLowerCase();
  return DAMAGE_TYPE_ALIASES[t] ?? null;
}

/** Display label (zh) for any damage-type spelling; unrecognized → as-is. */
export function damageTypeLabel(raw: string): string {
  return DAMAGE_TYPE_LABELS[canonicalDamageType(raw) ?? ""] ?? raw;
}
