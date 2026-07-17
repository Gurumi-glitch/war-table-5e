import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requireDm, resolveGame } from "./games";

/**
 * Delete a stored blob, tolerating an already-missing one. Blobs are one-per-
 * record and never shared, so inline deletion on the owning mutation is safe;
 * a missing blob must never block the DB write (design D1 / Risks).
 */
export async function deleteBlobIfPresent(
  ctx: MutationCtx,
  storageId: Id<"_storage">,
): Promise<void> {
  try {
    await ctx.storage.delete(storageId);
  } catch {
    // Blob already gone — the DB write must still proceed.
  }
}

/**
 * Chess pieces (add-map-system / ADR-0011): visual tokens on the map board,
 * decoupled from `combatants`. Creation snapshots the source's NAME once
 * (ADR-0005 deep-copy pattern — no live link; editing the Character/Enemy later
 * never changes an existing piece). Character/enemy cards carry no color or
 * portrait of their own, so those are client-supplied at creation.
 *
 * Permission split (design Decision #4): creating an ENEMY-linked piece is
 * DM-only (it reads the DM-gated `enemies` table, ADR-0005). Everything else —
 * character/ad-hoc creation, move, remove, portrait/label edits — is open to
 * either role, matching the "like TTS, everyone moves/creates/deletes" decision.
 *
 * A piece's `location` is display data ONLY. No combat-resolution code reads it
 * (ADR-0011, the load-bearing non-spatial boundary).
 */

/** A piece as projected to a client, with its portrait resolved to a signed URL. */
export type PieceView = {
  _id: string;
  _creationTime: number;
  gameId: string;
  label: string;
  color: string;
  portraitStorageId: string | null;
  portraitUrl: string | null;
  sourceType: "character" | "enemy" | "none";
  location:
    | { kind: "board"; mapId: string; row: number; col: number }
    | { kind: "backstage"; x: number; y: number };
};

/** The `location` union validator, reused by create/move. */
const locationValidator = v.union(
  v.object({
    kind: v.literal("board"),
    mapId: v.id("maps"),
    row: v.number(),
    col: v.number(),
  }),
  v.object({
    kind: v.literal("backstage"),
    x: v.number(),
    y: v.number(),
  }),
);

/**
 * Generate a one-shot upload URL for a piece portrait. Open (any caller can set
 * a custom portrait on a piece they can edit). The client PUTs the image, then
 * calls `updatePortrait` with the resulting storage id.
 */
