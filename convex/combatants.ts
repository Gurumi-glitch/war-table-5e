import { mutationGeneric as mutation } from "convex/server";
import { v } from "convex/values";
import { resolveGame } from "./games";
import { battleDraftHelpers } from "./battleDraftHelpers";
import { pickNextColor } from "./colors";
import { byInitiative, rollD20WithAdvantage } from "./diceHelpers";
import { advantageFor, effectiveNumber, expandSpecs } from "./modifiers";
import { fetchChildren } from "./ownership";
import { enemyFieldsValidator } from "./enemyFields";

/** Validator for the combatant kind union. */
const kindValidator = v.union(v.literal("pc"), v.literal("npc"), v.literal("enemy"));

/**
 * Fields the DM may patch on a combatant. Every field is optional; manual
 * override always wins (ADR-0002). `maxHp` is included so the DM can correct
 * the ceiling; `hp` is clamped to [0, maxHp] only when maxHp is also being
 * set in the same patch — otherwise the DM's literal hp is honored.
 */
const patchValidator = v.object({
  name: v.optional(v.string()),
  kind: v.optional(kindValidator),
  color: v.optional(v.string()),
  hp: v.optional(v.number()),
  maxHp: v.optional(v.number()),
  // 臨時生命值 (PHB p.198): NOT clamped to maxHp — temp HP can exceed it.
  // Granted by the DM (combat-row input) or by temp-HP-granting effects.
  tempHp: v.optional(v.number()),
  ac: v.optional(v.number()),
  initiative: v.optional(v.number()),
  notes: v.optional(v.string()),
  dmNotes: v.optional(v.string()),
  alive: v.optional(v.boolean()),
  actionUsed: v.optional(v.boolean()),
  bonusUsed: v.optional(v.boolean()),
  reactionUsed: v.optional(v.boolean()),
  resist: v.optional(v.array(v.string())),
  vuln: v.optional(v.array(v.string())),
  immune: v.optional(v.array(v.string())),
  conditionImmune: v.optional(v.array(v.string())),
  // Full 敵人庫 stat-block snapshot (on-field enemy editor, ADR-0002 copy).
  statBlock: v.optional(v.object(enemyFieldsValidator)),
});

/**
 * Resolve the game + combatant by player token. All combatant operations are
 * open to either role (open-buttons ethos); the only DM-only distinction is
 * reading DM-only fields. Throws if the combatant does not belong to the game.
 */
export async function resolveCombatant(
  db: any,
  playerToken: string,
  combatantId: string,
): Promise<any> {
  const { game } = await resolveGame(db, playerToken);
  const combatant = await db.get(combatantId);
  if (combatant === null || combatant.gameId !== game._id) {
    throw new Error("Combatant not found");
  }
  return combatant;
}

/** Add a combatant to the encounter. Either role. Auto-assigns color + order. */
export const add = mutation({
  args: {
    playerToken: v.string(),
    name: v.string(),
    kind: kindValidator,
    maxHp: v.number(),
    ac: v.number(),
    initiative: v.number(),
    notes: v.optional(v.string()),
    dmNotes: v.optional(v.string()),
    color: v.optional(v.string()),
    resist: v.optional(v.array(v.string())),
    vuln: v.optional(v.array(v.string())),
    immune: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const game = await resolveGame(ctx.db, args.playerToken).then((r) => r.game);
    const existing = await ctx.db
      .query("combatants")
      .withIndex("byGame", (q: any) => q.eq("gameId", game._id))
      .collect();
    const color = args.color ?? pickNextColor(existing.map((c: any) => c.color));
    const order =
      existing.reduce((max: number, c: any) => Math.max(max, c.order), -1) + 1;
    const id = await ctx.db.insert("combatants", {
      gameId: game._id,
      name: args.name,
      kind: args.kind,
      color,
      hp: args.maxHp,
      maxHp: args.maxHp,
      ac: args.ac,
      initiative: args.initiative,
      notes: args.notes ?? "",
      dmNotes: args.dmNotes ?? "",
      alive: true,
      actionUsed: false,
      bonusUsed: false,
      reactionUsed: false,
      resist: args.resist ?? [],
      vuln: args.vuln ?? [],
      immune: args.immune ?? [],
      order,
    });
    return id;
  },
});

