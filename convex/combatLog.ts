import {
  queryGeneric as query,
  mutationGeneric as mutation,
} from "convex/server";
import { v } from "convex/values";
import { resolveGame } from "./games";
import { advanceRunPointer } from "./batch";
import { battleDraftHelpers } from "./battleDraftHelpers";
import { childBelongsTo, childOwner, fetchChildren, statCarrier } from "./ownership";
import { makeDiceCursor, consumeExtraRolls, summarizeRoll, type DieType } from "./diceHelpers";
import {
  advantageFor,
  advantageSignalsFor,
  autoFailFor,
  combineAdvSignals,
  effectiveNumber,
  expandSpecs,
  hasResistAll,
  saveAbilityToZh,
  type Advantage,
  type AdvSignals,
  type ModifierSpec,
} from "./modifiers";
import {
  resolveAttack,
  resolveSave,
  resolveAutomatic,
  computeHeal,
  computeDamage,
  applyHpWithTemp,
  grantTempHp,
  type ForceOutcome,
  type ExtraRoll,
} from "./rules";

/**
 * The append-only combat log + the Confirm that commits a pending resolution.
 *
 * Two modes:
 * - **Manual** (issue #4): the actor enters target HP deltas by hand; Confirm
 *   applies them (clamped), summarizes + releases the acting combatant's claimed
 *   dice, and appends a log entry.
 * - **Recipe** (issue #7): a recipe + a single target resolve through the 5e
 *   rules engine (attack vs AC / save vs DC / automatic + R/V/I + crits + healing),
 *   reading claimed dice server-side. The DM can force any result (ADR-0002).
 *
 * Either role may Confirm (open-buttons ethos). Nothing commits until Confirm.
 */

/** One applied HP delta, snapshotted so the log stays readable if removed. */
export type LogEffect = {
  combatantId: string;
  name: string;
  hpDelta: number;
};

/**
 * Structured log event (i18n change) — the resolution as data, rendered
 * client-side in the viewer's language. Mirrors the `event` validator in
 * schema.ts. Player-entered text (names, recipe names, extra-roll labels) is
 * verbatim; damageType/saveAbility are canonical English keys.
 */
export type LogEventTarget = {
  name: string;
  reactionName?: string;
  adv?: "advantage" | "disadvantage";
  autoFail?: boolean;
  forced?: boolean;
  hit?: boolean;
  crit?: boolean;
  saveSuccess?: boolean;
  saveMode?: "hitOrMiss" | "damage";
  damage?: number;
  damageType?: string;
  heal?: number;
  darts?: number;
  extras?: { label: string; amount: number; isHeal: boolean }[];
};

export type LogEvent = {
  kind: "attack" | "save" | "auto" | "heal" | "darts" | "manual";
  recipeName?: string;
  dc?: number;
  saveAbility?: string;
  roleplayNote?: string;
  claimedDice?: { type: string; value: number }[];
  targets: LogEventTarget[];
  grants?: { to: string; mods: { mode: string; stat: string; value: number }[] }[];
  heals?: { amount: number; tempHp: boolean; to: string[] }[];
  spent?: { label: string; amount: number }[];
};

/** A combat-log entry (PRD US48). Append-only; never edited or deleted. */
export type CombatLogEntry = {
  _id: string;
  _creationTime: number;
  gameId: string;
  round: number;
  actingCombatantId: string | null;
  actingName: string;
  rollSummary: string;
  effectText: string;
  effects: LogEffect[];
  /** Structured event (absent on legacy rows — those render via rollSummary). */
  event?: LogEvent;
};

const effectValidator = v.object({
  combatantId: v.id("combatants"),
  hpDelta: v.number(),
});

const forceOutcomeValidator = v.union(
  v.literal("hit"),
  v.literal("miss"),
  v.literal("save"),
  v.literal("fail"),
);

// Manual adv/disadv toggle: the frontend's per-target choice. When present it
// REPLACES the condition-computed net advantage for ONE component of the roll
// (see advOverrideStat below) — the conditions only pre-set the toggle in the
// UI, the DM/player has the last word (ADR-0002). Absent = compute from conditions.
const advOverrideValidator = v.union(
  v.literal("advantage"),
  v.literal("disadvantage"),
  v.literal("none"),
);

// What a SUCCESSFUL save means for this target (Case 1 Extend — the DM's call
// per use, since the app doesn't know each spell's rules text):
// - "damage" (default when absent): the save is a damage DECREASE — success
//   halves the damage (save-for-half, e.g. Fireball). The engine's historical
//   behavior.
// - "hitOrMiss": the save decides whether the Actor hits at all — success
//   negates the damage entirely (e.g. 雷鳴爆). The log reads HIT/MISS instead
//   of SAVE/FAIL.
// The target's advOverride (adv/disadv toggle) applies to the save roll in
// BOTH modes.
const saveModeValidator = v.union(v.literal("hitOrMiss"), v.literal("damage"));

const targetValidator = v.object({
  combatantId: v.id("combatants"),
  saveBonus: v.optional(v.number()),
  forceOutcome: v.optional(forceOutcomeValidator),
  forceDamage: v.optional(v.number()),
  advOverride: v.optional(advOverrideValidator),
  saveMode: v.optional(saveModeValidator),
  // Stage B (darts): number of darts assigned to this target.
  darts: v.optional(v.number()),
  // Reaction: one of the TARGET's own recipes (e.g. Shield), spent before this
  // resolution commits — its appliesMods feed this resolution's math.
  reactionRecipeId: v.optional(v.id("recipes")),
});

/**
 * Fold the actor's own `attack` bonus/override AND the target's `attackAgainst`
 * bonus/override into the recipe's attackMod (e.g. a custom "+2 Attack (to
 * hit)" modifier, or a "vulnerable — attacks against you +2" debuff). These
 * modes were previously read only for advantage/disadvantage; bonus/override
 * silently did nothing. Composed the same way AC/save bonuses already do:
 * sequential `effectiveNumber` folds (sum bonuses; an override replaces
 * whatever came before it — most-restrictive wins, matching `effectiveNumber`'s
 * existing semantics).
 */
