import { mutationGeneric as mutation } from "convex/server";
import { v } from "convex/values";
import { resolveChild, resolveChildOwner } from "./characters";
import { resolveGame } from "./games";
import { battleDraftHelpers } from "./battleDraftHelpers";

/**
 * Resources (issue #7 minimal): per-combatant pools with current/max (spell
 * slots, Lay on Hands, etc.). Consumed by recipes at Confirm; restoration is
 * manual in v1 (DM edits current/max — no rest automation). Open to either role.
 */

/** A resource as projected to a role (shared — not DM-only). */
export type ResourceView = {
  _id: string;
  _creationTime: number;
  combatantId: string;
  label: string;
  current: number;
  max: number;
  icon?: string;
  color?: string;
};

/**
 * Add a resource pool. Owner is EITHER a combatant (a linked PC's resources
 * are redirected onto its character — campaign state, issue #9) OR a character
 * directly (the card window, no combatant in play). Either role.
 */
export const add = mutation({
  args: {
    playerToken: v.string(),
    combatantId: v.optional(v.id("combatants")),
    characterId: v.optional(v.id("characters")),
    label: v.string(),
    max: v.number(),
    current: v.optional(v.number()),
    icon: v.optional(v.string()),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const owner = await resolveChildOwner(
      ctx.db,
      args.playerToken,
      args.combatantId,
      args.characterId,
    );
    const id = await ctx.db.insert("resources", {
      ...owner.fields,
      label: args.label,
      current: args.current ?? args.max,
      max: args.max,
      icon: args.icon,
      color: args.color,
    });
    return id;
  },
});

/**
 * Edit a resource's label / current / max / icon / color. Either role.
 * Manual override wins. `color: null` explicitly clears a color override
 * (falls back to the combatant's identity color) — omitting the arg leaves
 * it untouched, same `null`-clears/`undefined`-untouched convention as
 * `combatLog.ts`'s `claimedBy` reset.
 */
export const update = mutation({
  args: {
    playerToken: v.string(),
    resourceId: v.id("resources"),
    label: v.optional(v.string()),
    current: v.optional(v.number()),
    max: v.optional(v.number()),
    icon: v.optional(v.string()),
    color: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const resource = await resolveResource(ctx.db, args.playerToken, args.resourceId);
    const patch: Record<string, unknown> = {};
    if (args.label !== undefined) patch.label = args.label;
    if (args.max !== undefined) patch.max = args.max;
    if (args.current !== undefined) {
      // Clamp current to [0, max] using the effective max.
      const max = args.max ?? resource.max;
      patch.current = Math.max(0, Math.min(args.current, max));
    }
    if (args.icon !== undefined) patch.icon = args.icon;
    if (args.color !== undefined) patch.color = args.color === null ? undefined : args.color;
    await ctx.db.patch(resource._id, patch);
  },
});

/** Remove a resource pool. Either role. */
export const remove = mutation({
  args: {
    playerToken: v.string(),
    resourceId: v.id("resources"),
  },
  handler: async (ctx, args) => {
    const resource = await resolveResource(ctx.db, args.playerToken, args.resourceId);
    const { game } = await resolveGame(ctx.db, args.playerToken);
    await battleDraftHelpers.removeChildDraftReferences(ctx.db, game._id, resource._id, "resource");
    await ctx.db.delete(resource._id);
  },
});

/** Resolve a resource by id, authorizing via its owner. */
const resolveResource = (db: any, playerToken: string, resourceId: string) =>
  resolveChild(db, playerToken, resourceId, "Resource");
