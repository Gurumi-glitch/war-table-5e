import { useEffect, useRef, useState } from "react";
import type { CombatantView, DiceView } from "../../convex/games";
import type { BattleDraftView } from "../../convex/battleDrafts";
import type { RecipeView } from "../../convex/recipes";
import type { ResourceView } from "../../convex/resources";
import { makeDiceCursor, consumeExtraRolls, summarizeRoll, type DieType } from "../../convex/diceHelpers";
import { ResourceTile } from "./ResourcePip";
import { parseSlotLevel } from "../lib/resourceLabels";
import type { ResourceHandlers } from "./CombatantSheet";
import {
  advantageFor,
  advantageSignalsFor,
  autoFailFor,
  combineAdvSignals,
  effectiveNumber,
  expandSpecs,
  hasCantAct,
  hasResistAll,
  saveAbilityToZh,
  type Advantage,
  type AdvSignals,
  type ModifierSpec,
} from "../../convex/modifiers";
import {
  resolveAttack,
  resolveSave,
  resolveAutomatic,
  computeDamage,
  computeHeal,
  DAMAGE_TYPES,
  type ExtraRoll,
  type ForceOutcome,
  type HitType,
} from "../../convex/rules";
import { useT, type Messages } from "../i18n";
import { damageTypeLabel, saveAbilityLabel } from "../i18n/terms";

export type ConfirmEffect = {
  combatantId: string;
  hpDelta: number;
};

/** One target in a recipe-mode Confirm (issue #7 Stage B: multi-target). */
export type RecipeTarget = {
  combatantId: string;
  saveBonus?: number;
  forceOutcome?: ForceOutcome;
  forceDamage?: number;
  darts?: number;
  // The target's reaction (one of THEIR recipes, e.g. Shield) applied before
  // this resolution commits — its appliesMods feed the resolution's math.
  reactionRecipeId?: string;
  // Manual adv/disadv toggle: when set it REPLACES the condition-computed
  // default for this target's roll (attackAgainst for attack recipes, the
  // save for DC recipes — BOTH saveMode variants). Conditions only pre-set
  // the toggle; combines with — never replaces — the actor's own manual
  // toggle (see RecipeConfirm.actorAdvOverride).
  advOverride?: Advantage;
  // What a SUCCESSFUL save means (Case 1 Extend, DC recipes only, DM's call):
  // "damage" (default) = damage decrease — half damage on success;
  // "hitOrMiss" = the save decides if the Actor hits — success = no damage.
  saveMode?: "hitOrMiss" | "damage";
};

/** Recipe-mode Confirm payload (issue #7). */
export type RecipeConfirm = {
  actingCombatantId: string;
  recipeId: string;
  attackMod?: number;
  damageMod?: number;
  // Manual damage-type override: replaces the recipe's damageType for THIS
  // resolution (incl. R/V/I lookup and the healing/damage branch check).
  damageType?: string;
  dc?: number;
  // The ACTOR's own manual adv/disadv toggle (e.g. Reckless Attack) — session-
  // wide, not per-target. Combines with each target's advOverride instead of
  // replacing it (Case 1: a target-only override used to silently wipe the
  // actor's own advantage).
  actorAdvOverride?: Advantage;
  targets: RecipeTarget[];
  // Per-row recipients for the recipe's targets-directed appliesMods
  // (directed-mods request): modIndex = index into recipe.appliesMods,
  // combatantIds = the targets checked in the applied-mods block. Sent
  // whenever the recipe has appliesMods; absent = backend legacy (targets[0]).
  modTargets?: { modIndex: number; combatantIds: string[] }[];
  effectText: string;
  // BG3-style armed pools (issue #9): the actor's resources toggled for this
  // action — ALL are spent on Confirm (authoritative; replaces the recipe's
  // own auto-consumption). Arm L2 instead of L1 to upcast; arm 魔法飛彈奧秘 on
  // top to spend the rider too. Always sent in recipe mode.
  spendResources: { resourceId: string; amount: number }[];
};

/** Editable fields persisted in one collaborative Battle/Batch draft. */
export type BattleDraftPatch = {
  recipeId?: string | null;
  attackMod?: string;
  actorAdvOverride?: string;
  damageMod?: string;
  damageType?: string;
  dc?: string;
  dartTotal?: string;
  effectText?: string;
  manualTargets?: TargetDraft[];
  recipeTargets?: RecipeTargetDraft[];
  spendResources?: { resourceId: string; amount: number }[];
  modExcluded?: string[];
};

type Props = {
  dice: DiceView[];
  combatants: CombatantView[];
  onConfirm: (
    actingCombatantId: string | null,
    effectText: string,
    effects: ConfirmEffect[],
  ) => void;
  onConfirmRecipe: (payload: RecipeConfirm) => void;
  onSetClaim: (dieId: string, claimedBy: string | null) => void;
  /** Resource pip icon/color overrides (DESIGN.md board entry point). Absent = no gear button on the pips. */
  onUpdateResource?: ResourceHandlers["onUpdateResource"];
  /** Normal-Battle shared action draft. Absent is a compatible empty draft. */
  draft?: BattleDraftView;
  onSelectActor?: (actorId: string) => void;
  onPatchDraft?: (actorId: string, patch: BattleDraftPatch) => void;
};

type TargetDraft = { combatantId: string; hpDelta: number };
const EMPTY_TARGET: TargetDraft = { combatantId: "", hpDelta: 0 };

/** Editable recipe-target row (string fields for input; blank = default). */
type RecipeTargetDraft = {
  combatantId: string;
  saveBonus: string;
  forceOutcome: string;
  forceDamage: string;
  darts: string;
  reactionRecipeId: string;
  /** "" = auto (conditions decide) | "advantage" | "disadvantage" | "none". */
  advOverride: string;
  /** "" = damage (default) | "hitOrMiss" | "damage" — what a successful save means. */
  saveMode: string;
};
function emptyRecipeTarget(): RecipeTargetDraft {
  return {
    combatantId: "",
    saveBonus: "0",
    forceOutcome: "",
    forceDamage: "",
    darts: "0",
    reactionRecipeId: "",
    advOverride: "",
    saveMode: "",
  };
}

/** The target draft's saveMode: "damage" (save-for-half, default) or "hitOrMiss" (save negates). */
function saveModeOf(t: { saveMode: string }): "hitOrMiss" | "damage" {
  return t.saveMode === "hitOrMiss" ? "hitOrMiss" : "damage";
}

/** The draft's effective advantage: manual toggle if set, else the auto value. */
function effAdv(t: { advOverride: string }, auto: Advantage): Advantage {
  return t.advOverride === "" ? auto : (t.advOverride as Advantage);
}

/** The actor's own manual adv/disadv toggle if set, else the auto (condition) value. */
function actorAttackAdv(actorAdvOverride: string, auto: Advantage): Advantage {
  return actorAdvOverride === "" ? auto : (actorAdvOverride as Advantage);
}

/** Raw signals for one side; a manual override replaces only that side's automatic signals. */
function attackSignals(override: string, auto: AdvSignals): AdvSignals {
  if (override === "") return auto;
  return {
    hasAdv: override === "advantage",
    hasDis: override === "disadvantage",
  };
}

/** The reaction recipe a target draft selected, if any. */
function reactionOf(
  t: { combatantId: string; reactionRecipeId: string },
  combatants: CombatantView[],
): RecipeView | null {
  if (t.reactionRecipeId === "") return null;
  const c = combatants.find((x) => x._id === t.combatantId);
  if (!c?.recipes) return null;
  return c.recipes.find((r) => r._id === t.reactionRecipeId) ?? null;
}

/** A target's Effective AC including its chosen reaction's mods (preview math). */
function acWithReaction(
  c: CombatantView,
  reaction: RecipeView | null,
): number | null {
  if (c.effectiveAc === null) return null;
  if (!reaction) return c.effectiveAc.value;
  const active = c.effects.map((e) => ({
    type: e.type,
    label: e.label,
    specs: e.specs,
    active: e.active,
  }));
  const specs = [...expandSpecs(active), ...(reaction.appliesMods ?? [])];
  return effectiveNumber(c.ac as number, specs, "ac").value;
}

/**
 * Preview mirror of the backend's `netAttackMod` (combatLog.ts): folds the
 * actor's own `attack` bonus/override AND the target's `attackAgainst`
 * bonus/override into the recipe's attackMod — previously read only for
 * advantage/disadvantage, leaving a custom "+2 Attack" modifier silently inert.
 */
function netAttackMod(base: number, actorSpecs: readonly any[], targetSpecs: readonly any[]): number {
  const ownAttack = effectiveNumber(base, actorSpecs, "attack");
  return effectiveNumber(ownAttack.value, targetSpecs, "attackAgainst").value;
}

