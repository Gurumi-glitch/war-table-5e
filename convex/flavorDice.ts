import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { resolveGame } from "./games";
import { DICE_TYPES, DICE_SIDES, rollDie, type DieType } from "./diceHelpers";

/**
 * Flavor dice (add-map-system): a shared/synced NON-combat mini dice board — one
 * die each of d20/d12/d10/d8/d6/d4 plus a percentile (d100), per Game, for
 * out-of-combat rolls (a Perception check) that still need table-wide
 * auditability (ADR-0007's "private rolls invite disputes" rationale).
 *
 * Deliberately distinct from the combat `dice` table (ADR-0007): no claiming, no
 * batch semantics, exactly one row per type. Rolling here never touches `dice`,
 * the combat log, or any Confirm state — keeping the two boards separate makes
 * "this table is never read by combatLog.ts" trivially auditable. Any caller
 * holding a valid game token may roll any time; there is no DM gate and no turn
 * requirement.
 */

/** A flavor die as projected to a client. `value` is null until first rolled. */
export type FlavorDieView = {
  _id: string;
  _creationTime: number;
  gameId: string;
  type: DieType;
  value: number | null;
};

const flavorTypeValidator = v.union(
  v.literal("d20"),
  v.literal("d12"),
  v.literal("d10"),
  v.literal("d8"),
  v.literal("d6"),
  v.literal("d4"),
  v.literal("d100"),
);

/**
 * Lazily create the seven flavor-die rows (one per type) for a Game if they are
 * missing. Idempotent: existing rows are left untouched, so this is safe to call
 * on every roll. Runs only in a mutation (it inserts).
 */
async function ensureBoard(db: any, gameId: string): Promise<void> {
  const existing = await db
    .query("flavorDice")
    .withIndex("byGame", (q: any) => q.eq("gameId", gameId))
    .collect();
  const have = new Set(existing.map((d: any) => d.type));
  for (const type of DICE_TYPES) {
    if (!have.has(type)) {
      await db.insert("flavorDice", { gameId, type, value: undefined });
    }
  }
}

/**
 * Roll one flavor die. Lazily seeds the board on first use, then sets a fresh
 * random face on the given type. Open — any caller, any time, no claim. Touches
 * only `flavorDice`; never the combat `dice` table or Confirm state.
 */
export const roll = mutation({
  args: {
    playerToken: v.string(),
    type: flavorTypeValidator,
  },
  handler: async (ctx, args) => {
    const { game } = await resolveGame(ctx.db, args.playerToken);
    await ensureBoard(ctx.db, game._id);
    const die = await ctx.db
      .query("flavorDice")
      .withIndex("byGame", (q) => q.eq("gameId", game._id))
      .collect();
    const row = die.find((d) => d.type === args.type);
    if (row === undefined) throw new Error("Flavor die not found after ensure");
    await ctx.db.patch(row._id, { value: rollDie(DICE_SIDES[args.type]) });
  },
});

/**
 * List the Game's flavor dice, sorted in board-type order. Open to either role
 * (shared/synced — every roll is visible to the whole table). Returns whatever
 * rows exist; before anyone has rolled, the board may be empty and the UI
 * renders the seven types as "not yet rolled".
 */
export const list = query({
  args: { playerToken: v.string() },
  handler: async (ctx, args) => {
    const { game } = await resolveGame(ctx.db, args.playerToken);
    const die = await ctx.db
      .query("flavorDice")
      .withIndex("byGame", (q) => q.eq("gameId", game._id))
      .collect();
    const rank = new Map<string, number>(DICE_TYPES.map((t, i) => [t, i]));
    const views: FlavorDieView[] = [...die]
      .sort((a, b) => (rank.get(a.type) ?? 99) - (rank.get(b.type) ?? 99))
      .map((d) => ({
        _id: d._id,
        _creationTime: d._creationTime,
        gameId: d.gameId,
        type: d.type,
        value: d.value ?? null,
      }));
    return views;
  },
});
