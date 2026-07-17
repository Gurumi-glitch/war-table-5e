import { mutationGeneric as mutation, queryGeneric as query } from "convex/server";
import { v } from "convex/values";
import { resolveGame, type Role } from "./games";
import { normalSlotKey } from "./battleDraftHelpers";

export type BattleDraftView = {
  _id: string;
  slotKey: string;
  scope: "normal" | "batch";
  actorId: string | null;
  runId: string | null;
  recipeId: string | null;
  attackMod: string;
  actorAdvOverride: string;
  damageMod: string;
  damageType: string;
  dc: string;
  dartTotal: string;
  effectText: string;
  manualTargets: { combatantId: string; hpDelta: number }[];
  recipeTargets: {
    combatantId: string;
    saveBonus: string;
    forceOutcome: string;
    forceDamage: string;
    darts: string;
    reactionRecipeId: string;
    advOverride: string;
    saveMode: string;
  }[];
  spendResources: { resourceId: string; amount: number }[];
  modExcluded: string[];
  updatedAt: number;
  restricted?: boolean;
};

const targetValidator = v.object({ combatantId: v.union(v.id("combatants"), v.null()), hpDelta: v.number() });
const recipeTargetValidator = v.object({
  combatantId: v.union(v.id("combatants"), v.null()),
  saveBonus: v.string(),
  forceOutcome: v.string(),
  forceDamage: v.string(),
  darts: v.string(),
  reactionRecipeId: v.union(v.id("recipes"), v.null()),
  advOverride: v.string(),
  saveMode: v.string(),
});

const patchValidator = v.object({
  recipeId: v.optional(v.union(v.id("recipes"), v.null())),
  attackMod: v.optional(v.string()),
  actorAdvOverride: v.optional(v.string()),
  damageMod: v.optional(v.string()),
  damageType: v.optional(v.string()),
  dc: v.optional(v.string()),
  dartTotal: v.optional(v.string()),
  effectText: v.optional(v.string()),
  manualTargets: v.optional(v.array(targetValidator)),
  recipeTargets: v.optional(v.array(recipeTargetValidator)),
  spendResources: v.optional(v.array(v.object({ resourceId: v.id("resources"), amount: v.number() }))),
  modExcluded: v.optional(v.array(v.string())),
});

function emptyDraft(actorId?: string, scope: "normal" | "batch" = "normal", runId?: string) {
  return {
    scope,
    actorId: actorId as any,
    runId,
    recipeId: undefined,
    attackMod: "",
    actorAdvOverride: "",
    damageMod: "",
    damageType: "",
    dc: "",
    dartTotal: "3",
    effectText: "",
    manualTargets: [{ combatantId: undefined, hpDelta: 0 }],
    recipeTargets: [{ combatantId: undefined, saveBonus: "0", forceOutcome: "", forceDamage: "", darts: "0", reactionRecipeId: undefined, advOverride: "", saveMode: "" }],
    spendResources: [],
    modExcluded: [],
    updatedAt: Date.now(),
  };
}

async function combatantForGame(db: any, gameId: any, actorId: any) {
  if (actorId === undefined) return null;
  const actor = await db.get(actorId);
  if (actor === null || actor.gameId !== gameId) throw new Error("Combatant not found");
  return actor;
}

function ownsChild(child: any, actor: any) {
  return child !== null && (child.combatantId === actor._id || (actor.characterId !== undefined && child.characterId === actor.characterId));
}

async function validatePatchReferences(db: any, gameId: any, actor: any, patch: any) {
  if (patch.recipeId !== undefined && patch.recipeId !== null) {
    const recipe = await db.get(patch.recipeId);
    if (!ownsChild(recipe, actor)) throw new Error("Recipe not found on the acting combatant");
  }
  for (const target of patch.manualTargets ?? []) {
    if (target.combatantId !== null) await combatantForGame(db, gameId, target.combatantId);
  }
  for (const target of patch.recipeTargets ?? []) {
    const targetDoc = target.combatantId === null ? null : await combatantForGame(db, gameId, target.combatantId);
    if (target.reactionRecipeId !== null) {
      const reaction = await db.get(target.reactionRecipeId);
      if (!ownsChild(reaction, targetDoc)) throw new Error("Reaction recipe not found on target");
    }
  }
  for (const spend of patch.spendResources ?? []) {
    const resource = await db.get(spend.resourceId);
    if (!ownsChild(resource, actor)) throw new Error("Armed resource not found on the acting combatant");
  }
}