/**
 * Preview mirror of the backend's ability-scoped save handling (combatLog.ts).
 * Both sides now call the same `effectiveNumber`, so the preview can't drift
 * from what Confirm commits.
 */
function netSaveBonus(
  base: number,
  specs: readonly any[],
  abilityZh: string,
): number {
  return effectiveNumber(base, specs, "save", abilityZh).value;
}

/** Short label for one recipe extra roll, e.g. "Push (1d4, roleplay)" or "Fire Rider (1d6, battle: +2 fire)". */
function extraRollSummary(r: ExtraRoll, msg: Messages): string {
  const dice = r.dice.map((d) => `${d.count}${d.type}`).join("+");
  const detail = r.usage === "battle" ? `battle: ${r.damageMod >= 0 ? "+" : ""}${r.damageMod} ${r.damageType}` : "roleplay";
  return `${r.label || msg.confirm.untitled} (${dice}, ${detail})`;
}

/** Short label for one applied-mod row, e.g. "+5 ac", "advantage save", "治療 1d8+3". */
function modRowSummary(m: ModifierSpec, msg: Messages): string {
  if (m.stat === "healing" || m.stat === "tempHp") {
    const word = m.stat === "healing" ? msg.confirm.heal : msg.confirm.tempHpWord;
    const dice = (m.dice ?? []).map((d) => `${d.count}${d.type}`).join("+");
    if (dice === "") return `${word} ${m.value}`;
    if (m.value === 0) return `${word} ${dice}`;
    return `${word} ${dice}${m.value > 0 ? "+" : ""}${m.value}`;
  }
  if (m.mode === "advantage" || m.mode === "disadvantage") return `${m.mode} ${m.stat}`;
  return `${m.value >= 0 ? "+" : ""}${m.value} ${m.stat}`;
}

/** The key of one (mod row, target) checkbox in the excluded map. */
const modKey = (modIndex: number, combatantId: string) => `${modIndex}:${combatantId}`;

/**
 * Direct each applied-mod row (directed-mods request): self rows just apply
 * to the actor; targets rows get one checkbox per chosen target — all on by
 * default, untick to exclude (e.g. heal one ally but not the other).
 */
function AppliedModsDirector({
  mods,
  targets,
  combatants,
  excluded,
  setExcluded,
}: {
  mods: ModifierSpec[];
  targets: RecipeTargetDraft[];
  combatants: CombatantView[];
  excluded: Record<string, boolean>;
  setExcluded: (next: Record<string, boolean>) => void;
}) {
  const msg = useT();
  const seen = new Set<string>();
  const chosen = targets
    .map((t) => combatants.find((c) => c._id === t.combatantId))
    .filter((c): c is CombatantView => c !== undefined)
    .filter((c) => (seen.has(c._id) ? false : (seen.add(c._id), true)));
  return (
    <fieldset aria-label="applied mods">
      <legend>{msg.confirm.appliedMods}</legend>
      {mods.map((m, i) => (
        <div key={i}>
          {modRowSummary(m, msg)}{" "}
          {(m.direction ?? "targets") === "self" ? (
            <em style={{ color: "#666" }}>{msg.confirm.selfTag}</em>
          ) : chosen.length === 0 ? (
            <em style={{ color: "#666" }}>{msg.confirm.pickTargetsAbove}</em>
          ) : (
            chosen.map((c) => (
              <label key={c._id} style={{ marginRight: "0.5em" }}>
                <input
                  type="checkbox"
                  checked={!excluded[modKey(i, c._id)]}
                  onChange={(e) =>
                    setExcluded({ ...excluded, [modKey(i, c._id)]: !e.target.checked })
                  }
                  aria-label={`mod ${i} to ${c.name}`}
                />
                {c.name}
              </label>
            ))
          )}
        </div>
      ))}
    </fieldset>
  );
}

/**
 * Confirm a pending resolution. Two modes:
 * - **Manual** (no recipe): pick an actor (its claimed dice are summarized),
 *   enter target HP deltas + a free-text effect, commit. (#4)
 * - **Recipe** (#7): pick the actor's recipe, optionally tweak attackMod/damageMod/
 *   DC, pick one target (+ save bonus for saves), force any result, and commit —
 *   the backend resolves via the 5e rules engine. A "Claim dice" button claims the
 *   recipe's d20 + damage dice for the actor; a live preview shows the resolution.
 *
 * The body (everything below the Acting picker) is `ConfirmSession`, reused by
 * BatchBattlePanel to give every run member its own actor-bound session (#8).
 */
export function ConfirmPanel({ dice, combatants, onConfirm, onConfirmRecipe, onSetClaim, onUpdateResource, draft, onSelectActor, onPatchDraft }: Props) {
  const msg = useT();
  const [actingId, setActingId] = useState<string>("");
  const [folded, setFolded] = useState(false);
  const sharedActor = draft?.restricted ? "" : (draft?.actorId ?? "");
  const acting =
    (sharedActor || actingId) !== "" && combatants.some((c) => c._id === (sharedActor || actingId))
      ? (sharedActor || actingId)
      : combatants[0]?._id ?? "";

  return (
    <section aria-label="confirm" className="wt-panel wt-confirm">
      <h2
        className="wt-panel-title wt-clickable"
        onClick={() => setFolded((f) => !f)}
        title={folded ? msg.combat.unfold : msg.combat.fold}
      >
        {msg.confirm.battleTitle}
        <span className="wt-fold-mark">{folded ? "▸" : "▾"}</span>
      </h2>
      {!folded && (
        <div className="wt-panel-body">
          <label>
            {msg.confirm.acting}{" "}
            <select value={acting} onChange={(e) => {
              setActingId(e.target.value);
              onSelectActor?.(e.target.value);
            }} aria-label="acting combatant">
              <option value="">{msg.confirm.noneDmForced}</option>
              {combatants.map((c) => (
                <option key={c._id} value={c._id}>{c.name}</option>
              ))}
            </select>
          </label>
          {/* Keyed by actor so switching actors resets the session draft. */}
          <ConfirmSession
            key={acting}
            actorId={acting}
            dice={dice}
            combatants={combatants}
            onConfirm={onConfirm}
            onConfirmRecipe={onConfirmRecipe}
            onSetClaim={onSetClaim}
            onUpdateResource={onUpdateResource}
            draft={draft}
            onPatchDraft={onPatchDraft}
          />
        </div>
      )}
    </section>
  );
}

export type ConfirmSessionProps = {
  /** The acting combatant, fixed for this session ("" = DM-forced manual). */
  actorId: string;
  dice: DiceView[];
  combatants: CombatantView[];
  onConfirm: (
    actingCombatantId: string | null,
    effectText: string,
    effects: ConfirmEffect[],
  ) => void;
  onConfirmRecipe: (payload: RecipeConfirm) => void;
  onSetClaim: (dieId: string, claimedBy: string | null) => void;
  /**
   * Batch battle chained previews: pending HP deltas from EARLIER sessions in
   * the run queue, applied (clamped) to combatants for THIS session's preview
   * only — so a heal previews correctly against HP as it will be once the
   * earlier turns land. Never affects what is submitted.
   */
  hpOffsets?: Record<string, number>;
  /** Reports this session's own predicted HP deltas whenever they change. */
  onPreviewDeltas?: (deltas: Record<string, number>) => void;
  /** Resource pip icon/color overrides (DESIGN.md board entry point). Absent = no gear button on the pips. */
  onUpdateResource?: ResourceHandlers["onUpdateResource"];
  draft?: BattleDraftView;
  onPatchDraft?: (actorId: string, patch: BattleDraftPatch) => void;
};

/**
 * One combatant's Confirm session: recipe picker (or manual HP entry), claim
 * suggestion, overrides, targets, live preview, and the Confirm button — with
 * the actor already bound. Each instance keeps its own draft state, so several
 * sessions can be prepped in parallel during a Batch battle run.
 */