/** Remove a combatant from the encounter. Either role. */
export const remove = mutation({
  args: {
    playerToken: v.string(),
    combatantId: v.id("combatants"),
  },
  handler: async (ctx, args) => {
    const combatant = await resolveCombatant(
      ctx.db,
      args.playerToken,
      args.combatantId,
    );
    await battleDraftHelpers.removeCombatantDraftReferences(ctx.db, combatant.gameId, combatant._id);
    await ctx.db.delete(combatant._id);
    // If this was the active turn, clear the pointer.
    const game = await ctx.db.get(combatant.gameId);
    if (game?.currentTurnId === combatant._id) {
      await ctx.db.patch(game._id, { currentTurnId: undefined });
    }
    // Strip the combatant from an active Batch battle run (issue #8). Turns
    // already taken stay taken: the pointer shifts down with the queue so it
    // keeps pointing at the same next combatant. An emptied queue ends the run.
    const run = game?.batchRun;
    if (run !== undefined && run.turnIds.includes(combatant._id)) {
      const turnIds = run.turnIds.filter((id: string) => id !== combatant._id);
      const removedIdx = run.turnIds.indexOf(combatant._id);
      const turnIndex = removedIdx < run.turnIndex ? run.turnIndex - 1 : run.turnIndex;
      if (turnIds.length === 0 || turnIndex >= turnIds.length) {
        await ctx.db.patch(game._id, { batchRun: undefined });
      } else {
        await ctx.db.patch(game._id, {
          batchRun: { ...run, turnIds, turnIndex },
          currentTurnId: turnIds[turnIndex],
        });
      }
    }
    // Clean up the combatant's Conditions/Modifiers (issue #5). The byCombatant
    // queries below only match combatant-owned rows — a linked PC's
    // character-owned recipes/resources/effects survive removal by design
    // (campaign state; issue #9).
    const effects = await ctx.db
      .query("effects")
      .withIndex("byCombatant", (q: any) => q.eq("combatantId", combatant._id))
      .collect();
    await Promise.all(effects.map((e: any) => ctx.db.delete(e._id)));
    // Clean up the combatant's Action recipes + Resources (issue #7).
    const recipes = await ctx.db
      .query("recipes")
      .withIndex("byCombatant", (q: any) => q.eq("combatantId", combatant._id))
      .collect();
    await Promise.all(recipes.map((r: any) => ctx.db.delete(r._id)));
    const resources = await ctx.db
      .query("resources")
      .withIndex("byCombatant", (q: any) => q.eq("combatantId", combatant._id))
      .collect();
    await Promise.all(resources.map((r: any) => ctx.db.delete(r._id)));
    // Release any dice this combatant had claimed — a deleted combatant must
    // not keep a dangling claimedBy on the board (issue #18).
    const dice = await ctx.db
      .query("dice")
      .withIndex("byGame", (q: any) => q.eq("gameId", combatant.gameId))
      .collect();
    await Promise.all(
      dice
        .filter((d: any) => d.claimedBy === combatant._id)
        .map((d: any) => ctx.db.patch(d._id, { claimedBy: undefined })),
    );
  },
});

/** Edit any stat on a combatant. Either role. Manual override always wins. */
export const update = mutation({
  args: {
    playerToken: v.string(),
    combatantId: v.id("combatants"),
    patch: patchValidator,
  },
  handler: async (ctx, args) => {
    const combatant = await resolveCombatant(
      ctx.db,
      args.playerToken,
      args.combatantId,
    );
    const patch: Record<string, unknown> = { ...args.patch };
    // Live link (issue #9): a linked PC's hp/maxHp/ac/tempHp live ON the
    // character — combat-row edits to those fields write through to the card
    // instantly. Every other field (initiative, notes, color, economy …) stays
    // per-Game on the combatant row. tempHp is NOT clamped (PHB p.198: can
    // exceed maxHp).
    if (combatant.characterId !== undefined) {
      const character = await ctx.db.get(combatant.characterId);
      if (character !== null) {
        const cardPatch: Record<string, unknown> = {};
        for (const field of ["hp", "maxHp", "ac", "tempHp"] as const) {
          if (patch[field] !== undefined) {
            cardPatch[field] = patch[field];
            delete patch[field];
          }
        }
        if (cardPatch.hp !== undefined) {
          const maxHp = (cardPatch.maxHp as number) ?? character.maxHp;
          cardPatch.hp = Math.max(
            0,
            Math.min(cardPatch.hp as number, maxHp),
          );
        }
        if (Object.keys(cardPatch).length > 0) {
          await ctx.db.patch(character._id, cardPatch);
        }
      }
    }
    // Clamp hp to [0, maxHp] using the effective maxHp if both are present,
    // otherwise honor the DM's literal value (override wins).
    if (patch.hp !== undefined) {
      const maxHp = (patch.maxHp as number) ?? combatant.maxHp;
      patch.hp = Math.max(0, Math.min(patch.hp as number, maxHp));
    }
    await ctx.db.patch(combatant._id, patch);
  },
});

/** Override a combatant's auto-assigned color. Either role. */
export const setColor = mutation({
  args: {
    playerToken: v.string(),
    combatantId: v.id("combatants"),
    color: v.string(),
  },
  handler: async (ctx, args) => {
    const combatant = await resolveCombatant(
      ctx.db,
      args.playerToken,
      args.combatantId,
    );
    await ctx.db.patch(combatant._id, { color: args.color });
  },
});

