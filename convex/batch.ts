import { mutationGeneric as mutation } from "convex/server";
import { v } from "convex/values";
import { resolveGame } from "./games";
import { DICE_SIDES, rollDie, byInitiative, generateToken, type DieType } from "./diceHelpers";
import { battleDraftHelpers } from "./battleDraftHelpers";

/**
 * Batch battle (issue #8): an optional flow for resolving a run of consecutive
 * same-side turns from a single Batch roll. Starting a run performs one fresh
 * Batch roll and snapshots the queue (initiative order); each combatant then
 * Claims and Confirms from that same pre-rolled board — `dice.batchRoll` is
 * locked until the run ends (the no-reroll invariant). Between Confirms the DM
 * may toggle Conditions on any combatant; their active Modifiers feed the next
 * Confirm's math automatically because Confirm computes Effective stats live.
 *
 * The run is a guide, never a gatekeeper (ADR-0002): Confirms by combatants
 * out of queue order are allowed (reactions, DM improvisation) — they simply
 * don't advance the pointer. Single-die reroll and manual value entry stay
 * open during a run too: they are pre-Confirm Claim adjustments, not a board
 * refresh. All mutations are open to either role (open-buttons ethos).
 */

/**
 * Advance a run's pointer past a completed (or skipped) turn. When the queue is
 * exhausted the run ends — `batchRun` is cleared and batch rolls unlock. While
 * the run continues, `currentTurnId` follows the pointer so the existing turn
 * highlight shows whose Confirm is next. Shared by `advanceBatchTurn` (manual
 * skip) and `combatLog.confirm` (auto-advance on the current runner's Confirm).
 */
export async function advanceRunPointer(db: any, game: any): Promise<void> {
  const run = game.batchRun;
  if (run === undefined) return;
  const next = run.turnIndex + 1;
  if (next >= run.turnIds.length) {
    // Run complete: back to the normal flow.
    await battleDraftHelpers.clearBatchDrafts(db, game._id, run.runId);
    await db.patch(game._id, { batchRun: undefined });
  } else {
    await db.patch(game._id, {
      batchRun: { ...run, turnIndex: next },
      currentTurnId: run.turnIds[next],
    });
  }
}

/**
 * Start a Batch battle run: one fresh Batch roll (every die rerolled, all
 * claims released), then snapshot the queue — the given combatants (or all
 * alive ones) in initiative order. The pre-rolled board serves the whole run.
 * Throws if a run is already active (end it first). Either role.
 */
export const startBatchRun = mutation({
  args: {
    playerToken: v.string(),
    // The run's combatants (e.g. all players before the boss). Omitted = every
    // living combatant. Order is ignored — the queue is initiative order.
    combatantIds: v.optional(v.array(v.id("combatants"))),
  },
  handler: async (ctx, args) => {
    const { game } = await resolveGame(ctx.db, args.playerToken);
    if (game.batchRun !== undefined) {
      throw new Error("A Batch battle run is already active — end it first");
    }
    const combatants = await ctx.db
      .query("combatants")
      .withIndex("byGame", (q: any) => q.eq("gameId", game._id))
      .collect();
    let members: any[];
    if (args.combatantIds !== undefined) {
      const want = new Set<string>(args.combatantIds);
      members = combatants.filter((c: any) => want.has(c._id));
      if (members.length !== want.size) {
        throw new Error("Combatant not found");
      }
    } else {
      members = combatants.filter((c: any) => c.alive);
    }
    if (members.length === 0) {
      throw new Error("A Batch battle run needs at least one combatant");
    }
    const turnIds = [...members].sort(byInitiative).map((c: any) => c._id);

    // The single Batch roll the run resolves from: reroll everything, release
    // every claim — a fresh board with no stale state.
    const dice = await ctx.db
      .query("dice")
      .withIndex("byGame", (q: any) => q.eq("gameId", game._id))
      .collect();
    await Promise.all(
      dice.map((d: any) =>
        ctx.db.patch(d._id, {
          value: rollDie(DICE_SIDES[d.type as DieType]),
          claimedBy: undefined,
        }),
      ),
    );

    await ctx.db.patch(game._id, {
      batchRun: {
        runId: generateToken(),
        turnIds,
        turnIndex: 0,
      },
      currentTurnId: turnIds[0],
    });
  },
});

/**
 * Skip past the current run turn without a Confirm (stunned combatant, held
 * action, DM's call). Ends the run when the queue is exhausted. Either role.
 */
export const advanceBatchTurn = mutation({
  args: {
    playerToken: v.string(),
  },
  handler: async (ctx, args) => {
    const { game } = await resolveGame(ctx.db, args.playerToken);
    if (game.batchRun === undefined) {
      throw new Error("No Batch battle run is active");
    }
    await advanceRunPointer(ctx.db, game);
  },
});

/**
 * End the run early (or abandon it). Batch rolls unlock; the normal
 * one-action-per-Confirm flow resumes. Either role.
 */
export const endBatchRun = mutation({
  args: {
    playerToken: v.string(),
  },
  handler: async (ctx, args) => {
    const { game } = await resolveGame(ctx.db, args.playerToken);
    await battleDraftHelpers.clearBatchDrafts(ctx.db, game._id, game.batchRun?.runId);
    await ctx.db.patch(game._id, { batchRun: undefined });
  },
});
