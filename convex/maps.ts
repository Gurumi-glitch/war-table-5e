import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireDm, resolveGame } from "./games";
import { deleteBlobIfPresent } from "./pieces";

/**
 * Map library (add-map-system / ADR-0011): a DM-managed set of image + grid maps
 * per Game, one active at a time. Map management (create/remove/setActive/
 * updateGrid) is DM-only — staging the scene is a DM job, consistent with how
 * Enemy DB management is gated (ADR-0005). Viewing (`list`) is open to either
 * role, since players must see the active board.
 *
 * Images live in Convex file storage (`ctx.storage`) — the first use of file
 * storage in this codebase. The client uploads directly to a `generateUploadUrl`
 * URL, then passes the resulting storage id to `create`; reads resolve through a
 * signed URL in `list` (`ctx.storage.getUrl`).
 *
 * Nothing here is read by combat resolution — positions/maps are visual only.
 */

/** A map as projected to a client, with its image resolved to a signed URL. */
export type MapView = {
  _id: string;
  _creationTime: number;
  gameId: string;
  name: string;
  imageStorageId: string;
  imageUrl: string | null;
  cols: number;
  rows: number;
  imageWidth: number | null;
  imageHeight: number | null;
};

/**
 * Prove a Map belongs to the authenticated Game before any mutation touches it.
 * Missing and foreign Maps throw the same generic error, so a mutation never
 * reveals whether a supplied id belongs to another Game (issue #13).
 */
async function requireOwnedMap(
  db: MutationCtx["db"],
  gameId: Id<"games">,
  mapId: Id<"maps">,
): Promise<Doc<"maps">> {
  const map = await db.get(mapId);

  if (map === null || map.gameId !== gameId) {
    throw new Error("Map not found");
  }

  return map;
}

/**
 * Generate a one-shot upload URL for a map image. DM-only — only the DM creates
 * maps. The client PUTs the image blob to the returned URL, then calls `create`
 * with the storage id from the response.
 */
export const generateUploadUrl = mutation({
  args: {
    playerToken: v.string(),
    dmToken: v.string(),
  },
  handler: async (ctx, args) => {
    await requireDm(ctx.db, args.playerToken, args.dmToken);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Create a map from an uploaded image + a client-derived grid. `cols`/`rows`
 * are plain integers the client computed from the image's aspect ratio (the
 * server never derives them). `imageWidth`/`imageHeight` are the image's natural
 * pixel dimensions (measured client-side from the loaded `<img>`), stored so
 * re-gridding can offer the same aspect-faithful ladder. DM-only.
 */
export const create = mutation({
  args: {
    playerToken: v.string(),
    dmToken: v.string(),
    name: v.string(),
    imageStorageId: v.id("_storage"),
    cols: v.number(),
    rows: v.number(),
    imageWidth: v.optional(v.number()),
    imageHeight: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const game = await requireDm(ctx.db, args.playerToken, args.dmToken);
    return await ctx.db.insert("maps", {
      gameId: game._id,
      name: args.name,
      imageStorageId: args.imageStorageId,
      cols: args.cols,
      rows: args.rows,
      imageWidth: args.imageWidth,
      imageHeight: args.imageHeight,
    });
  },
});

/**
 * Delete a map. If it was the active map, clears `games.activeMapId` so the
 * board falls back to "no active map". Frees the map's stored image blob, and
 * relocates every piece placed on this map's board to the backstage holding pen
 * ({ kind: "backstage", x: 50, y: 50 }) so no piece is silently stranded
 * (supersedes ADR-0011's "map deletion does not touch pieces" note for the
 * delete case only — map *switching* still never touches pieces). DM-only.
 *
 * Ownership is proven before any mutation: a DM token authorizes management of
 * only its own Game, so a Map belonging to another Game is rejected with the
 * same generic "Map not found" error as a missing Map — the endpoint never
 * reveals whether another Game owns a supplied ID.
 */
export const remove = mutation({
  args: {
    playerToken: v.string(),
    dmToken: v.string(),
    mapId: v.id("maps"),
  },
  handler: async (ctx, args) => {
    const game = await requireDm(ctx.db, args.playerToken, args.dmToken);
    const map = await requireOwnedMap(ctx.db, game._id, args.mapId);

    if (game.activeMapId === args.mapId) {
      await ctx.db.patch(game._id, { activeMapId: undefined });
    }
    // Un-strand every piece on this map's board (piece counts are tens; filter
    // the byGame index in JS).
    const pieces = await ctx.db
      .query("pieces")
      .withIndex("byGame", (q) => q.eq("gameId", game._id))
      .collect();
    for (const piece of pieces) {
      if (
        piece.location.kind === "board" &&
        piece.location.mapId === args.mapId
      ) {
        await ctx.db.patch(piece._id, {
          location: { kind: "backstage", x: 50, y: 50 },
        });
      }
    }
    await deleteBlobIfPresent(ctx, map.imageStorageId);
    await ctx.db.delete(args.mapId);
  },
});

/**
 * Set which map is active for the Game. Does not touch any pieces (ADR-0011 /
 * spec: switching the active map preserves all piece state). DM-only; ownership
 * is proven before the Game is patched (issue #13).
 */
export const setActive = mutation({
  args: {
    playerToken: v.string(),
    dmToken: v.string(),
    mapId: v.id("maps"),
  },
  handler: async (ctx, args) => {
    const game = await requireDm(ctx.db, args.playerToken, args.dmToken);
    await requireOwnedMap(ctx.db, game._id, args.mapId);
    await ctx.db.patch(game._id, { activeMapId: args.mapId });
  },
});

/**
 * Update an existing map's grid dimensions (the "recalibrate" path — same
 * mutation, no special casing, per design Decision #2). DM-only; ownership is
 * proven before the Map is patched (issue #13).
 */
export const updateGrid = mutation({
  args: {
    playerToken: v.string(),
    dmToken: v.string(),
    mapId: v.id("maps"),
    cols: v.number(),
    rows: v.number(),
  },
  handler: async (ctx, args) => {
    const game = await requireDm(ctx.db, args.playerToken, args.dmToken);
    await requireOwnedMap(ctx.db, game._id, args.mapId);
    await ctx.db.patch(args.mapId, { cols: args.cols, rows: args.rows });
  },
});

/**
 * List every map in the Game with resolved image URLs. Open to either role —
 * players must see the board. Returns the `activeMapId` too so a single
 * subscription drives both the library UI and which map renders.
 */
export const list = query({
  args: {
    playerToken: v.string(),
    dmToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { game } = await resolveGame(ctx.db, args.playerToken, args.dmToken);
    const maps = await ctx.db
      .query("maps")
      .withIndex("byGame", (q) => q.eq("gameId", game._id))
      .collect();
    const views: MapView[] = await Promise.all(
      maps.map(async (m) => ({
        _id: m._id,
        _creationTime: m._creationTime,
        gameId: m.gameId,
        name: m.name,
        imageStorageId: m.imageStorageId,
        imageUrl: await ctx.storage.getUrl(m.imageStorageId),
        cols: m.cols,
        rows: m.rows,
        imageWidth: m.imageWidth ?? null,
        imageHeight: m.imageHeight ?? null,
      })),
    );
    return {
      activeMapId: (game.activeMapId ?? null) as string | null,
      maps: views,
    };
  },
});
