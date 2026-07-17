import { v } from "convex/values";
import type { DiceTerm, ExtraRoll } from "./rules";

/**
 * PURE dice helpers — no Convex runtime (no `mutation`/`query`). Imported by
 * the frontend (DiceBoard, ConfirmPanel) AND the backend (dice.ts mutations,
 * combatLog, games). Keeping these out of `dice.ts` (which exports the board
 * mutations) means the browser bundle never pulls Convex server functions —
 * the "Convex functions should not be imported in the browser" warning.
 *
 * `v` from `convex/values` is isomorphic (validator builder), so importing it
 * here is browser-safe.
 * `DiceTerm`/`ExtraRoll` are type-only imports from `./rules` — erased at
 * runtime, so they do not reintroduce a circular dependency.
 */

/** The seven die types on the board, in render order. "d100" = percentile. */
export type DieType =
  | "d20"
  | "d12"
  | "d10"
  | "d8"
  | "d6"
  | "d4"
  | "d100";

export const DICE_TYPES: readonly DieType[] = [
  "d20",
  "d12",
  "d10",
  "d8",
  "d6",
  "d4",
  "d100",
];

/** Number of sides per die type. */
export const DICE_SIDES: Record<DieType, number> = {
  d20: 20,
  d12: 12,
  d10: 10,
  d8: 8,
  d6: 6,
  d4: 4,
  d100: 100,
};

/**
 * How many of each type make up a fresh board. Matches the reference sheet
 * (infos/DND 六人角色卡.xlsx → 手動戰鬥台): 25 of each type laid out as vertical
 * columns, 7 types × 25 = 175 dice. "Many of each" — big enough to serve a run
 * of turns (Batch battle, later) without rerolling mid-run.
 */
export const BOARD_LAYOUT: Record<DieType, number> = {
  d20: 25,
  d12: 25,
  d10: 25,
  d8: 25,
  d6: 25,
  d4: 25,
  d100: 25,
};

/** Validator for a die-type union, reused across board mutations. */
const dieTypeValidator = v.union(
  v.literal("d20"),
  v.literal("d12"),
  v.literal("d10"),
  v.literal("d8"),
  v.literal("d6"),
  v.literal("d4"),
  v.literal("d100"),
);
export { dieTypeValidator };

/**
 * Roll a single die. Pure: takes an injectable `rng` (defaults to Math.random)
 * so tests can seed deterministic rolls. Returns 1..sides inclusive.
 */
export function rollDie(sides: number, rng: () => number = Math.random): number {
  return 1 + Math.floor(rng() * sides);
}

/**
 * Roll a d20 honoring advantage/disadvantage: 1 die neutral, 2 dice (taking
 * the higher/lower) otherwise — same effective-die rule as claimed-dice
 * attack/save rolls (`resolveAttack`/`resolveSave` in rules.ts), reused for
 * bulk-rolled (not claimed-dice) contexts like `rollInitiative`. Pure:
 * injectable `rng` so tests can seed deterministic rolls.
 */
export function rollD20WithAdvantage(
  advantage: "advantage" | "disadvantage" | "none",
  rng: () => number = Math.random,
): number {
  if (advantage === "none") return rollDie(20, rng);
  const rolls = [rollDie(20, rng), rollDie(20, rng)];
  return advantage === "disadvantage" ? Math.min(...rolls) : Math.max(...rolls);
}

/**
 * Summarize a set of claimed dice as a human-readable roll string, grouping by
 * type in board order. e.g. "d20: 14 · 3d6: 4+2+5 = 11". Empty input → "".
 *
 * d20s are NEVER summed: two claimed d20s mean advantage/disadvantage (the
 * engine picks the higher/lower via `resolveAttack`/`resolveSave`), so they are
 * listed as "2d20: 6, 13" rather than "6+13 = 19". Every other die type is
 * additive damage and is summed.
 */
export function summarizeRoll(
  claimed: ReadonlyArray<{ type: DieType; value: number }>,
): string {
  const parts: string[] = [];
  for (const type of DICE_TYPES) {
    const oftype = claimed.filter((d) => d.type === type);
    if (oftype.length === 0) continue;
    const values = oftype.map((d) => d.value);
    const label = oftype.length === 1 ? type : `${oftype.length}${type}`;
    if (oftype.length === 1) {
      parts.push(`${label}: ${values[0]}`);
    } else if (type === "d20") {
      // Advantage/disadvantage — list the dice, don't add them up.
      parts.push(`${label}: ${values.join(", ")}`);
    } else {
      const sum = values.reduce((a, b) => a + b, 0);
      parts.push(`${label}: ${values.join("+")} = ${sum}`);
    }
  }
  return parts.join(" · ");
}

/**
 * Sequential dice-term consumption from claimed dice: each `.take(terms)` call
 * consumes the NEXT unused dice of each type, so main damage dice and extra rolls
 * draw distinct claimed dice even when they share a die type (e.g. main damage
 * 1d8 + an extra-roll 1d8 rider each get their own d8).
 */
export function makeDiceCursor(claims: ReadonlyArray<{ type: DieType; value: number }>) {
  const pools = new Map<DieType, number[]>();
  for (const c of claims) {
    const arr = pools.get(c.type);
    if (arr) arr.push(c.value);
    else pools.set(c.type, [c.value]);
  }
  const taken = new Map<DieType, number>();
  return {
    take(terms: ReadonlyArray<DiceTerm>): number[] {
      const values: number[] = [];
      for (const term of terms) {
        const pool = pools.get(term.type) ?? [];
        const start = taken.get(term.type) ?? 0;
        const got = pool.slice(start, start + term.count);
        taken.set(term.type, start + got.length);
        values.push(...got);
      }
      return values;
    },
  };
}

/**
 * Consume a recipe's `extraRolls` from a dice cursor (called once per Confirm,
 * AFTER the main damage dice, in the recipe's list order). Roleplay rolls are
 * summarized into one log note; battle rolls are returned for the per-target
 * damage loop to apply with their own damageType/crit/half. Not wired into
 * `multiTarget: "darts"` — its bespoke per-dart splitting would collide with
 * cursor-based consumption (v1 scope cut, see `ExtraRoll` in rules.ts).
 */
export function consumeExtraRolls(
  cursor: ReturnType<typeof makeDiceCursor>,
  extraRolls: readonly ExtraRoll[],
): { battleRolls: { roll: ExtraRoll; values: number[] }[]; roleplayNote: string } {
  const battleRolls: { roll: ExtraRoll; values: number[] }[] = [];
  const roleplayParts: string[] = [];
  for (const roll of extraRolls) {
    const values = cursor.take(roll.dice);
    if (roll.usage === "battle") {
      battleRolls.push({ roll, values });
    } else {
      roleplayParts.push(`${roll.label}: ${values.length > 0 ? values.join(", ") : "(unclaimed)"}`);
    }
  }
  return { battleRolls, roleplayNote: roleplayParts.join("; ") };
}

/**
 * Generates an unguessable token used to identify a Game or grant a role.
 * The DM token is the only credential in the system (no login); the player
 * token is the public Game identifier shared in the player URL.
 * Available in the Convex runtime and in Node >= 19.
 */
export function generateToken(): string {
  return crypto.randomUUID();
}

/**
 * Lite-initiative ordering: highest initiative first, ties broken by insertion
 * order (stable). Shared by projection and turn advancement so the turn-order
 * rule lives in one place.
 */
export function byInitiative(a: { initiative: number; order: number }, b: { initiative: number; order: number }): number {
  return b.initiative - a.initiative || a.order - b.order;
}
