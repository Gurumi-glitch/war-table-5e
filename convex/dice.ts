import { mutationGeneric as mutation } from "convex/server";
import { v } from "convex/values";
import { resolveGame } from "./games";
import {
  DICE_SIDES,
  rollDie,
  dieTypeValidator,
  type DieType,
} from "./diceHelpers";

/**
 * The Dice Board — a shared grid of pre-rolled dice grouped by type, refreshed
 * by a Batch roll. A combatant Claims dice in their Color; the claimed dice of
 * a type are their roll for the pending action. Nothing commits until Confirm
 * (Slice 3 / PRD US14–US18). All board operations are open to either role —
 * the only DM-only distinction is reading DM-only fields (ADR-0002).
 *
 * Pure helpers (DieType, DICE_TYPES, summarizeRoll, …) live in `./diceHelpers`
 * so the frontend can import them without bundling these Convex mutations.
 * They're re-exported below for backend backward-compat (`import … from "./dice"`).
 */
export type { DieType } from "./diceHelpers";
export {
  DICE_TYPES,
  DICE_SIDES,
  BOARD_LAYOUT,
  rollDie,
  rollD20WithAdvantage,
  summarizeRoll,
  dieTypeValidator,
} from "./diceHelpers";

/**
 * Refresh some or all of the Dice Board (a Batch roll). If `types` is omitted,
 * every die is rerolled; otherwise only dice of the given types. Rerolled dice
 * are released (claims cleared) — a fresh board carries no stale claims. Either
 * role may batch-roll (PRD US15, open-buttons ethos).
 *
 * Locked during a Batch battle run (issue #8): the run's single Batch roll
 * serves every turn — no rerolling between Confirms. End the run to unlock.
 * Single-die reroll / manual entry stay open (pre-Confirm Claim adjustment;
 * manual override always wins).
 */
export const batchRoll = mutation({
  args: {
    playerToken: v.string(),
    types: v.optional(v.array(dieTypeValidator)),
  },
  handler: async (ctx, args) => {
    const { game } = await resolveGame(ctx.db, args.playerToken);
    if (game.batchRun !== undefined) {
      throw new Error(
        "Batch roll is locked during a Batch battle run — end the run first",
      );
    }
    const dice = await ctx.db
      .query("dice")
      .withIndex("byGame", (q: any) => q.eq("gameId", game._id))
      .collect();
    const want = new Set(args.types);
    const all = args.types === undefined;
    await Promise.all(
      dice
        .filter((d: any) => all || want.has(d.type))
        .map((d: any) =>
          ctx.db.patch(d._id, {
            value: rollDie(DICE_SIDES[d.type as DieType]),
            // Release: a rerolled die is unclaimed.
            claimedBy: undefined,
          }),
        ),
    );
  },
});

/**
 * Claim a die for a combatant (their Color), or release it by passing null.
 * Either role may claim for any combatant (PRD US16, open-buttons ethos).
 */
export const setDieClaim = mutation({
  args: {
    playerToken: v.string(),
    dieId: v.id("dice"),
    claimedBy: v.union(v.id("combatants"), v.null()),
  },
  handler: async (ctx, args) => {
    const { game } = await resolveGame(ctx.db, args.playerToken);
    const die = await ctx.db.get(args.dieId);
    if (die === null || die.gameId !== game._id) {
      throw new Error("Die not found");
    }
    if (args.claimedBy !== null) {
      const combatant = await ctx.db.get(args.claimedBy);
      if (combatant === null || combatant.gameId !== game._id) {
        throw new Error("Combatant not found");
      }
    }
    // undefined clears the optional field (matches the currentTurnId clear in
    //combatants.ts remove); an id sets it.
    await ctx.db.patch(args.dieId, {
      claimedBy: args.claimedBy === null ? undefined : args.claimedBy,
    });
  },
});

/**
 * Selectively reroll a single die. Keeps any claim (the combatant still claims
 * it, just a new value). Either role (PRD US17, open-buttons ethos).
 */
export const rerollDie = mutation({
  args: {
    playerToken: v.string(),
    dieId: v.id("dice"),
  },
  handler: async (ctx, args) => {
    const { game } = await resolveGame(ctx.db, args.playerToken);
    const die = await ctx.db.get(args.dieId);
    if (die === null || die.gameId !== game._id) {
      throw new Error("Die not found");
    }
    await ctx.db.patch(args.dieId, {
      value: rollDie(DICE_SIDES[die.type as DieType]),
    });
  },
});

/**
 * Manually enter/override a die's value (ADR-0002: manual override always
 * wins). Keeps any claim. Either role (PRD US17, open-buttons ethos).
 */
export const setDieValue = mutation({
  args: {
    playerToken: v.string(),
    dieId: v.id("dice"),
    value: v.number(),
  },
  handler: async (ctx, args) => {
    const { game } = await resolveGame(ctx.db, args.playerToken);
    const die = await ctx.db.get(args.dieId);
    if (die === null || die.gameId !== game._id) {
      throw new Error("Die not found");
    }
    await ctx.db.patch(args.dieId, { value: args.value });
  },
});