export function ConfirmSession({
  actorId,
  dice,
  combatants,
  onConfirm,
  onConfirmRecipe,
  onSetClaim,
  hpOffsets,
  onPreviewDeltas,
  onUpdateResource,
  draft,
  onPatchDraft,
}: ConfirmSessionProps) {
  const msg = useT();
  const [effectText, setEffectText] = useState("");
  const [targets, setTargets] = useState<TargetDraft[]>([{ ...EMPTY_TARGET }]);

  const [recipeId, setRecipeId] = useState<string>("");
  const [attackMod, setAttackMod] = useState<string>("");
  // The actor's own manual adv/disadv toggle (e.g. Reckless Attack) — session-
  // wide, combines with each target row's own toggle instead of replacing it.
  const [actorAdvOverride, setActorAdvOverride] = useState<string>("");
  const [damageMod, setDamageMod] = useState<string>("");
  // "" = use the recipe's own damageType (manual override, battle + batch battle).
  const [damageType, setDamageType] = useState<string>("");
  const [dc, setDc] = useState<string>("");
  // Stage B: recipe targets (one row for single-target/attack; many for aoe/darts).
  const [recipeTargets, setRecipeTargets] = useState<RecipeTargetDraft[]>([
    emptyRecipeTarget(),
  ]);
  // Darts mode: total darts to claim (Magic Missile base = 3; DM raises to upcast).
  const [dartTotal, setDartTotal] = useState<string>("3");
  // Applied-mods direction (directed-mods request): `${modIndex}:${combatantId}`
  // → true when that target is UNCHECKED for that mod row (default = all on).
  const [modExcluded, setModExcluded] = useState<Record<string, boolean>>({});
  // BG3-style armed pools (issue #9): resourceId → amount to spend on Confirm.
  // Picking a recipe pre-arms its linked pool; the toggles below adjust.
  const [spend, setSpend] = useState<Record<string, number>>({});
  const effectTextTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The backend draft is the shared source of truth. Local state makes typing
  // responsive; every mutation round-trip (including another client's edit)
  // reconciles this session to the newest draft without syncing focus/cursor.
  useEffect(() => {
    if (!draft || draft.restricted) return;
    setEffectText(draft.effectText);
    setTargets(draft.manualTargets);
    setRecipeId(draft.recipeId ?? "");
    setAttackMod(draft.attackMod);
    setActorAdvOverride(draft.actorAdvOverride);
    setDamageMod(draft.damageMod);
    setDamageType(draft.damageType);
    setDc(draft.dc);
    setRecipeTargets(draft.recipeTargets);
    setDartTotal(draft.dartTotal);
    setModExcluded(Object.fromEntries(draft.modExcluded.map((key) => [key, true])));
    setSpend(Object.fromEntries(draft.spendResources.map((item) => [item.resourceId, item.amount])));
  }, [draft?.updatedAt]);

  const patchDraft = (patch: BattleDraftPatch) => onPatchDraft?.(actorId, patch);
  const cancelEffectTextSync = () => {
    if (effectTextTimer.current !== null) clearTimeout(effectTextTimer.current);
    effectTextTimer.current = null;
  };
  const updateEffectText = (value: string) => {
    setEffectText(value);
    cancelEffectTextSync();
    effectTextTimer.current = setTimeout(() => patchDraft({ effectText: value }), 180);
  };
  const flushEffectText = () => {
    cancelEffectTextSync();
    patchDraft({ effectText });
  };
  useEffect(() => cancelEffectTextSync, []);
  const updateTargets = (value: TargetDraft[]) => { setTargets(value); patchDraft({ manualTargets: value }); };
  const updateRecipeTargets = (value: RecipeTargetDraft[]) => { setRecipeTargets(value); patchDraft({ recipeTargets: value }); };
  const updateAttackMod = (value: string) => { setAttackMod(value); patchDraft({ attackMod: value }); };
  const updateActorAdv = (value: string) => { setActorAdvOverride(value); patchDraft({ actorAdvOverride: value }); };
  const updateDamageMod = (value: string) => { setDamageMod(value); patchDraft({ damageMod: value }); };
  const updateDamageType = (value: string) => { setDamageType(value); patchDraft({ damageType: value }); };
  const updateDc = (value: string) => { setDc(value); patchDraft({ dc: value }); };
  const updateDartTotal = (value: string) => { setDartTotal(value); patchDraft({ dartTotal: value }); };
  const updateModExcluded = (value: Record<string, boolean>) => {
    setModExcluded(value);
    patchDraft({ modExcluded: Object.keys(value).filter((key) => value[key]) });
  };
  const updateSpend = (value: Record<string, number>) => {
    setSpend(value);
    patchDraft({ spendResources: Object.entries(value).map(([resourceId, amount]) => ({ resourceId, amount })) });
  };

  const acting = actorId;
  const actor = combatants.find((c) => c._id === acting) ?? null;
  const recipe = actor?.recipes?.find((r) => r._id === recipeId) ?? null;

  const claimed = dice
    .filter((d) => d.claimedBy !== null && d.claimedBy === acting)
    .map((d) => ({ type: d.type as DieType, value: d.value }));
  const rollSummary = acting ? summarizeRoll(claimed) : "";

  /** Claim the dice the recipe needs: the actor's landing d20(s) + damage dice
   *  (doubled when any target has damage adv/disadv), each target's save
   *  d20(s) for DC recipes (Case 1 Extend — no more Dice Board misclaims), or
   *  N d4s (darts). Claims within one click are tracked locally so two targets
   *  never grab the same unclaimed die. */
  const suggestClaims = () => {
    if (!actor || !recipe) return;
    // Dice already handed out during THIS click (onSetClaim is async — the
    // local `dice` array won't reflect them until the mutation round-trips).
    const takenIds = new Set<string>();
    const claimUnclaimed = (type: DieType, count: number, toWhom: string) => {
      let left = count;
      for (const d of dice) {
        if (left <= 0) break;
        if (d.type === type && d.claimedBy === null && !takenIds.has(d._id)) {
          takenIds.add(d._id);
          onSetClaim(d._id, toWhom);
          left--;
        }
      }
    };
    const dartsRecipe = recipe.multiTarget === "darts";
    if (recipe.hitType === "attack") {
      // Advantage or disadvantage consumes 2 d20s. Each side's manual toggle
      // replaces only that side's automatic signals; all remaining raw signals
      // cancel once across the whole attack roll (Case 1 + issue #31).
      const actorSignals = attackSignals(
        actorAdvOverride,
        advantageSignalsFor(expandSpecs(actor.effects as any), "attack"),
      );
      const anyAdv = recipeTargets.some((t) => {
        const c = combatants.find((x) => x._id === t.combatantId);
        const r = reactionOf(t, combatants);
        if (!c) return combineAdvSignals(actorSignals) !== "none";
        const targetSignals = attackSignals(
          t.advOverride,
          advantageSignalsFor(
            [...expandSpecs(c.effects as any), ...((r?.appliesMods ?? []) as any)],
            "attackAgainst",
          ),
        );
        return combineAdvSignals(actorSignals, targetSignals) !== "none";
      });
      claimUnclaimed("d20", anyAdv ? 2 : 1, acting);
    }
    if (dartsRecipe) {
      // Darts REPLACE the recipe's damage roll: N d4s, one per dart, split
      // across targets at Confirm. Extra rolls and instant heal rows stay
      // unclaimed — the backend leaves them unwired for darts (rules.ts
      // `ExtraRoll`), so claiming them would strand dice on the board.
      claimUnclaimed("d4", Math.max(0, Number(dartTotal) || 0), acting);
    } else {
      for (const term of recipe.damageDice) {
        claimUnclaimed(term.type, term.count, acting);
      }
      // Extra rolls (roleplay flavor or a 2nd battle damage roll) are claimed
      // AFTER the main damage dice, in the recipe's list order — same sequence
      // the backend consumes them in at Confirm.
      for (const roll of recipe.extraRolls ?? []) {
        for (const term of roll.dice) {
          claimUnclaimed(term.type, term.count, acting);
        }
      }
      // Applied-mods healing/tempHp dice come LAST — same order the backend's
      // cursor consumes them at Confirm (main damage → extra rolls → instant rows).
      for (const m of recipe.appliesMods ?? []) {
        if (m.stat !== "healing" && m.stat !== "tempHp") continue;
        for (const term of m.dice ?? []) {
          claimUnclaimed(term.type, term.count, acting);
        }
      }
    }
    // DC recipes: each chosen target's save d20(s) — claimed TO that target
    // (Case 1 Extend: the DC die used to end up on the actor via the Dice
    // Board's lingering "Claiming for" selector).
    if (recipe.hitType === "save") {
      const abilityZh = saveAbilityToZh(recipe.saveAbility);
      for (const t of recipeTargets) {
        if (t.combatantId === "") continue;
        const c = combatants.find((x) => x._id === t.combatantId);
        const r = reactionOf(t, combatants);
        const specs = c
          ? [...expandSpecs(c.effects as any), ...((r?.appliesMods ?? []) as any)]
          : [];
        const adv = effAdv(t, c ? advantageFor(specs, "save", abilityZh) : "none");
        const need = adv === "none" ? 1 : 2;
        const have = dice.filter(
          (d) => d.claimedBy === t.combatantId && d.type === "d20",
        ).length;
        claimUnclaimed("d20", Math.max(0, need - have), t.combatantId);
      }
    }
  };

  const submitManual = () => {
    cancelEffectTextSync();
    const effects = targets
      .filter((t) => t.combatantId !== "" && t.hpDelta !== 0)
      .map((t) => ({ combatantId: t.combatantId, hpDelta: t.hpDelta }));
    onConfirm(acting || null, effectText, effects);
    setEffectText("");
    setTargets([{ ...EMPTY_TARGET }]);
  };

  const submitRecipe = () => {
    if (!recipe) return;
    cancelEffectTextSync();
    const targets: RecipeTarget[] = recipeTargets
      .filter((t) => t.combatantId !== "")
      .map((t) => ({
        combatantId: t.combatantId,
        saveBonus: t.saveBonus === "" ? undefined : Number(t.saveBonus),
        forceOutcome: (t.forceOutcome || undefined) as ForceOutcome | undefined,
        forceDamage: t.forceDamage === "" ? undefined : Number(t.forceDamage),
        darts:
          recipe.multiTarget === "darts"
            ? t.darts === "" ? 0 : Number(t.darts)
            : undefined,
        reactionRecipeId: t.reactionRecipeId || undefined,
        advOverride:
          t.advOverride === "" ? undefined : (t.advOverride as Advantage),
        saveMode: t.saveMode === "" ? undefined : (t.saveMode as "hitOrMiss" | "damage"),
      }));
    if (targets.length === 0) return;
    // One entry per targets-directed appliesMods row: the checked targets
    // (all on unless unticked in the AppliedModsDirector). Self rows need none.
    const mods = recipe.appliesMods ?? [];
    const modTargets = mods
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => (m.direction ?? "targets") === "targets")
      .map(({ i }) => ({
        modIndex: i,
        combatantIds: Array.from(new Set(targets.map((t) => t.combatantId))).filter(
          (cid) => !modExcluded[modKey(i, cid)],
        ),
      }));
    onConfirmRecipe({
      actingCombatantId: acting,
      recipeId,
      attackMod: attackMod === "" ? undefined : Number(attackMod),
      damageMod: damageMod === "" ? undefined : Number(damageMod),
      damageType: damageType === "" ? undefined : damageType,
      dc: dc === "" ? undefined : Number(dc),
      actorAdvOverride: actorAdvOverride === "" ? undefined : (actorAdvOverride as Advantage),
      targets,
      modTargets: mods.length > 0 ? modTargets : undefined,
      effectText,
      spendResources: Object.entries(spend).map(([resourceId, amount]) => ({
        resourceId,
        amount,
      })),
    });
    setEffectText("");
  };

  const validTargets = recipeTargets.filter((t) => t.combatantId !== "");
  // Batch battle chained previews: fold earlier sessions' pending deltas into
  // the combatants this preview computes against (clamped, preview-only).
  const hasOffsets = Object.values(hpOffsets ?? {}).some((v) => v !== 0);
  const previewCombatants = hasOffsets
    ? combatants.map((c) => {
        const off = hpOffsets?.[c._id];
        // Can't compute HP preview when hp/ac are hidden from players.
        if (!off || c.hp === null || c.maxHp === null) return c;
        return { ...c, hp: Math.max(0, Math.min(c.maxHp, c.hp + off)) };
      })
    : combatants;
  const preview =
    recipe && actor && validTargets.length > 0
      ? computePreview(msg, recipe, actor, validTargets, previewCombatants, dice, {
          attackMod,
          damageMod,
          damageType,
          dc,
          dartTotal,
          actorAdvOverride,
          modExcluded,
        })
      : null;

  // Report this session's predicted HP deltas up (batch chained previews).
  // Manual mode predicts the drafted HP deltas; recipe mode the preview's.
  const predicted: Record<string, number> = {};
  if (recipe) {
    Object.assign(predicted, preview?.deltas ?? {});
  } else {
    for (const t of targets) {
      if (t.combatantId !== "" && t.hpDelta !== 0) {
        predicted[t.combatantId] = (predicted[t.combatantId] ?? 0) + t.hpDelta;
      }
    }
  }
  const predictedJson = JSON.stringify(predicted);
  useEffect(() => {
    onPreviewDeltas?.(JSON.parse(predictedJson));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [predictedJson]);

  return (
    <>
      {actor && hasCantAct(actor.effects as any) && (
        <p style={{ color: "#e8a33a", margin: "0.2em 0" }}>
          {msg.confirm.cantAct(actor.name)}
        </p>
      )}
      {actor && (actor.recipes?.length ?? 0) > 0 && (
        <p>
          {msg.confirm.recipe}{" "}
          <select
            value={recipeId}
            onChange={(e) => {
              const recipeId = e.target.value;
              setRecipeId(recipeId);
              const nextTargets = [emptyRecipeTarget()];
              setRecipeTargets(nextTargets);
              setDartTotal("3");
              setModExcluded({});
              // Pre-arm the recipe's linked pool (its "consumes" default);
              // the DM toggles from there — untoggle to spend nothing, arm a
              // higher slot to upcast, arm extra pools for riders.
              const next = actor?.recipes?.find((r) => r._id === recipeId);
              const nextSpend = next?.resourceId != null
                ? { [next.resourceId]: next.resourceCost || 1 }
                : {};
              setSpend(nextSpend);
              patchDraft({
                recipeId: recipeId || null,
                recipeTargets: nextTargets,
                dartTotal: "3",
                modExcluded: [],
                spendResources: Object.entries(nextSpend).map(([resourceId, amount]) => ({ resourceId, amount })),
              });
            }}
            aria-label="recipe"
          >
            <option value="">{msg.confirm.noneManualHp}</option>
            {actor.recipes?.map((r) => (
              <option key={r._id} value={r._id}>
                {r.name} ({r.hitType})
              </option>
            ))}
          </select>
        </p>
      )}

      {!recipe ? (
        // ---- Manual mode ----
        <>
          <p>
            {msg.confirm.rollLabel}<strong data-testid="roll-summary">{rollSummary || msg.confirm.noDiceClaimed}</strong>
          </p>
          <TargetsEditor targets={targets} setTargets={updateTargets} combatants={combatants} />
          <label>
            {msg.confirm.effectResult}
            <input value={effectText} onChange={(e) => updateEffectText(e.target.value)} onBlur={flushEffectText} size={40} aria-label="effect text" />
          </label>
          <p>
            <button onClick={submitManual}>{msg.common.confirm}</button>
          </p>
        </>
      ) : (
        // ---- Recipe mode ----
        <>
          <RecipeOverrides
            hitType={recipe.hitType}
            actor={actor}
            attackMod={attackMod} setAttackMod={updateAttackMod}
            actorAdvOverride={actorAdvOverride} setActorAdvOverride={updateActorAdv}
            damageMod={damageMod} setDamageMod={updateDamageMod}
            damageType={damageType} setDamageType={updateDamageType}
            dc={dc} setDc={updateDc}
            defaults={recipe}
          />
          {(recipe.extraRolls ?? []).length > 0 && (
            <p style={{ color: "#666" }} aria-label="extra rolls">
              {msg.confirm.extraRollsLabel}{(recipe.extraRolls ?? []).map((r) => extraRollSummary(r, msg)).join(", ")}
            </p>
          )}
          {actor !== null && (actor.resources?.length ?? 0) > 0 && (
            <SpendResourcesEditor
              resources={actor.resources ?? []}
              spend={spend}
              setSpend={updateSpend}
              defaultColor={actor.color}
              onUpdateResource={onUpdateResource}
            />
          )}
          <RecipeTargetsEditor
            recipe={recipe}
            targets={recipeTargets}
            setTargets={updateRecipeTargets}
            dartTotal={dartTotal}
            setDartTotal={updateDartTotal}
            combatants={combatants}
            dice={dice}
            onSetClaim={onSetClaim}
          />
          {(recipe.appliesMods ?? []).length > 0 && (
            <AppliedModsDirector
              mods={recipe.appliesMods ?? []}
              targets={validTargets}
              combatants={combatants}
              excluded={modExcluded}
              setExcluded={updateModExcluded}
            />
          )}
          <p className="wt-claim-row">
            <button className="wt-claim-dice" onClick={suggestClaims}>{msg.confirm.claimDice}</button>
            <span className="wt-roll-summary">
              {msg.confirm.rollLabel}<strong>{rollSummary || msg.confirm.noDiceClaimed}</strong>
            </span>
          </p>
          <label>
            {msg.confirm.effectResult}
            <input value={effectText} onChange={(e) => updateEffectText(e.target.value)} onBlur={flushEffectText} size={40} aria-label="effect text" />
          </label>
          {preview && (
            <p>
              <strong>{msg.confirm.previewLabel}</strong> {preview.text}
              {hasOffsets && (
                <em style={{ color: "#666" }}> {msg.confirm.previewAssumes}</em>
              )}
            </p>
          )}
          <p>
            <button onClick={submitRecipe} disabled={validTargets.length === 0}>
              {msg.confirm.confirmRecipe}
            </button>
          </p>
        </>
      )}
    </>
  );
}