/** One-click kill / revive. Either role. The combatant stays listed, flagged. */
export const setAlive = mutation({
  args: {
    playerToken: v.string(),
    combatantId: v.id("combatants"),
    alive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const combatant = await resolveCombatant(
      ctx.db,
      args.playerToken,
      args.combatantId,
    );
    await ctx.db.patch(combatant._id, { alive: args.alive });
  },
});

/**
 * Advance the turn to the next combatant in initiative order (highest first,
 * ties by insertion order). The first advance starts the round at the top.
 * Wrapping past the end increments the round. Lite initiative: driver-driven,
 * not a rigid engine. Either role.
 */
export const advanceTurn = mutation({
  args: {
    playerToken: v.string(),
  },
  handler: async (ctx, args) => {
    const game = await resolveGame(ctx.db, args.playerToken).then((r) => r.game);
    const combatants = await ctx.db
      .query("combatants")
      .withIndex("byGame", (q: any) => q.eq("gameId", game._id))
      .collect();
    if (combatants.length === 0) {
      return; // nothing to advance
    }
    const sorted = [...combatants].sort(byInitiative);

    let nextId: string;
    let round = game.round;
    if (game.currentTurnId === undefined) {
      // Start of combat: top of the order, round 1.
      nextId = sorted[0]._id;
      round = 1;
    } else {
      const idx = sorted.findIndex((c: any) => c._id === game.currentTurnId);
      if (idx === -1) {
        // Active turn's combatant vanished; restart at top.
        nextId = sorted[0]._id;
        round = Math.max(round, 1);
      } else if (idx + 1 < sorted.length) {
        nextId = sorted[idx + 1]._id;
      } else {
        // Wrap around.
        nextId = sorted[0]._id;
        round = round + 1;
      }
    }
    await ctx.db.patch(game._id, { currentTurnId: nextId, round });
  },
});

/** Force whose turn it is. Either role. Lite-initiative override. */
export const setTurn = mutation({
  args: {
    playerToken: v.string(),
    combatantId: v.id("combatants"),
  },
  handler: async (ctx, args) => {
    const combatant = await resolveCombatant(
      ctx.db,
      args.playerToken,
      args.combatantId,
    );
    await ctx.db.patch(combatant.gameId, { currentTurnId: combatant._id });
  },
});

/**
 * Reset action-economy reminders (action/bonus/reaction) for all combatants.
 * These nudge but never enforce. Typically called at the start of a round.
 * Either role.
 */
export const resetActionEconomy = mutation({
  args: {
    playerToken: v.string(),
  },
  handler: async (ctx, args) => {
    const game = await resolveGame(ctx.db, args.playerToken).then((r) => r.game);
    const combatants = await ctx.db
      .query("combatants")
      .withIndex("byGame", (q: any) => q.eq("gameId", game._id))
      .collect();
    await Promise.all(
      combatants.map((c: any) =>
        ctx.db.patch(c._id, {
          actionUsed: false,
          bonusUsed: false,
          reactionUsed: false,
        }),
      ),
    );
  },
});

/**
 * Roll initiative for every combatant at once: d20 (2 on advantage/disadvantage,
 * taking the higher/lower) + each combatant's effective initiative modifier,
 * then store the final result on `initiative` (which the turn order sorts by).
 * For a linked PC (issue #9) the base modifier is the character card's 先攻
 * bonus; on top of that come active `initiative` bonuses AND advantage/
 * disadvantage from the Conditions/Modifiers model (issue #5) — e.g. a custom
 * "Initiative: Advantage" modifier. Unlinked combatants keep the custom "+N
 * Initiative" modifier workaround. Either role. Lite initiative: driver-driven,
 * overrideable — the DM can still hand-edit any result after.
 */
export const rollInitiative = mutation({
  args: {
    playerToken: v.string(),
  },
  handler: async (ctx, args) => {
    const game = await resolveGame(ctx.db, args.playerToken).then((r) => r.game);
    const combatants = await ctx.db
      .query("combatants")
      .withIndex("byGame", (q: any) => q.eq("gameId", game._id))
      .collect();

    await Promise.all(
      combatants.map(async (c: any) => {
        // Combatant-owned + (for linked PCs) character-owned effects.
        const cEffects = await fetchChildren(ctx.db, "effects", c);
        const specs = expandSpecs(cEffects as any);
        // Linked PCs start from the card's 先攻 bonus; others from 0.
        let base = 0;
        if (c.characterId !== undefined) {
          const character = await ctx.db.get(c.characterId);
          if (character !== null) base = character.initBonus;
        }
        // Effective initiative modifier = base + active initiative bonuses
        // (or override). Computed on the fly from active effects, never stored.
        const mod = effectiveNumber(base, specs, "initiative").value;
        const adv = advantageFor(specs, "initiative");
        const initiative = rollD20WithAdvantage(adv) + mod;
        await ctx.db.patch(c._id, { initiative });
      }),
    );
  },
});
