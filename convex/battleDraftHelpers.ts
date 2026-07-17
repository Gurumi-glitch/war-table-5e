/**
 * Server-only lifecycle helpers for high-churn Battle drafts.
 *
 * This module has NO imports on purpose: it is the canonical home of the draft
 * slot-key format, which both the backend and the frontend must agree on, and
 * staying import-free lets `src/` pull `draftSlotKey` in without dragging the
 * Convex runtime into the browser bundle.
 */

export const normalSlotKey = "normal";

/**
 * A draft's storage key. Both sides MUST derive it here — the format is a wire
 * contract, and a copy that drifts orphans drafts silently.
 */
export const draftSlotKey = (
  scope: "normal" | "batch",
  actorId: string,
  runId?: string,
) => (scope === "normal" ? normalSlotKey : `batch:${runId ?? "legacy"}:${actorId}`);

async function clearDraftForConfirm(db: any, game: any, actorId: any) {
  const run = game.batchRun;
  const inBatch = run !== undefined && run.turnIds.includes(actorId);
  const slotKey = draftSlotKey(inBatch ? "batch" : "normal", actorId, run?.runId);
  const row = await db.query("battleDrafts")
    .withIndex("byGameAndSlotKey", (q: any) => q.eq("gameId", game._id).eq("slotKey", slotKey))
    .unique();
  if (row !== null) await db.delete(row._id);
}

async function clearBatchDrafts(db: any, gameId: any, runId: string | undefined) {
  const rows = await db.query("battleDrafts")
    .withIndex("byGame", (q: any) => q.eq("gameId", gameId))
    .take(100);
  await Promise.all(
    rows
      .filter((row: any) => row.scope === "batch" && (runId === undefined || row.runId === runId))
      .map((row: any) => db.delete(row._id)),
  );
}

async function removeCombatantDraftReferences(db: any, gameId: any, combatantId: any) {
  const rows = await db.query("battleDrafts")
    .withIndex("byGame", (q: any) => q.eq("gameId", gameId))
    .take(100);
  for (const row of rows as any[]) {
    if (row.actorId === combatantId) { await db.delete(row._id); continue; }
    const manualTargets = row.manualTargets.filter((target: any) => target.combatantId !== combatantId);
    const recipeTargets = row.recipeTargets.filter((target: any) => target.combatantId !== combatantId);
    if (manualTargets.length !== row.manualTargets.length || recipeTargets.length !== row.recipeTargets.length) {
      await db.patch(row._id, { manualTargets, recipeTargets, updatedAt: Date.now() });
    }
  }
}

async function removeChildDraftReferences(
  db: any,
  gameId: any,
  childId: any,
  kind: "recipe" | "resource",
) {
  const rows = await db.query("battleDrafts")
    .withIndex("byGame", (q: any) => q.eq("gameId", gameId))
    .take(100);
  for (const row of rows as any[]) {
    if (kind === "recipe") {
      const recipeTargets = row.recipeTargets.map((target: any) =>
        target.reactionRecipeId === childId ? { ...target, reactionRecipeId: undefined } : target,
      );
      if (row.recipeId === childId || JSON.stringify(recipeTargets) !== JSON.stringify(row.recipeTargets)) {
        await db.patch(row._id, {
          recipeId: row.recipeId === childId ? undefined : row.recipeId,
          recipeTargets,
          updatedAt: Date.now(),
        });
      }
    } else {
      const spendResources = row.spendResources.filter((spend: any) => spend.resourceId !== childId);
      if (spendResources.length !== row.spendResources.length) {
        await db.patch(row._id, { spendResources, updatedAt: Date.now() });
      }
    }
  }
}

/** A plain helper object, not a Convex function module surface. */
export const battleDraftHelpers = {
  clearDraftForConfirm,
  clearBatchDrafts,
  removeCombatantDraftReferences,
  removeChildDraftReferences,
};