export const generateUploadUrl = mutation({
  args: { playerToken: v.string() },
  handler: async (ctx, args) => {
    await resolveGame(ctx.db, args.playerToken);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Create a piece. `sourceType: "character"` / `"enemy"` snapshot the source's
 * name (enemy is DM-only); `"none"` is ad-hoc (freeform label). Color and any
 * portrait are client-supplied (source cards carry neither). New pieces default
 * to the global backstage unless an explicit board `location` is given.
 */
export const create = mutation({
  args: {
    playerToken: v.string(),
    dmToken: v.optional(v.string()),
    sourceType: v.union(
      v.literal("character"),
      v.literal("enemy"),
      v.literal("none"),
    ),
    characterId: v.optional(v.id("characters")),
    enemyId: v.optional(v.id("enemies")),
    label: v.optional(v.string()),
    color: v.string(),
    portraitStorageId: v.optional(v.id("_storage")),
    location: v.optional(locationValidator),
  },
  handler: async (ctx, args) => {
    // Enemy-linked creation reads the DM-gated enemies table → DM-only.
    // Character/ad-hoc creation is open to either role.
    const { game } =
      args.sourceType === "enemy"
        ? {
            game: await requireDm(
              ctx.db,
              args.playerToken,
              args.dmToken ?? "",
            ),
          }
        : await resolveGame(ctx.db, args.playerToken, args.dmToken);

    let label = args.label ?? "";
    if (args.sourceType === "character") {
      if (args.characterId === undefined) {
        throw new Error("characterId required for a character-linked piece");
      }
      const character = await ctx.db.get(args.characterId);
      if (character === null) throw new Error("Character not found");
      label = character.nameZh || character.nameEn;
    } else if (args.sourceType === "enemy") {
      if (args.enemyId === undefined) {
        throw new Error("enemyId required for an enemy-linked piece");
      }
      const enemy = await ctx.db.get(args.enemyId);
      if (enemy === null) throw new Error("Enemy template not found");
      label = enemy.nameZh || enemy.nameEn;
    }

    return await ctx.db.insert("pieces", {
      gameId: game._id,
      label,
      color: args.color,
      portraitStorageId: args.portraitStorageId,
      sourceType: args.sourceType,
      // Default: drop new pieces into the global backstage (centered) unless the
      // caller placed them directly on the board.
      location: args.location ?? { kind: "backstage", x: 50, y: 50 },
    });
  },
});

/**
 * Move a piece to a new location (board row/col, or backstage x/y). Open — any
 * caller may move any piece (TTS-like). Fires once on drop, not per pointer-move
 * (see design Risks). No validation against map bounds beyond the union shape:
 * the DM/players are the authority (manual-override ethos, ADR-0002).
 */
export const move = mutation({
  args: {
    playerToken: v.string(),
    pieceId: v.id("pieces"),
    location: locationValidator,
  },
  handler: async (ctx, args) => {
    await resolveGame(ctx.db, args.playerToken);
    await ctx.db.patch(args.pieceId, { location: args.location });
  },
});

/**
 * Delete a piece. Open — any caller may delete any piece (per interview). Frees
 * the piece's portrait blob from file storage when set — a missing blob is
 * tolerated and never blocks the DB delete.
 */
export const remove = mutation({
  args: {
    playerToken: v.string(),
    pieceId: v.id("pieces"),
  },
  handler: async (ctx, args) => {
    await resolveGame(ctx.db, args.playerToken);
    const piece = await ctx.db.get(args.pieceId);
    if (piece?.portraitStorageId !== undefined) {
      await deleteBlobIfPresent(ctx, piece.portraitStorageId);
    }
    await ctx.db.delete(args.pieceId);
  },
});

/**
 * Set (or clear, when `portraitStorageId` is omitted) a piece's custom portrait,
 * overriding whatever was copied from a linked source. Open. Frees the superseded
 * portrait blob when the portrait is replaced or cleared (skipped when the id is
 * unchanged); a missing blob is tolerated and never blocks the DB patch.
 */
export const updatePortrait = mutation({
  args: {
    playerToken: v.string(),
    pieceId: v.id("pieces"),
    portraitStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    await resolveGame(ctx.db, args.playerToken);
    const piece = await ctx.db.get(args.pieceId);
    const previous = piece?.portraitStorageId;
    if (previous !== undefined && previous !== args.portraitStorageId) {
      await deleteBlobIfPresent(ctx, previous);
    }
    await ctx.db.patch(args.pieceId, {
      portraitStorageId: args.portraitStorageId,
    });
  },
});

/** Rename / recolor a piece (custom override). Open. */
export const updateLabel = mutation({
  args: {
    playerToken: v.string(),
    pieceId: v.id("pieces"),
    label: v.optional(v.string()),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await resolveGame(ctx.db, args.playerToken);
    const patch: { label?: string; color?: string } = {};
    if (args.label !== undefined) patch.label = args.label;
    if (args.color !== undefined) patch.color = args.color;
    await ctx.db.patch(args.pieceId, patch);
  },
});

/**
 * List every piece in the Game with resolved portrait URLs. Open to either role.
 * The frontend splits board-vs-backstage by `location.kind` client-side.
 */
export const list = query({
  args: {
    playerToken: v.string(),
    dmToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { game } = await resolveGame(ctx.db, args.playerToken, args.dmToken);
    const pieces = await ctx.db
      .query("pieces")
      .withIndex("byGame", (q) => q.eq("gameId", game._id))
      .collect();
    const views: PieceView[] = await Promise.all(
      pieces.map(async (p) => ({
        _id: p._id,
        _creationTime: p._creationTime,
        gameId: p.gameId,
        label: p.label,
        color: p.color,
        portraitStorageId: p.portraitStorageId ?? null,
        portraitUrl:
          p.portraitStorageId !== undefined
            ? await ctx.storage.getUrl(p.portraitStorageId)
            : null,
        sourceType: p.sourceType,
        location: p.location,
      })),
    );
    return views;
  },
});
