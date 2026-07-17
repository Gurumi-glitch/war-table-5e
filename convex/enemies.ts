import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireDm } from "./games";
import { pickNextColor } from "./colors";
import { saveAbilityToZh } from "./modifiers";
import { ENEMY_SEED } from "./enemySeed";
import type { DiceTerm } from "./rules";

/**
 * Enemy database (issue #6): templates for the gothic bestiary + SRD monsters
 * (seeded) and DM-entered custom/CoS entries (local only, never shipped).
 * Everything is DM-gated — enemy stat blocks are Backstage secrets, consistent
 * with the projectCombatants privacy split. Spawning deep-copies a template
 * into an independent combatant + recipes (ADR-0002: editing an instance never
 * touches the template, and vice versa).
 */

// Field set + type + splitTypes live in convex/enemyFields.ts (server-free so
// the frontend editor can share them); re-exported here for existing callers.
import {
  enemyFieldsValidator,
  splitTypes,
  parseRviText,
  parseConditionImmunities,
  type EnemyFields,
} from "./enemyFields";
import { canonicalDamageType } from "./rules";

export { enemyFieldsValidator, splitTypes };
export type { EnemyFields };

/** The seed codegen's row shape (convex/enemySeed.ts): always keyed, never custom. */
export type SeedEnemy = EnemyFields & {
  seedKey: string;
  source: "seed" | "srd";
};

/** What `list` returns — a full doc, as the UI consumes it. */
export type EnemyView = EnemyFields & { _id: string; _creationTime: number };

// ---------------------------------------------------------------------------
// Action → recipe helpers (pure, exported for tests)
// ---------------------------------------------------------------------------

/**
 * Parse a bestiary damage string like "2d4+2 穿刺" / "1d6 心靈" / "2d6+3
 * piercing" into recipe fields. Returns null when there is nothing rollable
 * (spawn then keeps the action as reference text only — never blocks).
 * The type is stored canonical (穿刺/Piercing → piercing) so R/V/I chips match
 * it; unrecognized types (compound riders, homebrew) keep the raw text.
 */
export function parseDamage(
  raw: string,
): { dice: DiceTerm[]; mod: number; type: string } | null {
  const m = (raw ?? "").trim().match(/^(\d+)[dD](\d+)\s*([+-]\d+)?\s*(.*)$/);
  if (m === null) return null;
  const die = `d${Number(m[2])}`;
  if (!["d20", "d12", "d10", "d8", "d6", "d4", "d100"].includes(die)) return null;
  const rawType = (m[4] ?? "").trim();
  return {
    dice: [{ type: die as DiceTerm["type"], count: Number(m[1]) }],
    mod: m[3] ? Number(m[3]) : 0,
    type: canonicalDamageType(rawType) ?? rawType,
  };
}

/**
 * Map one template action onto an insertable recipe, or null if it isn't
 * mechanically resolvable (multiattack/special/summon stay reference text).
 * Handles both preserved shapes:
 *  - bestiary: { name, kind: "*_attack"|"save", to_hit, damage: "2d4+2 穿刺",
 *    dc, save: "wis", on_hit/on_fail/on_success }
 *  - SRD: { name, desc, attack_bonus, damage: [{ damage_dice: "2d4+2",
 *    damage_type: { name } }], dc: { dc_type, dc_value } }
 */