/**
 * BG3-style armed pools (issue #9, pip UI per docs/DESIGN.md): tap pips to
 * arm which of the actor's resource pools this action spends when confirmed
 * — ALL armed pools tick down together (arm "L1 法術位" + "魔法飛彈奧秘",
 * cast Magic Missile, both go 2/2 → 1/2). Arming a higher slot IS the upcast
 * (no duplicated recipes); zero armed pips everywhere spends nothing (manual
 * override always wins). Armed count defaults to 1 pip (the linked pool
 * pre-arms with the recipe's cost, e.g. 聖療 cure = 5 pips).
 *
 * One `ResourceTile` per resource — slot-level resources sort ascending and
 * render first, everything else follows in existing order (no merged/shared
 * frame for any group, docs/DESIGN.md "Layout / grouping").
 */
function SpendResourcesEditor({
  resources,
  spend,
  setSpend,
  defaultColor,
  onUpdateResource,
}: {
  resources: ResourceView[];
  spend: Record<string, number>;
  setSpend: (s: Record<string, number>) => void;
  defaultColor: string;
  onUpdateResource?: ResourceHandlers["onUpdateResource"];
}) {
  const slots = resources
    .filter((r) => parseSlotLevel(r.label) !== null)
    .sort((a, b) => parseSlotLevel(a.label)! - parseSlotLevel(b.label)!);
  const others = resources.filter((r) => parseSlotLevel(r.label) === null);
  const ordered = [...slots, ...others];

  const setArmedCount = (resourceId: string, n: number) => {
    const next = { ...spend };
    if (n <= 0) delete next[resourceId];
    else next[resourceId] = n;
    setSpend(next);
  };

  return (
    <div aria-label="spend resources" style={{ display: "flex", flexWrap: "wrap", gap: "0.6em" }}>
      {ordered.map((r) => (
        <ResourceTile
          key={r._id}
          resource={r}
          armedCount={spend[r._id] ?? 0}
          onArmedCountChange={(n) => setArmedCount(r._id, n)}
          defaultColor={defaultColor}
          onUpdateResource={onUpdateResource}
        />
      ))}
    </div>
  );
}