function projectDraft(row: any, role: Role, actor: any): BattleDraftView {
  const base = {
    _id: row._id,
    slotKey: row.slotKey,
    scope: row.scope,
    actorId: row.actorId ?? null,
    runId: row.runId ?? null,
    updatedAt: row.updatedAt,
  };
  const secret = role === "player" && actor !== null && actor.kind !== "pc" && actor.characterId === undefined;
  if (secret) return { ...base, restricted: true } as BattleDraftView;
  return {
    ...base,
    recipeId: row.recipeId ?? null,
    attackMod: row.attackMod,
    actorAdvOverride: row.actorAdvOverride,
    damageMod: row.damageMod,
    damageType: row.damageType,
    dc: row.dc,
    dartTotal: row.dartTotal,
    effectText: row.effectText,
    manualTargets: row.manualTargets.map((t: any) => ({ combatantId: t.combatantId ?? "", hpDelta: t.hpDelta })),
    recipeTargets: row.recipeTargets.map((t: any) => ({ ...t, combatantId: t.combatantId ?? "", reactionRecipeId: t.reactionRecipeId ?? "" })),
    spendResources: row.spendResources,
    modExcluded: row.modExcluded,
  };
}

export const getDrafts = query({
  args: { playerToken: v.string(), dmToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { game, role } = await resolveGame(ctx.db, args.playerToken, args.dmToken);
    const rows = await ctx.db.query("battleDrafts").withIndex("byGame", (q: any) => q.eq("gameId", game._id)).take(100);
    return await Promise.all(rows.map(async (row: any) => projectDraft(row, role, await combatantForGame(ctx.db, game._id, row.actorId))));
  },
});

async function requireSlot(ctx: any, args: any) {
  const { game } = await resolveGame(ctx.db, args.playerToken, args.dmToken);
  const actor = await combatantForGame(ctx.db, game._id, args.actorId);
  if (args.scope === "batch") {
    const run = game.batchRun;
    if (
      run === undefined ||
      (run.runId ?? "legacy") !== (args.runId ?? "legacy") ||
      !run.turnIds.includes(args.actorId)
    ) throw new Error("Batch draft is not in the active run");
  }
  const row = await ctx.db.query("battleDrafts").withIndex("byGameAndSlotKey", (q: any) => q.eq("gameId", game._id).eq("slotKey", args.slotKey)).unique();
  if (row !== null) return { game, actor, row };
  const id = await ctx.db.insert("battleDrafts", { gameId: game._id, slotKey: args.slotKey, ...emptyDraft(args.actorId, args.scope, args.runId) });
  return { game, actor, row: await ctx.db.get(id) };
}

export const patch = mutation({
  args: { playerToken: v.string(), dmToken: v.optional(v.string()), slotKey: v.string(), scope: v.union(v.literal("normal"), v.literal("batch")), actorId: v.id("combatants"), runId: v.optional(v.string()), patch: patchValidator },
  handler: async (ctx, args) => {
    const { game, actor, row } = await requireSlot(ctx, args);
    await validatePatchReferences(ctx.db, game._id, actor, args.patch);
    const next: any = { updatedAt: Date.now() };
    for (const [key, value] of Object.entries(args.patch)) {
      if (value === undefined) continue;
      if (key === "recipeId") next.recipeId = value === null ? undefined : value;
      else if (key === "manualTargets") next.manualTargets = (value as any[]).map((t) => ({ ...t, combatantId: t.combatantId === null ? undefined : t.combatantId }));
      else if (key === "recipeTargets") next.recipeTargets = (value as any[]).map((t) => ({ ...t, combatantId: t.combatantId === null ? undefined : t.combatantId, reactionRecipeId: t.reactionRecipeId === null ? undefined : t.reactionRecipeId }));
      else next[key] = value;
    }
    await ctx.db.patch(row!._id, next);
  },
});

export const selectNormalActor = mutation({
  args: { playerToken: v.string(), dmToken: v.optional(v.string()), actorId: v.id("combatants") },
  handler: async (ctx, args) => {
    const { game } = await resolveGame(ctx.db, args.playerToken, args.dmToken);
    await combatantForGame(ctx.db, game._id, args.actorId);
    const row = await ctx.db.query("battleDrafts").withIndex("byGameAndSlotKey", (q: any) => q.eq("gameId", game._id).eq("slotKey", normalSlotKey)).unique();
    const draft = emptyDraft(args.actorId);
    if (row === null) await ctx.db.insert("battleDrafts", { gameId: game._id, slotKey: normalSlotKey, ...draft });
    else await ctx.db.patch(row._id, draft);
  },
});