export function recipeFromAction(action: unknown): {
  name: string;
  hitType: "attack" | "save";
  attackMod: number;
  damageDice: DiceTerm[];
  damageMod: number;
  damageType: string;
  dc: number;
  saveAbility: string;
  critImmune: boolean;
  resourceCost: number;
  multiTarget: "none";
} | null {
  const a = action as Record<string, any>;
  if (typeof a?.name !== "string") return null;

  // Bestiary attack / SRD attack (attack_bonus + damage list).
  const toHit = typeof a.to_hit === "number" ? a.to_hit : a.attack_bonus;
  const kind = typeof a.kind === "string" ? a.kind : "";
  const srdDamage = Array.isArray(a.damage) ? a.damage[0] : undefined;
  const damageStr =
    typeof a.damage === "string"
      ? a.damage
      : srdDamage
        ? `${srdDamage.damage_dice ?? ""} ${srdDamage.damage_type?.name ?? ""}`
        : "";
  const parsed = parseDamage(damageStr);

  if (typeof toHit === "number" && parsed !== null && !kind.includes("save")) {
    return {
      name: a.name,
      hitType: "attack",
      attackMod: toHit,
      damageDice: parsed.dice,
      damageMod: parsed.mod,
      damageType: parsed.type,
      dc: 0,
      saveAbility: "",
      critImmune: false,
      resourceCost: 0,
      multiTarget: "none",
    };
  }

  // Bestiary save action ({ kind: "save", save, dc, damage }) / SRD save
  // ({ dc: { dc_type, dc_value }, damage }).
  const dcValue =
    typeof a.dc === "number" ? a.dc : a.dc?.dc_value;
  const saveEn =
    typeof a.save === "string" ? a.save : a.dc?.dc_type?.index ?? "";
  if (
    (kind === "save" || typeof a.dc === "object") &&
    typeof dcValue === "number" &&
    parsed !== null
  ) {
    return {
      name: a.name,
      hitType: "save",
      attackMod: 0,
      damageDice: parsed.dice,
      damageMod: parsed.mod,
      damageType: parsed.type,
      dc: dcValue,
      saveAbility: saveAbilityToZh(saveEn),
      critImmune: true,
      resourceCost: 0,
      multiTarget: "none",
    };
  }

  return null;
}