/** Editable overrides of the recipe's default attackMod / damageMod / damageType / DC. */
function RecipeOverrides({
  hitType,
  actor,
  attackMod,
  setAttackMod,
  actorAdvOverride,
  setActorAdvOverride,
  damageMod,
  setDamageMod,
  damageType,
  setDamageType,
  dc,
  setDc,
  defaults,
}: {
  hitType: HitType;
  actor: CombatantView | null;
  attackMod: string;
  setAttackMod: (v: string) => void;
  actorAdvOverride: string;
  setActorAdvOverride: (v: string) => void;
  damageMod: string;
  setDamageMod: (v: string) => void;
  damageType: string;
  setDamageType: (v: string) => void;
  dc: string;
  setDc: (v: string) => void;
  defaults: { attackMod: number; damageMod: number; dc: number; damageType: string };
}) {
  const msg = useT();
  return (
    <p>
      {hitType === "attack" && (
        <label>
          {msg.confirm.attackMod}{" "}
          <input type="number" value={attackMod} onChange={(e) => setAttackMod(e.target.value)} style={{ width: "4em" }} placeholder={String(defaults.attackMod)} aria-label="override attack mod" />
        </label>
      )}{" "}
      {hitType === "attack" && (
        <span title={msg.confirm.actorAdvTitle}>
          {msg.confirm.actorShort}{" "}
          <AdvToggle
            scope="actor"
            value={actorAttackAdv(actorAdvOverride, actor ? advantageFor(expandSpecs(actor.effects as any), "attack") : "none")}
            manual={actorAdvOverride !== ""}
            onSet={setActorAdvOverride}
          />
        </span>
      )}{" "}
      {hitType === "save" && (
        <label>
          DC{" "}
          <input type="number" value={dc} onChange={(e) => setDc(e.target.value)} style={{ width: "4em" }} placeholder={String(defaults.dc)} aria-label="override dc" />
        </label>
      )}{" "}
      <label>
        {msg.confirm.damageMod}{" "}
        <input type="number" value={damageMod} onChange={(e) => setDamageMod(e.target.value)} style={{ width: "4em" }} placeholder={String(defaults.damageMod)} aria-label="override damage mod" />
      </label>{" "}
      <label>
        {msg.confirm.damageType}{" "}
        <select value={damageType} onChange={(e) => setDamageType(e.target.value)} aria-label="override damage type">
          <option value="">{msg.confirm.defaultOption(defaults.damageType ? damageTypeLabel(msg, defaults.damageType) : "—")}</option>
          {DAMAGE_TYPES.map((t) => (
            <option key={t} value={t}>
              {damageTypeLabel(msg, t)}
            </option>
          ))}
        </select>
      </label>{" "}
      <span style={{ color: "#666" }}>{msg.confirm.blankUsesDefault}</span>
    </p>
  );
}

/**
 * Recipe-mode target editor. Every recipe accepts multiple targets (add/remove
 * rows) — attacks resolve the same d20 against each target's own AC, saves and
 * automatics apply the same dice per target (so Mass Healing Word just adds
 * rows). Mode niceties on top (Stage B):
 * - `save`: per-target save bonus + a "claim save d20" button showing the
 *   target's claimed save die.
 * - `darts`: a total-darts input (drives "Claim dice") + per-target dart counts.
 * A target that still has their reaction gets a reaction dropdown (their own
 * recipes, e.g. Shield) — the chosen recipe's mods feed the preview and the
 * backend resolution before the outcome commits.
 */