function netAttackMod(
  base: number,
  actorSpecs: readonly ModifierSpec[],
  targetSpecs: readonly ModifierSpec[],
): number {
  const ownAttack = effectiveNumber(base, actorSpecs, "attack");
  return effectiveNumber(ownAttack.value, targetSpecs, "attackAgainst").value;
}

/** An explicit side override replaces that side's automatic raw signals. */
function overrideSignals(override: Advantage): AdvSignals {
  return {
    hasAdv: override === "advantage",
    hasDis: override === "disadvantage",
  };
}

/** Up to `max` claimed dice of `type` belonging to a combatant (advantage rolls 2). */
function claimedDice(
  dice: ReadonlyArray<any>,
  combatantId: string,
  type: DieType,
  max: number,
): any[] {
  return dice
    .filter((d) => d.claimedBy === combatantId && d.type === type)
    .slice(0, max);
}


/**
 * Commit a pending resolution. Manual mode (no `recipeId`) applies `effects`
 * HP deltas directly. Recipe mode resolves via the 5e rules engine against a
 * list of `targets` (Stage B: AoE = same dice per target w/ each target's own
 * save + R/V/I; darts = actor's d4s split per target; single-target = one
 * element). Either role may Confirm.
 */
export const confirm = mutation({
  args: {
    playerToken: v.string(),
    actingCombatantId: v.optional(v.id("combatants")),
    effectText: v.string(),
    // Manual mode:
    effects: v.optional(v.array(effectValidator)),
    // Recipe mode (issue #7 Stage B: multi-target):
    recipeId: v.optional(v.id("recipes")),
    attackMod: v.optional(v.number()),
    damageMod: v.optional(v.number()),
    // Manual damage-type override (issue: manual adv/disadv + extra rolls
    // request) — replaces the recipe's damageType for THIS resolution, incl.
    // R/V/I lookup and the healing/damage branch check. Absent = recipe default.
    damageType: v.optional(v.string()),
    dc: v.optional(v.number()),
    // The ACTOR's own manual adv/disadv override (e.g. Reckless Attack) — session-
    // wide, not per-target, since the actor's own condition-driven advantage
    // doesn't vary by which target they're swinging at. Combines with each
    // target's attackAgainst contribution instead of replacing it (Case 1: a
    // target-only override used to silently wipe out the actor's own advantage).
    actorAdvOverride: v.optional(advOverrideValidator),
    targets: v.optional(v.array(targetValidator)),
    // Per-row recipients for the recipe's targets-directed appliesMods
    // (directed-mods request): modIndex = index into recipe.appliesMods,
    // combatantIds = the targets checked for that row at Confirm. Self-directed
    // rows need no entry. ABSENT = legacy behavior (every row → targets[0]);
    // when present, a targets-directed row without an entry reaches nobody.
    modTargets: v.optional(
      v.array(
        v.object({
          modIndex: v.number(),
          combatantIds: v.array(v.id("combatants")),
        }),
      ),
    ),
    // BG3-style armed pools (issue #9): the resources the ACTOR toggled before
    // confirming — each is spent (amount, default 1) when the action commits.
    // When PRESENT (even empty) this list is authoritative and the recipe's
    // own resourceId/resourceCost auto-consumption is skipped: the frontend
    // pre-arms the linked pool, so untoggling really spends nothing, and
    // arming L2 instead of L1 is the upcast story (no duplicated recipes).
    // Absent = legacy auto-consume (older frontends).
    spendResources: v.optional(
      v.array(
        v.object({
          resourceId: v.id("resources"),
          amount: v.optional(v.number()),
        }),
      ),
    ),
    // Deprecated single-target alias (Stage A → B transition). The frontend now
    // sends `targets`; accepting `target` too avoids a recipe-confirm outage
    // during the deploy skew. Promoted to `targets: [target]` below.
    target: v.optional(targetValidator),
  },
  handler: async (ctx, args) => {
    const { game } = await resolveGame(ctx.db, args.playerToken);

    let actingName = "DM";
    let rollSummary = "";
    // Structured twin of rollSummary (dual-write; see schema.ts `event`).
    let event: LogEvent | undefined;
    const applied: LogEffect[] = [];
    // Dice to release once the resolution commits (acting's claims + any save d20).
    const diceToRelease: any[] = [];

    if (args.recipeId !== undefined) {
      // ---- Recipe mode (issue #7: Stage A single-target → Stage B multi-target) ----
      if (args.actingCombatantId === undefined) {
        throw new Error("actingCombatantId required for recipe mode");
      }
      // Stage A→B transition: accept the legacy single `target` too.
      const targets = args.targets ?? (args.target !== undefined ? [args.target] : undefined);
      if (!targets || targets.length === 0) {
        throw new Error("at least one target required for recipe mode");
      }
      const acting = await ctx.db.get(args.actingCombatantId);
      if (acting === null || acting.gameId !== game._id) {
        throw new Error("Combatant not found");
      }
      actingName = acting.name;
      const recipe = await ctx.db.get(args.recipeId);
      // Combatant-owned or (for a linked PC) character-owned (issue #9).
      if (recipe === null || !childBelongsTo(recipe, acting)) {
        throw new Error("Recipe not found on acting combatant");
      }

      const dice = await ctx.db
        .query("dice")
        .withIndex("byGame", (q: any) => q.eq("gameId", game._id))
        .collect();
      const actorClaims = dice.filter((d: any) => d.claimedBy === acting._id);
      // Release all of the actor's claimed dice (consumed or not).
      diceToRelease.push(...actorClaims);

      // The actor's active effects drive their own attack advantage/disadvantage
      // (Poisoned, Invisible, Restrained, …). Combatant-owned + character-owned (#9).
      const actorEffects = await fetchChildren(ctx.db, "effects", acting);
      const actorSpecs = expandSpecs(actorEffects as any);

      const attackMod = args.attackMod ?? recipe.attackMod;
      const damageMod = args.damageMod ?? recipe.damageMod;
      const damageType = args.damageType ?? recipe.damageType;
      const dc = args.dc ?? recipe.dc;
      const extraRolls = (recipe.extraRolls ?? []) as ExtraRoll[];
      // Shared across the main damage dice + every extra roll so they draw
      // distinct claimed dice even when they share a die type. Unused by darts
      // resolution (automatic + darts), which splits its d4s per target itself.
      const diceCursor = makeDiceCursor(
        actorClaims.map((d: any) => ({ type: d.type as DieType, value: d.value as number })),
      );

      // Resolve each target's doc + Effective AC + R/V/I up front (Stage B).
      const tgtData: Array<{
        input: any;
        doc: any;
        label: string;
        reactionName?: string;
        ac: number;
        specs: any[];
        rvi: {
          resist: readonly string[];
          vuln: readonly string[];
          immune: readonly string[];
          resistAll: boolean;
        };
        /** This target's share of the actor's d4s (darts recipes only). */
        dartValues?: number[];
      }> = [];
      for (const input of targets) {
        const doc = await ctx.db.get(input.combatantId);
        if (doc === null || doc.gameId !== game._id) {
          throw new Error("Target not found");
        }
        // Combatant-owned + (for linked PCs) character-owned effects (#9).
        const tEffects = await fetchChildren(ctx.db, "effects", doc);
        const specs = expandSpecs(tEffects as any);
        // A linked PC's base ac lives on the character card (issue #9).
        const baseAc = (await statCarrier(ctx.db, doc)).ac;

        // Reaction: the target spends their reaction on one of their own
        // recipes (e.g. Shield) before this resolution commits. Its
        // appliesMods join the target's active effects for THIS resolution
        // (so the Wolf's hit becomes a miss against AC+5) and persist as a
        // toggleable effect row (reversible chip, v1 manual expiry). The
        // reaction economy flag flips; a linked Resource is consumed.
        let label = doc.name;
        let reactionName: string | undefined;
        if (input.reactionRecipeId !== undefined) {
          const reaction = await ctx.db.get(input.reactionRecipeId);
          if (reaction === null || !childBelongsTo(reaction, doc)) {
            throw new Error("Reaction recipe not found on the target");
          }
          // Healing/tempHp rows only fire when the recipe itself is confirmed
          // — a reaction's instant rows are ignored (v1 cut). Direction is
          // likewise ignored: a reaction always applies to the reactor.
          const rMods = ((reaction.appliesMods ?? []) as ModifierSpec[]).filter(
            (m) => m.stat !== "healing" && m.stat !== "tempHp",
          );
          if (rMods.length > 0) {
            // A linked PC's reaction chip lives on the character (issue #9).
            await ctx.db.insert("effects", {
              ...childOwner(doc),
              type: "custom",
              label: reaction.name,
              specs: rMods,
              active: true,
            });
            // The reaction's own mods ride along in `specs`, so the save path
            // below picks them up through the ability-scoped effectiveNumber
            // like any other spec — nothing extra to accumulate here.
            specs.push(...rMods);
          }
          await ctx.db.patch(doc._id, { reactionUsed: true });
          if (reaction.resourceId !== undefined && reaction.resourceCost > 0) {
            const resource = await ctx.db.get(reaction.resourceId);
            if (resource !== null && childBelongsTo(resource, doc)) {
              await ctx.db.patch(resource._id, {
                current: Math.max(0, resource.current - reaction.resourceCost),
              });
            }
          }
          label = `${doc.name} (${reaction.name}!)`;
          reactionName = reaction.name;
        }

        tgtData.push({
          input,
          doc,
          label,
          reactionName,
          ac: effectiveNumber(baseAc, specs, "ac").value,
          specs,
          rvi: {
            resist: doc.resist ?? [],
            vuln: doc.vuln ?? [],
            immune: doc.immune ?? [],
            resistAll: hasResistAll(tEffects as any),
          },
        });
      }

      const outcomeParts: string[] = [];
      const evTargets: LogEventTarget[] = [];
      /**
       * Apply a clamped HP delta to a target + record the log effect. The
       * write lands on the target's stat carrier — a linked PC's hp lives on
       * the character card (issue #9). Re-fetched per call so repeated hits
       * on one target within a Confirm see each other's writes.
       */
      const applyHp = async (doc: any, hpDelta: number) => {
        const carrier = await statCarrier(ctx.db, doc);
        // 臨時生命值 absorbs damage first (PHB p.198); hp + tempHp resolve
        // together in one authority (applyHpWithTemp) so the clamp and the
        // buffer can't drift apart.
        const { hp, tempHp } = applyHpWithTemp({
          hp: carrier.hp,
          maxHp: carrier.maxHp,
          tempHp: carrier.tempHp ?? 0,
          delta: hpDelta,
        });
        await ctx.db.patch(carrier._id, { hp, tempHp });
        applied.push({ combatantId: doc._id, name: doc.name, hpDelta });
      };

      // Darts (Magic Missile-style) is ORTHOGONAL to hitType — it decides where
      // each target's damage comes from, never whether the action lands:
      //   damage source  ← multiTarget: each target gets the darts assigned to
      //                    it (1 claimed d4 each, +1 force per dart) instead of
      //                    the recipe's shared damage roll.
      //   gate           ← hitType: automatic (no roll), attack (the actor's
      //                    ONE swing vs each target's own AC), or save (each
      //                    target rolls its own save; success halves).
      // Gating darts on `multiTarget` alone made it a hidden fourth hitType, so
      // editing Magic Missile to `save` silently changed nothing (#33).
      // The d4s are allocated once here, in board order, so every gate below
      // reads the same split.
      const isDarts = recipe.multiTarget === "darts";
      if (isDarts) {
        const d4Claims = actorClaims
          .filter((d: any) => d.type === "d4")
          .sort((a: any, b: any) => a.order - b.order);
        let idx = 0;
        for (const t of tgtData) {
          const count = t.input.darts ?? 0;
          if (count <= 0) continue;
          if (idx + count > d4Claims.length) {
            throw new Error(
              `${recipe.name}: assigned ${idx + count} darts but only ${d4Claims.length} d4s claimed`,
            );
          }
          t.dartValues = d4Claims
            .slice(idx, idx + count)
            .map((d: any) => d.value as number);
          idx += count;
        }
      }
      // The shared damage roll + extra rolls, drawn once for every gate below.
      // Darts take their d4s straight from the actor's claims (allocated
      // above), so they must NOT draw here — the recipe's damage dice ARE those
      // same d4s, and the cursor would hand them out twice. Extra rolls stay
      // unwired for darts at every hitType (v1 cut, see `ExtraRoll` in rules).
      const damageDiceValues = diceCursor.take(isDarts ? [] : recipe.damageDice);
      const { battleRolls, roleplayNote } = consumeExtraRolls(
        diceCursor,
        isDarts ? [] : extraRolls,
      );
      /**
       * This target's damage source. Darts replace the recipe's shared damage
       * roll with that target's own d4s; every dart carries the recipe's
       * `damageMod`, so the target's total mod is dartCount × damageMod and
       * crit doubles the dart dice but not those mods. Magic Missile
       * (damageMod 1) is the familiar `sum(d4 + 1)`. Non-darts untouched.
       */
      const damageSourceFor = (t: (typeof tgtData)[number]) =>
        t.dartValues === undefined
          ? { values: damageDiceValues, mod: damageMod }
          : { values: t.dartValues, mod: t.dartValues.length * damageMod };
      /** Darts assigned no dice take no part in the action at all. */
      const skipTarget = (t: (typeof tgtData)[number]) =>
        isDarts && t.dartValues === undefined;
      /** ` 2 darts` for the legacy summary text; "" for non-darts recipes. */
      const dartsMark = (t: (typeof tgtData)[number]) =>
        t.dartValues === undefined
          ? ""
          : ` ${t.dartValues.length} dart${t.dartValues.length > 1 ? "s" : ""}`;

      if (recipe.hitType === "attack") {
        // Attack: the actor's claimed d20(s) resolved against EACH target's own
        // Effective AC (universal multi-target — same swing, same damage dice,
        // per-target hit check + R/V/I). Net advantage = the actor's own attack
        // adv/dis (Poisoned, Invisible, …) combined with the target's
        // `attackAgainst` adv/dis (Blinded, Stunned, Paralyzed, …). Advantage or
        // disadvantage consumes 2 d20s (engine takes max/min); neutral takes 1.
        // With darts, that ONE swing still decides each target separately — the
        // darts only change how much damage a hit lands (#33).
        for (const t of tgtData) {
          if (skipTarget(t)) continue;
          // Actor and target overrides independently replace only their own
          // side's automatic signals. Preserve all remaining raw signals until
          // the final roll-level cancellation (Case 1 + issue #31).
          const actorOverride = args.actorAdvOverride as Advantage | undefined;
          const targetOverride = t.input.advOverride as Advantage | undefined;
          const actorSignals = actorOverride === undefined
            ? advantageSignalsFor(actorSpecs, "attack")
            : overrideSignals(actorOverride);
          const targetSignals = targetOverride === undefined
            ? advantageSignalsFor(t.specs, "attackAgainst")
            : overrideSignals(targetOverride);
          const netAdv = combineAdvSignals(actorSignals, targetSignals);
          const need = netAdv === "none" ? 1 : 2;
          const d20s = claimedDice(dice, acting._id, "d20", need).map(
            (d: any) => d.value as number,
          );
          if (d20s.length < need && t.input.forceOutcome === undefined) {
            throw new Error(
              `Acting combatant needs ${need} claimed d20${
                need > 1 ? "s" : ""
              } for the attack roll${need > 1 ? " (advantage/disadvantage)" : ""}`,
            );
          }
          const src = damageSourceFor(t);
          const res = resolveAttack({
            d20s,
            advantage: netAdv,
            attackMod: netAttackMod(attackMod, actorSpecs, t.specs),
            targetAc: t.ac,
            damageDiceValues: src.values,
            damageMod: src.mod,
            damageType,
            rvi: t.rvi,
            critImmune: recipe.critImmune,
            forceOutcome: t.input.forceOutcome as ForceOutcome | undefined,
            forceDamage: t.input.forceDamage ?? null,
          });
          // Extra battle rolls only apply on a hit, riding the same crit as the
          // main damage (their own damageType, so an elemental rider stays that
          // type even against a slashing weapon). A healing-typed rider heals
          // the target instead of adding damage — same hit/crit gating
          // (computeDamage's healing branch skips R/V/I and doubles on crit).
          let totalDamage = res.hit ? res.damage : 0;
          let totalHeal = 0;
          const extraNotes: string[] = [];
          const extraEv: { label: string; amount: number; isHeal: boolean }[] = [];
          if (res.hit) {
            for (const { roll, values } of battleRolls) {
              const extra = computeDamage({
                diceValues: values,
                damageMod: roll.damageMod,
                crit: res.crit,
                damageType: roll.damageType,
                rvi: t.rvi,
                half: false,
              });
              if (roll.damageType === "healing") {
                totalHeal += extra.applied;
                extraNotes.push(`${roll.label} +${extra.applied}治療`);
                extraEv.push({ label: roll.label, amount: extra.applied, isHeal: true });
              } else {
                totalDamage += extra.applied;
                extraNotes.push(`${roll.label} +${extra.applied}`);
                extraEv.push({ label: roll.label, amount: extra.applied, isHeal: false });
              }
            }
          }
          await applyHp(t.doc, -totalDamage);
          if (totalHeal > 0) await applyHp(t.doc, totalHeal);
          const advMark = netAdv === "none" ? "" : ` (${netAdv === "advantage" ? "adv" : "disadv"})`;
          const extraMark = extraNotes.length > 0 ? ` [${extraNotes.join(", ")}]` : "";
          const dartMark = dartsMark(t);
          outcomeParts.push(
            `${t.label}:${advMark}${dartMark} ${res.hit ? "HIT" : "MISS"}${res.crit ? " (CRIT)" : ""}${totalDamage > 0 ? ` ${totalDamage}` : ""}${extraMark}`,
          );
          evTargets.push({
            name: t.doc.name,
            reactionName: t.reactionName,
            darts: t.dartValues?.length,
            adv: netAdv === "none" ? undefined : netAdv,
            hit: res.hit,
            crit: res.crit || undefined,
            damage: totalDamage > 0 ? totalDamage : undefined,
            damageType,
            heal: totalHeal > 0 ? totalHeal : undefined,
            forced:
              t.input.forceOutcome !== undefined || t.input.forceDamage !== undefined
                ? true
                : undefined,
            extras: extraEv.length > 0 ? extraEv : undefined,
          });
        }
        rollSummary = `${recipe.name} · ${outcomeParts.join(", ")}`;
        if (roleplayNote) rollSummary += ` · ${roleplayNote}`;
        event = {
          kind: "attack",
          recipeName: recipe.name,
          targets: evTargets,
          roleplayNote: roleplayNote || undefined,
        };
      } else if (recipe.hitType === "save") {
        // Save (AoE or single): actor's damage dice rolled once, applied per
        // target with that target's own save + R/V/I (half on success). The save
        // is per-ability: the recipe's saveAbility (English) maps to the zh key,
        // the target's base save bonus comes from its character card `saves[]`,
        // and the target's conditions drive advantage/disadvantage + auto-fail
        // for THAT ability (Stunned/Paralyzed auto-fail STR/DEX; Restrained
        // disadvantages DEX). Advantage/disadvantage consumes 2 d20s.
        // With darts, each target still rolls its own save — the darts only set
        // how much damage that save is against (#33).
        const abilityZh = saveAbilityToZh(recipe.saveAbility);
        for (const t of tgtData) {
          if (skipTarget(t)) continue;
          // Base save bonus from the linked character card (0 if none/unlinked).
          const carrier = await statCarrier(ctx.db, t.doc);
          const cardSave = abilityZh
            ? ((carrier.saves as ReadonlyArray<{ key: string; total: number }> | undefined)?.find(
                  (s) => s.key === abilityZh,
                )?.total ?? 0)
            : 0;
          // Save specs for this ability (generic + ability-scoped), including
          // the reaction's mods already folded into t.specs. Bonuses sum; an
          // override (e.g. "your save is always 20") wins over everything else
          // — most-restrictive-wins, which is exactly effectiveNumber.
          const saveBonus = effectiveNumber(
            cardSave + (t.input.saveBonus ?? 0),
            t.specs,
            "save",
            abilityZh,
          ).value;
          // The toggle applies to the save roll in BOTH saveMode variants
          // (Case 1 Extend: the target's adv/disadv works whether the save is
          // read as damage-decrease or as hit-or-miss).
          const saveAdv =
            (t.input.advOverride as Advantage | undefined) ??
            advantageFor(t.specs, "save", abilityZh);
          const autoFail = autoFailFor(t.specs, "save", abilityZh);
          const need = saveAdv === "none" ? 1 : 2;
          const saveDice = claimedDice(dice, t.doc._id, "d20", need);
          for (const sd of saveDice) diceToRelease.push(sd);
          const saveD20s = saveDice.map((d: any) => d.value as number);
          if (saveD20s.length < need && t.input.forceOutcome === undefined) {
            throw new Error(
              `${t.doc.name} needs ${need} claimed d20 for the save${
                need > 1 ? " (advantage/disadvantage)" : ""
              }`,
            );
          }
          const src = damageSourceFor(t);
          const res = resolveSave({
            saveD20s,
            advantage: saveAdv,
            autoFail,
            saveBonus,
            dc,
            damageDiceValues: src.values,
            damageMod: src.mod,
            damageType,
            rvi: t.rvi,
            forceOutcome: t.input.forceOutcome as ForceOutcome | undefined,
            forceDamage: t.input.forceDamage ?? null,
          });
          // Extra battle rolls always apply (unlike attack, a save doesn't
          // negate the rider) and follow the same save-for-half as the main
          // damage. A healing-typed rider heals the target and is never halved
          // (computeDamage's healing branch ignores `half`) — and it survives
          // the hitOrMiss negate below, which only zeroes the damage.
          let totalDamage = res.damage;
          let totalHeal = 0;
          const extraNotes: string[] = [];
          const extraEv: { label: string; amount: number; isHeal: boolean }[] = [];
          for (const { roll, values } of battleRolls) {
            const extra = computeDamage({
              diceValues: values,
              damageMod: roll.damageMod,
              crit: false,
              damageType: roll.damageType,
              rvi: t.rvi,
              half: res.success,
            });
            if (roll.damageType === "healing") {
              totalHeal += extra.applied;
              extraNotes.push(`${roll.label} +${extra.applied}治療`);
              extraEv.push({ label: roll.label, amount: extra.applied, isHeal: true });
            } else {
              totalDamage += extra.applied;
              extraNotes.push(`${roll.label} +${extra.applied}`);
              extraEv.push({ label: roll.label, amount: extra.applied, isHeal: false });
            }
          }
          // "hitOrMiss" saveMode: a successful save means the Actor MISSED —
          // no damage at all instead of half (e.g. 雷鳴爆). A DM-forced damage
          // still wins (ADR-0002).
          const negate = t.input.saveMode === "hitOrMiss";
          if (negate && res.success && t.input.forceDamage === undefined) {
            totalDamage = 0;
          }
          await applyHp(t.doc, -totalDamage);
          if (totalHeal > 0) await applyHp(t.doc, totalHeal);
          const mark = autoFail
            ? " (auto-fail)"
            : saveAdv === "none"
              ? ""
              : ` (${saveAdv === "advantage" ? "adv" : "disadv"})`;
          const extraMark = extraNotes.length > 0 ? ` [${extraNotes.join(", ")}]` : "";
          const outcomeWord = negate
            ? res.success ? "MISS" : "HIT"
            : res.success ? "SAVE" : "FAIL";
          outcomeParts.push(
            `${t.label}:${mark}${dartsMark(t)} ${outcomeWord} ${totalDamage}${extraMark}`,
          );
          evTargets.push({
            name: t.doc.name,
            reactionName: t.reactionName,
            darts: t.dartValues?.length,
            adv: saveAdv === "none" ? undefined : saveAdv,
            autoFail: autoFail || undefined,
            saveSuccess: res.success,
            saveMode: negate ? "hitOrMiss" : "damage",
            damage: totalDamage > 0 ? totalDamage : undefined,
            damageType,
            heal: totalHeal > 0 ? totalHeal : undefined,
            forced:
              t.input.forceOutcome !== undefined || t.input.forceDamage !== undefined
                ? true
                : undefined,
            extras: extraEv.length > 0 ? extraEv : undefined,
          });
        }
        rollSummary = `${recipe.name} · ${outcomeParts.join(", ")}`;
        if (roleplayNote) rollSummary += ` · ${roleplayNote}`;
        event = {
          kind: "save",
          recipeName: recipe.name,
          dc,
          saveAbility: recipe.saveAbility,
          targets: evTargets,
          roleplayNote: roleplayNote || undefined,
        };
      } else {
        // Automatic (AoE or single): same dice applied per target with its own
        // R/V/I. Healing is capped at each target's maxHp. Automatic + darts is
        // Magic Missile RAW — no roll, each target just takes its darts.
        const isHeal = damageType === "healing";
        // Healing bypasses R/V/I, so a healing rider on a heal folds straight
        // into the same heal total (one cap-at-maxHp computation instead of
        // two). Damage-typed riders on a heal stay damage (applied per target
        // below); healing riders on a damage roll heal (split in the loop).
        const healRiders = battleRolls.filter((b) => b.roll.damageType === "healing");
        const damageRiders = battleRolls.filter((b) => b.roll.damageType !== "healing");
        const healExtraDice = isHeal ? healRiders.flatMap((b) => b.values) : [];
        const healExtraMod = isHeal ? healRiders.reduce((s, b) => s + b.roll.damageMod, 0) : 0;
        for (const t of tgtData) {
          if (skipTarget(t)) continue;
          const src = damageSourceFor(t);
          if (isHeal) {
            // Heal math reads the stat carrier (linked PC hp lives on the
            // card, issue #9), fresh so earlier targets' writes are seen.
            const carrier = await statCarrier(ctx.db, t.doc);
            let healResult;
            if (t.input.forceDamage !== undefined) {
              const newHp = Math.min(carrier.maxHp, carrier.hp + t.input.forceDamage);
              healResult = {
                heal: newHp - carrier.hp,
                newHp,
                breakdown: `${carrier.hp} + ${t.input.forceDamage} (forced) → ${newHp}`,
              };
            } else {
              healResult = computeHeal({
                diceValues: [...src.values, ...healExtraDice],
                healMod: src.mod + healExtraMod,
                currentHp: carrier.hp,
                maxHp: carrier.maxHp,
              });
            }
            await applyHp(t.doc, healResult.heal);
            // Damage-typed riders on a heal apply as damage, after the heal.
            let riderDamage = 0;
            const extraNotes: string[] = [];
            const extraEv: { label: string; amount: number; isHeal: boolean }[] = [];
            for (const { roll, values } of damageRiders) {
              const extra = computeDamage({
                diceValues: values,
                damageMod: roll.damageMod,
                crit: false,
                damageType: roll.damageType,
                rvi: t.rvi,
                half: false,
              });
              riderDamage += extra.applied;
              extraNotes.push(`${roll.label} ${extra.applied}`);
              extraEv.push({ label: roll.label, amount: extra.applied, isHeal: false });
            }
            if (riderDamage > 0) await applyHp(t.doc, -riderDamage);
            const extraMark = extraNotes.length > 0 ? ` [${extraNotes.join(", ")}]` : "";
            outcomeParts.push(`${t.label}: +${healResult.heal}${extraMark}`);
            evTargets.push({
              name: t.doc.name,
              reactionName: t.reactionName,
              heal: healResult.heal,
              damage: riderDamage > 0 ? riderDamage : undefined,
              forced: t.input.forceDamage !== undefined || undefined,
              extras: extraEv.length > 0 ? extraEv : undefined,
            });
          } else {
            const res = resolveAutomatic({
              damageDiceValues: src.values,
              damageMod: src.mod,
              damageType,
              rvi: t.rvi,
              forceDamage: t.input.forceDamage ?? null,
            });
            let totalDamage = res.damage;
            let totalHeal = 0;
            const extraNotes: string[] = [];
            const extraEv: { label: string; amount: number; isHeal: boolean }[] = [];
            for (const { roll, values } of battleRolls) {
              const extra = computeDamage({
                diceValues: values,
                damageMod: roll.damageMod,
                crit: false,
                damageType: roll.damageType,
                rvi: t.rvi,
                half: false,
              });
              if (roll.damageType === "healing") {
                totalHeal += extra.applied;
                extraNotes.push(`${roll.label} +${extra.applied}治療`);
                extraEv.push({ label: roll.label, amount: extra.applied, isHeal: true });
              } else {
                totalDamage += extra.applied;
                extraNotes.push(`${roll.label} +${extra.applied}`);
                extraEv.push({ label: roll.label, amount: extra.applied, isHeal: false });
              }
            }
            await applyHp(t.doc, -totalDamage);
            if (totalHeal > 0) await applyHp(t.doc, totalHeal);
            const extraMark = extraNotes.length > 0 ? ` [${extraNotes.join(", ")}]` : "";
            // "Goblin: 2 darts → 7 force" for darts; unchanged otherwise.
            const dartArrow =
              t.dartValues === undefined ? "" : `${dartsMark(t).trim()} → `;
            outcomeParts.push(
              `${t.label}: ${dartArrow}${totalDamage} ${damageType}${extraMark}`,
            );
            evTargets.push({
              name: t.doc.name,
              reactionName: t.reactionName,
              darts: t.dartValues?.length,
              damage: totalDamage,
              damageType,
              heal: totalHeal > 0 ? totalHeal : undefined,
              forced: t.input.forceDamage !== undefined || undefined,
              extras: extraEv.length > 0 ? extraEv : undefined,
            });
          }
        }
        rollSummary = `${recipe.name} · ${outcomeParts.join(", ")}`;
        if (roleplayNote) rollSummary += ` · ${roleplayNote}`;
        event = {
          // Automatic + darts stays `darts` — the no-roll Magic Missile the
          // renderer already knows. The gated variants report their gate
          // (`attack`/`save`) and carry the dart count per target.
          kind: isHeal ? "heal" : isDarts ? "darts" : "auto",
          recipeName: recipe.name,
          targets: evTargets,
          roleplayNote: roleplayNote || undefined,
        };
      }

      // Legacy resource consumption (healing/spell pools): only when the
      // frontend did NOT send an armed-pool list (see `spendResources` — when
      // present it is authoritative and handled below for both modes). The
      // pool may be combatant-owned or character-owned (issue #9).
      if (
        args.spendResources === undefined &&
        recipe.resourceId !== undefined &&
        recipe.resourceCost > 0
      ) {
        const resource = await ctx.db.get(recipe.resourceId);
        if (resource !== null && childBelongsTo(resource, acting)) {
          await ctx.db.patch(resource._id, {
            current: Math.max(0, resource.current - recipe.resourceCost),
          });
        }
      }

      // Apply the recipe's mods (issue #7 + directed-mods request). Each row
      // goes to its own recipients: `direction: "self"` → the actor;
      // "targets" (default) → the row's `modTargets` checkboxes, or targets[0]
      // when the frontend sent no assignments (legacy single-chip behavior).
      // Healing rows apply instantly — actor-claimed dice (consumed AFTER the
      // main damage dice and extra rolls) + `value`, the full amount to EACH
      // recipient, clamped at maxHp — and never become a chip (nothing to
      // toggle off). The remaining rows insert as one toggleable chip per
      // recipient with that recipient's subset. Reuses the #5 model; v1
      // manual expiry. Heal-row dice are not meaningful under darts resolution
      // (automatic + darts: those d4s bypass the cursor, same v1 cut as
      // extraRolls); an attack/save recipe that merely carries `darts` uses the
      // cursor normally.
      const mods = (recipe.appliesMods ?? []) as ModifierSpec[];
      if (mods.length > 0) {
        const assignedIds = new Map<number, string[]>();
        for (const a of args.modTargets ?? []) {
          assignedIds.set(a.modIndex, a.combatantIds as string[]);
        }
        const recipientsOf = (m: ModifierSpec, i: number): any[] => {
          if (m.direction === "self") return [acting];
          if (args.modTargets === undefined) return [tgtData[0].doc];
          const ids = assignedIds.get(i) ?? [];
          // Dedup: the same combatant can appear as two target rows.
          const seen = new Set<string>();
          return tgtData
            .filter((t) => ids.includes(t.doc._id))
            .filter((t) => (seen.has(t.doc._id) ? false : (seen.add(t.doc._id), true)))
            .map((t) => t.doc);
        };
        const chipByRecipient = new Map<string, { doc: any; specs: ModifierSpec[] }>();
        const healNotes: string[] = [];
        const evHeals: { amount: number; tempHp: boolean; to: string[] }[] = [];
        const evGrants: { to: string; mods: { mode: string; stat: string; value: number }[] }[] = [];
        for (const [i, m] of mods.entries()) {
          const recipients = recipientsOf(m, i);
          if (m.stat === "healing") {
            // Dice consumed once per row — full rolled amount to each recipient.
            const heal =
              diceCursor.take(m.dice ?? []).reduce((s, v) => s + v, 0) + m.value;
            for (const doc of recipients) {
              await applyHp(doc, heal);
            }
            if (recipients.length > 0) {
              healNotes.push(`+${heal} → ${recipients.map((d) => d.name).join(", ")}`);
              evHeals.push({ amount: heal, tempHp: false, to: recipients.map((d) => d.name) });
            }
          } else if (m.stat === "tempHp") {
            // Instant like healing (dice consumed once per row, full amount to
            // each recipient, no chip) but grants a temp-HP pool: no stacking,
            // keep the larger (PHB p.198), never clamped by maxHp. Writes land
            // on the stat carrier — a linked PC's tempHp lives on the card.
            const granted =
              diceCursor.take(m.dice ?? []).reduce((s, v) => s + v, 0) + m.value;
            for (const doc of recipients) {
              const carrier = await statCarrier(ctx.db, doc);
              await ctx.db.patch(carrier._id, {
                tempHp: grantTempHp(carrier.tempHp ?? 0, granted),
              });
            }
            if (recipients.length > 0) {
              healNotes.push(
                `+${granted}臨時 → ${recipients.map((d) => d.name).join(", ")}`,
              );
              evHeals.push({ amount: granted, tempHp: true, to: recipients.map((d) => d.name) });
            }
          } else {
            for (const doc of recipients) {
              const entry = chipByRecipient.get(doc._id) ?? { doc, specs: [] };
              entry.specs.push(m);
              chipByRecipient.set(doc._id, entry);
            }
          }
        }
        const grantNotes: string[] = [];
        for (const { doc, specs } of chipByRecipient.values()) {
          // A linked PC's buff chip lives on the character (issue #9).
          await ctx.db.insert("effects", {
            ...childOwner(doc),
            type: "custom",
            label: recipe.name,
            specs,
            active: true,
          });
          const modLabel = specs
            .map((m) => {
              if (m.mode === "advantage" || m.mode === "disadvantage") {
                return `${m.mode} ${m.stat}`;
              }
              return `${m.value >= 0 ? "+" : ""}${m.value} ${m.stat}`;
            })
            .join(", ");
          grantNotes.push(`${modLabel} → ${doc.name}`);
          evGrants.push({
            to: doc.name,
            mods: specs.map((m) => ({ mode: m.mode, stat: m.stat, value: m.value })),
          });
        }
        if (grantNotes.length > 0) rollSummary += ` · grants ${grantNotes.join("; ")}`;
        if (healNotes.length > 0) rollSummary += ` · heals ${healNotes.join("; ")}`;
        if (event !== undefined) {
          if (evGrants.length > 0) event.grants = evGrants;
          if (evHeals.length > 0) event.heals = evHeals;
        }
      }
    } else {
      // ---- Manual mode (issue #4) ----
      let claimed: { type: DieType; value: number }[] = [];
      if (args.actingCombatantId !== undefined) {
        const acting = await ctx.db.get(args.actingCombatantId);
        if (acting === null || acting.gameId !== game._id) {
          throw new Error("Combatant not found");
        }
        actingName = acting.name;
        const dice = await ctx.db
          .query("dice")
          .withIndex("byGame", (q: any) => q.eq("gameId", game._id))
          .collect();
        claimed = dice
          .filter((d: any) => d.claimedBy === acting._id)
          .map((d: any) => ({ type: d.type as DieType, value: d.value as number }));
        rollSummary = summarizeRoll(claimed);
        diceToRelease.push(...dice.filter((d: any) => d.claimedBy === acting._id));
      }
      event = {
        kind: "manual",
        targets: [],
        claimedDice: claimed.length > 0 ? claimed : undefined,
      };

      // Apply HP deltas (clamped to [0, maxHp]), snapshotting each target.
      // Writes land on the stat carrier — a linked PC's hp lives on the
      // character card (issue #9).
      for (const eff of args.effects ?? []) {
        const target = await ctx.db.get(eff.combatantId);
        if (target === null || target.gameId !== game._id) {
          throw new Error("Combatant not found");
        }
        const carrier = await statCarrier(ctx.db, target);
        const hp = Math.max(
          0,
          Math.min(carrier.hp + eff.hpDelta, carrier.maxHp),
        );
        await ctx.db.patch(carrier._id, { hp });
        applied.push({
          combatantId: target._id,
          name: target.name,
          hpDelta: eff.hpDelta,
        });
      }
    }

    // BG3-style armed pools (issue #9): spend every resource the actor toggled
    // before this Confirm — e.g. arm "L1 法術位" + "魔法飛彈奧秘", cast Magic
    // Missile, both tick down. Pools must belong to the actor (directly or via
    // the character link). Clamped at 0; the log records what was spent.
    if (args.spendResources !== undefined && args.spendResources.length > 0) {
      if (args.actingCombatantId === undefined) {
        throw new Error("actingCombatantId required to spend resources");
      }
      const actingDoc = await ctx.db.get(args.actingCombatantId);
      if (actingDoc === null || actingDoc.gameId !== game._id) {
        throw new Error("Combatant not found");
      }
      const spentParts: string[] = [];
      const evSpent: { label: string; amount: number }[] = [];
      for (const s of args.spendResources) {
        const resource = await ctx.db.get(s.resourceId);
        if (resource === null || !childBelongsTo(resource, actingDoc)) {
          throw new Error("Armed resource not found on the acting combatant");
        }
        const amount = s.amount ?? 1;
        await ctx.db.patch(resource._id, {
          current: Math.max(0, resource.current - amount),
        });
        spentParts.push(`${resource.label}${amount !== 1 ? ` ×${amount}` : ""}`);
        evSpent.push({ label: resource.label, amount });
      }
      rollSummary += `${rollSummary ? " · " : ""}spent ${spentParts.join(", ")}`;
      if (event !== undefined) event.spent = evSpent;
    }

    // Release claimed dice (acting's claims + any target save d20).
    await Promise.all(
      diceToRelease
        .filter((d, i, arr) => arr.findIndex((x) => x._id === d._id) === i)
        .map((d: any) => ctx.db.patch(d._id, { claimedBy: undefined })),
    );

    // Append the log entry (append-only).
    await ctx.db.insert("combatLog", {
      gameId: game._id,
      round: game.round,
      actingCombatantId: args.actingCombatantId ?? undefined,
      actingName,
      rollSummary,
      effectText: args.effectText,
      effects: applied,
      event,
    });

    if (args.actingCombatantId !== undefined) {
      await battleDraftHelpers.clearDraftForConfirm(ctx.db, game, args.actingCombatantId);
    }

    // Batch battle (issue #8): a Confirm by the run's current combatant
    // advances the pointer (ending the run when the queue is exhausted).
    // Out-of-order Confirms are allowed — reactions, DM improvisation — and
    // simply don't advance (the run guides, never gatekeeps; ADR-0002).
    const run = game.batchRun;
    if (
      run !== undefined &&
      args.actingCombatantId !== undefined &&
      run.turnIds[run.turnIndex] === args.actingCombatantId
    ) {
      await advanceRunPointer(ctx.db, game);
    }
  },
});

/**
 * Recent combat-log entries for a Game (most-recent first, last 50). Either role
 * may read the log — it records committed results, not secrets (PRD US48).
 */
export const getCombatLog = query({
  args: {
    playerToken: v.string(),
    dmToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { game } = await resolveGame(ctx.db, args.playerToken, args.dmToken);
    const entries = await ctx.db
      .query("combatLog")
      .withIndex("byGame", (q: any) => q.eq("gameId", game._id))
      .order("desc")
      .take(50);
    return entries.map((e: any) => ({
      _id: e._id,
      _creationTime: e._creationTime,
      gameId: e.gameId,
      round: e.round,
      actingCombatantId: e.actingCombatantId ?? null,
      actingName: e.actingName,
      rollSummary: e.rollSummary,
      effectText: e.effectText,
      effects: e.effects,
      // Structured event (i18n) — absent on legacy rows.
      event: e.event,
    })) as CombatLogEntry[];
  },
});