/** Render the action blocks + tactics as the spawned combatant's dmNotes. */
function dmNotesFor(enemy: Record<string, any>): string {
  const lines: string[] = [];
  const block = (title: string, items: unknown[]) => {
    for (const it of items ?? []) {
      const a = it as Record<string, any>;
      const body = a.effect ?? a.desc ?? a.on_hit ?? "";
      lines.push(`【${title}】${a.name ?? ""}${body ? `：${body}` : ""}`);
    }
  };
  block("特性", enemy.traits);
  block("動作", enemy.actions);
  block("附贈動作", enemy.bonusActions);
  block("反應", enemy.reactions);
  block("傳奇動作", enemy.legendaryActions);
  if (enemy.tactics) lines.push(`【戰術】${enemy.tactics}`);
  if (enemy.encounterNotes) lines.push(`【遭遇】${enemy.encounterNotes}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Queries / mutations (all DM-gated)
// ---------------------------------------------------------------------------

/** List every enemy template. DM only — stat blocks are Backstage secrets. */
export const list = query({
  args: {
    playerToken: v.string(),
    dmToken: v.string(),
  },
  handler: async (ctx, args) => {
    await requireDm(ctx.db, args.playerToken, args.dmToken);
    return await ctx.db.query("enemies").collect();
  },
});

/** Create a custom enemy template (the homebrew/CoS editor). DM only. */
export const create = mutation({
  args: {
    playerToken: v.string(),
    dmToken: v.string(),
    fields: v.object(enemyFieldsValidator),
  },
  handler: async (ctx, args) => {
    await requireDm(ctx.db, args.playerToken, args.dmToken);
    return await ctx.db.insert("enemies", args.fields);
  },
});

/** Edit any template (seeded ones too — DM authority). DM only. */
export const update = mutation({
  args: {
    playerToken: v.string(),
    dmToken: v.string(),
    enemyId: v.id("enemies"),
    fields: v.object(enemyFieldsValidator),
  },
  handler: async (ctx, args) => {
    await requireDm(ctx.db, args.playerToken, args.dmToken);
    const { seedKey: _drop, ...fields } = args.fields;
    await ctx.db.patch(args.enemyId, fields);
  },
});

/** Delete a template. DM only. Spawned instances are unaffected (deep copies). */
export const remove = mutation({
  args: {
    playerToken: v.string(),
    dmToken: v.string(),
    enemyId: v.id("enemies"),
  },
  handler: async (ctx, args) => {
    await requireDm(ctx.db, args.playerToken, args.dmToken);
    await ctx.db.delete(args.enemyId);
  },
});

/**
 * Seed the enemy DB from the committed codegen (bestiary + SRD). Idempotent
 * by `seedKey` — existing rows are skipped, so re-running never resets edits.
 * Returns how many templates were inserted. DM only.
 */
export const seedAll = mutation({
  args: {
    playerToken: v.string(),
    dmToken: v.string(),
  },
  handler: async (ctx, args) => {
    await requireDm(ctx.db, args.playerToken, args.dmToken);
    let inserted = 0;
    for (const seed of ENEMY_SEED) {
      const existing = await ctx.db
        .query("enemies")
        .withIndex("bySeedKey", (q: any) => q.eq("seedKey", seed.seedKey))
        .unique();
      if (existing !== null) continue;
      await ctx.db.insert("enemies", seed as any);
      inserted++;
    }
    return inserted;
  },
});

/**
 * Backfill Traditional Chinese names onto already-seeded templates whose
 * nameZh is still blank (the SRD seed shipped English-only before the zh
 * overlay). Reads the regenerated ENEMY_SEED as the source of truth and, for
 * each existing row matched by seedKey, fills nameZh only when it's empty — so
 * any name the DM already edited by hand is left untouched (ADR-0002). Safe to
 * re-run; returns how many rows were filled. DM only.
 */
export const backfillZhNames = mutation({
  args: {
    playerToken: v.string(),
    dmToken: v.string(),
  },
  handler: async (ctx, args) => {
    await requireDm(ctx.db, args.playerToken, args.dmToken);
    let filled = 0;
    for (const seed of ENEMY_SEED) {
      if (!seed.nameZh) continue;
      const existing = await ctx.db
        .query("enemies")
        .withIndex("bySeedKey", (q: any) => q.eq("seedKey", seed.seedKey))
        .unique();
      if (existing === null || existing.nameZh.trim() !== "") continue;
      await ctx.db.patch(existing._id, { nameZh: seed.nameZh });
      filled++;
    }
    return filled;
  },
});

/**
 * Spawn a template into the current Game: deep-copy the stats into a new
 * independent combatant (kind enemy, full HP, auto color/order) and turn each
 * mechanically-resolvable action into a combatant-owned recipe. No
 * back-reference — editing the instance never changes the template (ADR-0002).
 * Rider text (on_hit/on_fail/…) plus traits/tactics land in dmNotes. DM only.
 */
export const spawn = mutation({
  args: {
    playerToken: v.string(),
    dmToken: v.string(),
    enemyId: v.id("enemies"),
    // Locale-resolved display name from the spawning client (i18n); absent →
    // zh-first fallback below.
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const game = await requireDm(ctx.db, args.playerToken, args.dmToken);
    const enemy = await ctx.db.get(args.enemyId);
    if (enemy === null) throw new Error("Enemy template not found");

    const existing = await ctx.db
      .query("combatants")
      .withIndex("byGame", (q: any) => q.eq("gameId", game._id))
      .collect();
    const color = pickNextColor(existing.map((c: any) => c.color));
    const order =
      existing.reduce((max: number, c: any) => Math.max(max, c.order), -1) + 1;

    // Per-instance stat-block snapshot: the full template fields (minus the
    // system fields and seedKey) so the whole 敵人庫 attribute set stays
    // editable on the spawned instance. Still no back-reference (ADR-0002).
    const {
      _id: _sbId,
      _creationTime: _sbTime,
      seedKey: _sbSeed,
      ...statBlock
    } = enemy as Record<string, any>;

    const combatantId = await ctx.db.insert("combatants", {
      gameId: game._id,
      name: args.name || enemy.nameZh || enemy.nameEn,
      kind: "enemy" as const,
      color,
      hp: enemy.hpMax,
      maxHp: enemy.hpMax,
      ac: enemy.ac,
      initiative: 0,
      notes: "",
      dmNotes: dmNotesFor(enemy),
      alive: true,
      actionUsed: false,
      bonusUsed: false,
      reactionUsed: false,
      resist: parseRviText(enemy.damageResistances),
      vuln: parseRviText(enemy.damageVulnerabilities),
      immune: parseRviText(enemy.damageImmunities),
      conditionImmune: parseConditionImmunities(enemy.conditionImmunities),
      statBlock: statBlock as any,
      order,
    });

    for (const action of [...enemy.actions, ...enemy.bonusActions, ...enemy.reactions]) {
      const recipe = recipeFromAction(action);
      if (recipe === null) continue;
      await ctx.db.insert("recipes", {
        gameId: game._id,
        combatantId,
        ...recipe,
      });
    }

    return combatantId;
  },
});