function RecipeTargetsEditor({
  recipe,
  targets,
  setTargets,
  dartTotal,
  setDartTotal,
  combatants,
  dice,
  onSetClaim,
}: {
  recipe: { hitType: HitType; multiTarget: "none" | "aoe" | "darts"; damageType: string; saveAbility: string };
  targets: RecipeTargetDraft[];
  setTargets: (t: RecipeTargetDraft[]) => void;
  dartTotal: string;
  setDartTotal: (v: string) => void;
  combatants: CombatantView[];
  dice: DiceView[];
  onSetClaim: (dieId: string, claimedBy: string | null) => void;
}) {
  const isDarts = recipe.multiTarget === "darts";
  const isAoe = recipe.multiTarget === "aoe";
  const isHeal = recipe.damageType === "healing";
  const showSave = recipe.hitType === "save";
  const showForceOutcome = recipe.hitType === "attack" || recipe.hitType === "save";

  const msg = useT();
  const set = (i: number, patch: Partial<RecipeTargetDraft>) =>
    setTargets(targets.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  const add = () => setTargets([...targets, emptyRecipeTarget()]);
  const remove = (i: number) => setTargets(targets.filter((_, idx) => idx !== i));
  const assignedDarts = targets.reduce((s, t) => s + (Number(t.darts) || 0), 0);

  /** The target's claimed save d20s on the board (1, or 2 for adv/disadv). */
  const saveDiceOf = (combatantId: string, max: number) =>
    dice.filter((d) => d.claimedBy === combatantId && d.type === "d20").slice(0, max);
  /** The target's save state for this recipe's saveAbility: adv/disadv + auto-fail.
   *  `advantage` is the EFFECTIVE value (manual toggle wins over conditions). */
  const saveState = (t: RecipeTargetDraft) => {
    const c = combatants.find((x) => x._id === t.combatantId);
    const abilityZh = saveAbilityToZh(recipe.saveAbility);
    if (!c) {
      const advantage = effAdv(t, "none");
      return { advantage, autoFail: false, need: advantage === "none" ? 1 : 2 };
    }
    const r = reactionOf(t, combatants);
    const specs = [...expandSpecs(c.effects as any), ...((r?.appliesMods ?? []) as any)];
    const advantage = effAdv(t, advantageFor(specs, "save", abilityZh));
    const autoFail = autoFailFor(specs, "save", abilityZh);
    return { advantage, autoFail, need: advantage === "none" ? 1 : 2 };
  };
  /**
   * This target's OWN attackAgainst adv/dis — shown/edited in this row's
   * toggle in isolation from the actor's toggle (the two are combined for the
   * actual roll in computePreview/the backend, but shown separately here so
   * lighting the actor's toggle doesn't visually light every target row too).
   */
  const attackAdv = (t: RecipeTargetDraft): Advantage => {
    const c = combatants.find((x) => x._id === t.combatantId);
    if (!c) return effAdv(t, "none");
    const autoTargetAdv = advantageFor(
      [
        ...expandSpecs(c.effects as any),
        ...((reactionOf(t, combatants)?.appliesMods ?? []) as any),
      ],
      "attackAgainst",
    );
    return effAdv(t, autoTargetAdv);
  };
  const claimSaveDie = (combatantId: string, need: number) => {
    let left = need;
    for (const d of dice) {
      if (left <= 0) break;
      if (d.type === "d20" && d.claimedBy === null) {
        onSetClaim(d._id, combatantId);
        left--;
      }
    }
  };
  /** Short summary of a reaction recipe's mods, e.g. "+5 ac". Healing/tempHp
   *  rows don't fire on a reaction (the backend strips them) — not advertised. */
  const modSummary = (r: RecipeView) => {
    const mods = (r.appliesMods ?? []).filter(
      (m: ModifierSpec) => m.stat !== "healing" && m.stat !== "tempHp",
    );
    if (mods.length === 0) return "";
    const txt = mods
      .map((m: ModifierSpec) =>
        m.mode === "advantage" || m.mode === "disadvantage"
          ? `${m.mode} ${m.stat}`
          : `${m.value >= 0 ? "+" : ""}${m.value} ${m.stat}`,
      )
      .join(", ");
    return ` (${txt})`;
  };

  return (
    <div>
      <h3>
        {msg.confirm.targets}{" "}
        {isAoe && <em style={{ color: "#666" }}>{msg.confirm.aoeNote}</em>}
        {isDarts && <em style={{ color: "#666" }}>{msg.confirm.dartsNote}</em>}
      </h3>
      {isDarts && (
        <p>
          {msg.confirm.totalDarts}{" "}
          <input
            type="number"
            value={dartTotal}
            onChange={(e) => setDartTotal(e.target.value)}
            style={{ width: "4em" }}
            aria-label="total darts"
          />{" "}
          <span style={{ color: "#666" }}>
            {msg.confirm.dartsAssigned(assignedDarts, dartTotal || 0)}
          </span>
        </p>
      )}
      {targets.map((t, i) => {
        const tc = combatants.find((c) => c._id === t.combatantId);
        const ss = saveState(t);
        const saveDice = t.combatantId ? saveDiceOf(t.combatantId, ss.need) : [];
        return (
        <div key={i} style={{ marginBottom: "0.2em" }}>
          <select
            value={t.combatantId}
            onChange={(e) => set(i, { combatantId: e.target.value, reactionRecipeId: "" })}
            aria-label={`target ${i + 1}`}
          >
            <option value="">{msg.confirm.pickTarget}</option>
            {combatants.map((c) => (
              <option key={c._id} value={c._id}>{c.name}</option>
            ))}
          </select>{" "}
          {/* Darts sit ALONGSIDE the gate's fields, never instead of them: the
              dart count is this target's damage, hitType only decides whether
              it lands (#33). Editing 魔法飛彈 to save/attack keeps multi-target
              dart assignment and adds that gate's controls. */}
          {isDarts && (
            <label>
              {msg.confirm.dartsLabel}{" "}
              <input
                type="number"
                value={t.darts}
                onChange={(e) => set(i, { darts: e.target.value })}
                style={{ width: "4em" }}
                aria-label={`darts target ${i + 1}`}
              />
            </label>
          )}{" "}
          <>
              {showSave && (
                <label>
                  {saveAbilityLabel(msg, recipe.saveAbility) || "save"}{" "}
                  <input
                    type="number"
                    value={t.saveBonus}
                    onChange={(e) => set(i, { saveBonus: e.target.value })}
                    style={{ width: "3em" }}
                    aria-label={`save bonus target ${i + 1}`}
                  />
                </label>
              )}{" "}
              {showSave && ss.autoFail && (
                <em style={{ color: "#a33" }} title={msg.confirm.autoFailTitle}>
                  {msg.confirm.autoFail}
                </em>
              )}{" "}
              {showForceOutcome && (
                <AdvToggle
                  scope={`target ${i + 1}`}
                  value={showSave ? ss.advantage : attackAdv(t)}
                  manual={t.advOverride !== ""}
                  onSet={(next) => set(i, { advOverride: next })}
                />
              )}{" "}
              {showSave && (
                <select
                  value={saveModeOf(t)}
                  onChange={(e) => set(i, { saveMode: e.target.value })}
                  aria-label={`save result target ${i + 1}`}
                  title={msg.confirm.saveModeTitle}
                >
                  <option value="hitOrMiss">{msg.confirm.saveModeHitOrMiss}</option>
                  <option value="damage">{msg.confirm.saveModeDamage}</option>
                </select>
              )}{" "}
              {showSave &&
                (saveDice.length > 0 ? (
                  <span>
                    {msg.confirm.saveD20Label}<strong>{saveDice.map((d) => d.value).join(", ")}</strong>{" "}
                    <button
                      onClick={() => saveDice.forEach((d) => onSetClaim(d._id, null))}
                      title={msg.confirm.releaseSaveD20}
                      aria-label={`release save d20 target ${i + 1}`}
                    >
                      ×
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => claimSaveDie(t.combatantId, ss.need)}
                    disabled={t.combatantId === ""}
                    title={msg.confirm.claimSaveD20Title(ss.need)}
                    aria-label={`claim save d20 target ${i + 1}`}
                  >
                    {msg.confirm.claimSaveD20(ss.need)}
                  </button>
                ))}{" "}
              {showForceOutcome && (
                <select
                  value={t.forceOutcome}
                  onChange={(e) => set(i, { forceOutcome: e.target.value })}
                  aria-label={`force outcome target ${i + 1}`}
                >
                  <option value="">{msg.confirm.compute}</option>
                  {recipe.hitType === "attack" ? (
                    <>
                      <option value="hit">{msg.confirm.outcomeHit}</option>
                      <option value="miss">{msg.confirm.outcomeMiss}</option>
                    </>
                  ) : (
                    <>
                      <option value="save">{msg.confirm.outcomeSave}</option>
                      <option value="fail">{msg.confirm.outcomeFail}</option>
                    </>
                  )}
                </select>
              )}{" "}
              <label>
                {isHeal ? msg.confirm.forceHeal : msg.confirm.forceDmg}{" "}
                <input
                  type="number"
                  value={t.forceDamage}
                  onChange={(e) => set(i, { forceDamage: e.target.value })}
                  style={{ width: "4em" }}
                  placeholder="—"
                  title={isHeal ? msg.confirm.forceHealTitle : msg.confirm.forceDmgTitle}
                  aria-label={`force damage target ${i + 1}`}
                />
              </label>
          </>
          {tc && !tc.reactionUsed && (tc.recipes ?? []).length > 0 && (
            <label>
              {" "}{msg.confirm.reaction}{" "}
              <select
                value={t.reactionRecipeId}
                onChange={(e) => set(i, { reactionRecipeId: e.target.value })}
                aria-label={`reaction target ${i + 1}`}
                title={msg.confirm.reactionTitle(tc.name)}
              >
                <option value="">{msg.confirm.noneOption}</option>
                {(tc.recipes ?? []).map((r) => (
                  <option key={r._id} value={r._id}>
                    {r.name}
                    {modSummary(r)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {targets.length > 1 && (
            <button onClick={() => remove(i)} aria-label={`remove target ${i + 1}`}>
              ×
            </button>
          )}
        </div>
        );
      })}
      <p>
        <button onClick={add}>{msg.confirm.addTarget}</button>
      </p>
      {showSave && (
        <p style={{ color: "#666" }}>{msg.confirm.eachTargetClaimD20}</p>
      )}
    </div>
  );
}

/**
 * Per-target manual adv/disadv toggle. Conditions pre-set it automatically
 * (auto mode follows the live condition math); clicking 優勢/劣勢 overrides
 * THIS roll only (clicking the lit one turns it off → forced neutral); ↺
 * returns to auto. Adv/disadv consumes 2 claimed d20s (engine takes max/min).
 */
function AdvToggle({
  scope,
  value,
  manual,
  onSet,
}: {
  /** Distinguishes this toggle's aria-labels, e.g. "target 1" or "actor". */
  scope: string;
  /** The effective advantage shown (auto-computed or manual). */
  value: Advantage;
  /** True when a manual override is set (shows the ↺ back-to-auto button). */
  manual: boolean;
  /** Set the draft override: "advantage" | "disadvantage" | "none" | "" (auto). */
  onSet: (next: string) => void;
}) {
  const msg = useT();
  const click = (dir: Advantage) => onSet(value === dir ? "none" : dir);
  const btn = (dir: "advantage" | "disadvantage", label: string, color: string) => (
    <button
      onClick={() => click(dir)}
      className={value === dir ? "wt-adv-btn wt-adv-btn--on" : "wt-adv-btn"}
      aria-label={`${dir} toggle ${scope}`}
      aria-pressed={value === dir}
      title={manual ? msg.confirm.advManualTitle : msg.confirm.advAutoTitle}
      style={{ ["--adv-color" as string]: color }}
    >
      {label}
    </button>
  );
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      {btn("advantage", msg.terms.advantage, "#3a7")}
      {btn("disadvantage", msg.terms.disadvantage, "#a33")}
      {manual && (
        <button
          onClick={() => onSet("")}
          aria-label={`advantage auto ${scope}`}
          title={msg.confirm.backToAuto}
        >
          ↺
        </button>
      )}
    </span>
  );
}

/** Manual-mode multi-target HP delta editor. */
function TargetsEditor({
  targets,
  setTargets,
  combatants,
}: {
  targets: TargetDraft[];
  setTargets: (t: TargetDraft[]) => void;
  combatants: CombatantView[];
}) {
  const msg = useT();
  return (
    <div>
      <h3>{msg.confirm.targets}</h3>
      {targets.map((t, i) => (
        <div key={i}>
          <select
            value={t.combatantId}
            onChange={(e) => {
              const next = [...targets];
              next[i] = { ...t, combatantId: e.target.value };
              setTargets(next);
            }}
            aria-label="target combatant"
          >
            <option value="">{msg.confirm.pickTarget}</option>
            {combatants.map((c) => (
              <option key={c._id} value={c._id}>{c.name}</option>
            ))}
          </select>{" "}
          <input
            type="number"
            value={t.hpDelta}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isNaN(n)) {
                const next = [...targets];
                next[i] = { ...t, hpDelta: n };
                setTargets(next);
              }
            }}
            style={{ width: "5em" }}
            aria-label="hp delta"
          />{" "}
          <button onClick={() => setTargets(targets.filter((_, j) => j !== i))}>{msg.confirm.removeTarget}</button>
        </div>
      ))}
      <p>
        <button onClick={() => setTargets([...targets, { ...EMPTY_TARGET }])}>{msg.confirm.addTarget}</button>
      </p>
    </div>
  );
}

/**
 * Client-side preview of the recipe resolution (UX only; backend is
 * authoritative). Returns the summary text plus the predicted HP deltas per
 * combatant, which Batch battle chains into later sessions' previews.
 */
function computePreview(
  msg: Messages,
  recipe: RecipeView,
  actor: CombatantView,
  targets: RecipeTargetDraft[],
  combatants: CombatantView[],
  dice: DiceView[],
  overrides: {
    attackMod: string;
    damageMod: string;
    damageType: string;
    dc: string;
    dartTotal: string;
    actorAdvOverride: string;
    /** `${modIndex}:${combatantId}` → true = that applied-mod row is unchecked for that target. */
    modExcluded: Record<string, boolean>;
  },
): { text: string; deltas: Record<string, number> } {
  const deltas: Record<string, number> = {};
  const addDelta = (cid: string, d: number) => {
    if (d !== 0) deltas[cid] = (deltas[cid] ?? 0) + d;
  };
  const attackMod = overrides.attackMod === "" ? recipe.attackMod : Number(overrides.attackMod);
  const damageMod = overrides.damageMod === "" ? recipe.damageMod : Number(overrides.damageMod);
  const damageType = overrides.damageType === "" ? recipe.damageType : overrides.damageType;
  const dc = overrides.dc === "" ? recipe.dc : Number(overrides.dc);
  const fOutcome = (t: RecipeTargetDraft) => (t.forceOutcome || undefined) as ForceOutcome | undefined;
  const fDamage = (t: RecipeTargetDraft) => (t.forceDamage === "" ? null : Number(t.forceDamage));
  const tgtOf = (t: RecipeTargetDraft) => combatants.find((c) => c._id === t.combatantId);
  const rviOf = (c: CombatantView) => ({
    resist: c.resist ?? [],
    vuln: c.vuln ?? [],
    immune: c.immune ?? [],
    resistAll: hasResistAll(c.effects as any),
  });
  // Reaction-aware helpers: the target's chosen reaction (e.g. Shield) feeds
  // the preview math exactly as the backend will apply it on Confirm.
  const reactOf = (t: RecipeTargetDraft) => reactionOf(t, combatants);
  const nameOf = (c: CombatantView, t: RecipeTargetDraft) => {
    const r = reactOf(t);
    return r ? `${c.name} (${r.name}!)` : c.name;
  };
  /** The target's active specs including its chosen reaction's mods (mirrors the backend's t.specs). */
  const specsOf = (c: CombatantView, t: RecipeTargetDraft) => [
    ...expandSpecs(c.effects as any),
    ...((reactOf(t)?.appliesMods ?? []) as any),
  ];

  const actorClaims = dice.filter((d) => d.claimedBy === actor._id);
  /** Up to `max` claimed d20 values for a combatant (advantage rolls 2). */
  const d20sOf = (cid: string, max: number) =>
    dice
      .filter((d) => d.claimedBy === cid && d.type === "d20")
      .slice(0, max)
      .map((d) => d.value);
  const parts: string[] = [];

  // Darts are the DAMAGE SOURCE, not a gate (#33) — mirrors the backend:
  // allocate the actor's d4s across targets in board order, then let hitType
  // decide landing exactly as it does for any other recipe.
  const isDarts = recipe.multiTarget === "darts";
  const dartsOf = new Map<(typeof targets)[number], number[]>();
  if (isDarts) {
    const d4s = actorClaims.filter((d) => d.type === "d4").map((d) => d.value);
    let idx = 0;
    for (const t of targets) {
      if (!tgtOf(t)) continue;
      const count = Number(t.darts) || 0;
      if (count <= 0) continue;
      dartsOf.set(t, d4s.slice(idx, idx + count));
      idx += count;
    }
  }

  // Extra rolls: NOT wired into darts (see rules.ts `ExtraRoll`) — consumed
  // here (main damage dice first) so the preview matches the backend's
  // consumption order exactly. Darts draw their d4s directly (above), so they
  // take nothing from the cursor.
  const cursor = makeDiceCursor(actorClaims);
  const damageDiceValues = cursor.take(isDarts ? [] : recipe.damageDice);
  const { battleRolls, roleplayNote } = consumeExtraRolls(
    cursor,
    isDarts ? [] : (recipe.extraRolls ?? []),
  );
  for (const t of targets) {
    const c = tgtOf(t);
    if (!c) continue;
    const dartValues = dartsOf.get(t);
    if (isDarts && dartValues === undefined) continue;
    // Each dart carries the recipe's damageMod, so the mod is count × mod.
    const srcValues = dartValues ?? damageDiceValues;
    const srcMod =
      dartValues === undefined ? damageMod : dartValues.length * damageMod;
    const dartMark =
      dartValues === undefined
        ? ""
        : ` ${msg.log.dartsCount(dartValues.length)}`;
    if (recipe.hitType === "attack") {
      const actorSignals = attackSignals(
        overrides.actorAdvOverride,
        advantageSignalsFor(expandSpecs(actor.effects as any), "attack"),
      );
      const targetSignals = attackSignals(
        t.advOverride,
        advantageSignalsFor(specsOf(c, t), "attackAgainst"),
      );
      const netAdv = combineAdvSignals(actorSignals, targetSignals);
      const need = netAdv === "none" ? 1 : 2;
      const d20s = d20sOf(actor._id, need);
      if (d20s.length < need && !fOutcome(t)) {
        parts.push(`${c.name}: (need ${need} d20${need > 1 ? "s — adv/disadv" : ""})`);
        continue;
      }
      const targetAc = acWithReaction(c, reactOf(t));
      if (targetAc === null) {
        parts.push(`${c.name}: ( enemy's AC hidden )`);
        continue;
      }
      const res = resolveAttack({
        d20s, advantage: netAdv,
        attackMod: netAttackMod(attackMod, expandSpecs(actor.effects as any), specsOf(c, t)),
        targetAc, damageDiceValues: srcValues, damageMod: srcMod,
        damageType, rvi: rviOf(c), critImmune: recipe.critImmune,
        forceOutcome: fOutcome(t), forceDamage: fDamage(t),
      });
      let totalDamage = res.hit ? res.damage : 0;
      let totalHeal = 0;
      const extraNotes: string[] = [];
      if (res.hit) {
        for (const { roll, values } of battleRolls) {
          const extra = computeDamage({ diceValues: values, damageMod: roll.damageMod, crit: res.crit, damageType: roll.damageType, rvi: rviOf(c), half: false });
          // Healing riders heal the target instead of adding damage (mirrors
          // the backend's split — same hit/crit gating).
          if (roll.damageType === "healing") {
            totalHeal += extra.applied;
            extraNotes.push(`${roll.label} +${extra.applied}${msg.confirm.heal}`);
          } else {
            totalDamage += extra.applied;
            extraNotes.push(`${roll.label} +${extra.applied}`);
          }
        }
      }
      addDelta(c._id, -totalDamage);
      if (totalHeal > 0) addDelta(c._id, totalHeal);
      const mark = netAdv === "none" ? "" : ` (${netAdv === "advantage" ? "adv" : "disadv"})`;
      const extraMark = extraNotes.length > 0 ? ` [${extraNotes.join(", ")}]` : "";
      parts.push(`${nameOf(c, t)}:${mark}${dartMark} ${res.hit ? "HIT" : "MISS"}${res.crit ? " (CRIT)" : ""} → ${totalDamage}${extraMark}`);
    } else if (recipe.hitType === "save") {
      const abilityZh = saveAbilityToZh(recipe.saveAbility);
      const cardSave = abilityZh
        ? (c.saves?.find((s) => s.key === abilityZh)?.total ?? 0)
        : 0;
      const specs = specsOf(c, t);
      const saveAdv = effAdv(t, advantageFor(specs, "save", abilityZh));
      const autoFail = autoFailFor(specs, "save", abilityZh);
      const need = saveAdv === "none" ? 1 : 2;
      const saveD20s = d20sOf(c._id, need);
      if (saveD20s.length < need && !fOutcome(t)) {
        parts.push(`${c.name}: (need ${need} save d20${need > 1 ? "s — adv/disadv" : ""})`);
        continue;
      }
      const res = resolveSave({
        saveD20s, advantage: saveAdv, autoFail,
        // `specs` already includes the reaction's appliesMods (specsOf), so
        // netSaveBonus's bonus-mode sum covers a reaction's save bonus too —
        // no separate reactSaveBonus() term (that would double-count it).
        saveBonus: netSaveBonus(cardSave + (Number(t.saveBonus) || 0), specs, abilityZh),
        dc, damageDiceValues: srcValues, damageMod: srcMod,
        damageType, rvi: rviOf(c), forceOutcome: fOutcome(t), forceDamage: fDamage(t),
      });
      let totalDamage = res.damage;
      let totalHeal = 0;
      const extraNotes: string[] = [];
      for (const { roll, values } of battleRolls) {
        const extra = computeDamage({ diceValues: values, damageMod: roll.damageMod, crit: false, damageType: roll.damageType, rvi: rviOf(c), half: res.success });
        // Healing riders heal the target, never halved, and survive the
        // hitOrMiss negate below (mirrors the backend's split).
        if (roll.damageType === "healing") {
          totalHeal += extra.applied;
          extraNotes.push(`${roll.label} +${extra.applied}${msg.confirm.heal}`);
        } else {
          totalDamage += extra.applied;
          extraNotes.push(`${roll.label} +${extra.applied}`);
        }
      }
      // "hitOrMiss" saveMode: success = the Actor MISSED — no damage at all
      // (mirrors the backend; a manual force-damage still wins).
      const negate = saveModeOf(t) === "hitOrMiss";
      if (negate && res.success && fDamage(t) === null) totalDamage = 0;
      addDelta(c._id, -totalDamage);
      if (totalHeal > 0) addDelta(c._id, totalHeal);
      const mark = autoFail
        ? " (auto-fail)"
        : saveAdv === "none" ? "" : ` (${saveAdv === "advantage" ? "adv" : "disadv"})`;
      const extraMark = extraNotes.length > 0 ? ` [${extraNotes.join(", ")}]` : "";
      const outcomeWord = negate ? (res.success ? "MISS" : "HIT") : res.success ? "SAVE" : "FAIL";
      parts.push(`${nameOf(c, t)}:${mark}${dartMark} ${outcomeWord} → ${totalDamage}${extraMark}`);
    } else if (damageType === "healing") {
      if (c.hp == null || c.maxHp == null) break;
      // Healing riders fold into the heal; damage riders stay damage
      // (mirrors the backend's split).
      const healRiders = battleRolls.filter((b) => b.roll.damageType === "healing");
      const damageRiders = battleRolls.filter((b) => b.roll.damageType !== "healing");
      const healExtraDice = healRiders.flatMap((b) => b.values);
      const healExtraMod = healRiders.reduce((s, b) => s + b.roll.damageMod, 0);
      const total =
        fDamage(t) ??
        computeHeal({
          diceValues: [...srcValues, ...healExtraDice],
          healMod: srcMod + healExtraMod,
          currentHp: c.hp,
          maxHp: c.maxHp,
        }).heal;
      const newHp = Math.min(c.maxHp, c.hp + total);
      addDelta(c._id, newHp - c.hp);
      let riderDamage = 0;
      const extraNotes: string[] = [];
      for (const { roll, values } of damageRiders) {
        const extra = computeDamage({ diceValues: values, damageMod: roll.damageMod, crit: false, damageType: roll.damageType, rvi: rviOf(c), half: false });
        riderDamage += extra.applied;
        extraNotes.push(`${roll.label} ${extra.applied}`);
      }
      if (riderDamage > 0) addDelta(c._id, -riderDamage);
      const extraMark = extraNotes.length > 0 ? ` [${extraNotes.join(", ")}]` : "";
      parts.push(`${c.name}: +${newHp - c.hp}${extraMark}`);
    } else {
      const res = resolveAutomatic({
        damageDiceValues: srcValues, damageMod: srcMod, damageType, rvi: rviOf(c),
        forceDamage: fDamage(t),
      });
      let totalDamage = res.damage;
      let totalHeal = 0;
      const extraNotes: string[] = [];
      for (const { roll, values } of battleRolls) {
        const extra = computeDamage({ diceValues: values, damageMod: roll.damageMod, crit: false, damageType: roll.damageType, rvi: rviOf(c), half: false });
        if (roll.damageType === "healing") {
          totalHeal += extra.applied;
          extraNotes.push(`${roll.label} +${extra.applied}${msg.confirm.heal}`);
        } else {
          totalDamage += extra.applied;
          extraNotes.push(`${roll.label} +${extra.applied}`);
        }
      }
      addDelta(c._id, -totalDamage);
      if (totalHeal > 0) addDelta(c._id, totalHeal);
      const extraMark = extraNotes.length > 0 ? ` [${extraNotes.join(", ")}]` : "";
      parts.push(
        `${c.name}: ${dartMark === "" ? "" : `${dartMark.trim()} → `}${totalDamage} ${damageType}${extraMark}`,
      );
    }
  }
  // Applied-mods healing/tempHp rows (directed-mods request): instant, full
  // amount to each checked recipient. Healing caps at maxHp AFTER this
  // preview's damage (mirrors the backend: damage lands first, then the mods
  // section); tempHp grants a pool (no HP delta — keep-the-larger happens
  // server-side). Dice are consumed from the cursor after the extra rolls, in
  // row order — one shared pass so a tempHp row before a healing row draws
  // the same dice the backend will.
  const healParts: string[] = [];
  for (const [i, m] of (recipe.appliesMods ?? []).entries()) {
    if (m.stat !== "healing" && m.stat !== "tempHp") continue;
    const amount = cursor.take(m.dice ?? []).reduce((s, v) => s + v, 0) + m.value;
    const recipients =
      (m.direction ?? "targets") === "self"
        ? [actor]
        : targets
            .map((t) => tgtOf(t))
            .filter((c): c is CombatantView => c !== undefined)
            .filter((c) => !overrides.modExcluded[`${i}:${c._id}`]);
    const names: string[] = [];
    const seen = new Set<string>();
    for (const c of recipients) {
      if (seen.has(c._id)) continue;
      seen.add(c._id);
      if (m.stat === "tempHp") {
        names.push(c.name);
        continue;
      }
      if (c.hp == null || c.maxHp == null) continue;
      const cur = Math.max(0, Math.min(c.maxHp, c.hp + (deltas[c._id] ?? 0)));
      addDelta(c._id, Math.min(c.maxHp, cur + amount) - cur);
      names.push(c.name);
    }
    if (names.length > 0) {
      healParts.push(`+${amount}${m.stat === "tempHp" ? msg.confirm.tempGrant : ""} → ${names.join(", ")}`);
    }
  }
  const text =
    // A darts recipe with no dart assigned resolves nothing — say so instead
    // of previewing an empty action.
    (isDarts && parts.length === 0 ? msg.confirm.assignDarts : parts.join(", ")) +
    (healParts.length > 0 ? ` · heals ${healParts.join("; ")}` : "") +
    (roleplayNote ? ` · ${roleplayNote}` : "");
  return { text, deltas };
}
