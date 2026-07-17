import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import type { Mode, Stat } from "./modifiers";
import { enemyFieldsValidator } from "./enemyFields";

/**
 * Validators for the Action-recipe model (issue #7). Mirrors `DiceTerm` /
 * `HitType` from `rules.ts`. Reused by `recipes.ts` + `recipeLibrary.ts`.
 */
export const dieTypeValidator = v.union(
  v.literal("d20"),
  v.literal("d12"),
  v.literal("d10"),
  v.literal("d8"),
  v.literal("d6"),
  v.literal("d4"),
  v.literal("d100"),
);

export const diceTermValidator = v.object({
  type: dieTypeValidator,
  count: v.number(),
});

/**
 * Validator for one Modifier contribution. Mirrors `ModifierSpec` from
 * `modifiers.ts`. Duplicated as a validator here because the pure module is
 * type-only at the schema boundary (no runtime import needed).
 */
const modifierSpecValidator = v.object({
  stat: v.union(
    v.literal("ac"),
    v.literal("attack"),
    v.literal("attackAgainst"),
    v.literal("save"),
    v.literal("abilityCheck"),
    v.literal("initiative"),
    // appliesMods only: instant heal applied at Confirm (see ModifierSpec).
    v.literal("healing"),
    // appliesMods only: instant temp-HP grant applied at Confirm (see ModifierSpec).
    v.literal("tempHp"),
  ),
  mode: v.union(
    v.literal("bonus"),
    v.literal("override"),
    v.literal("advantage"),
    v.literal("disadvantage"),
    v.literal("autoFail"),
  ),
  value: v.number(),
  ability: v.optional(v.string()),
  note: v.optional(v.string()),
  // appliesMods only: recipient of this row ("targets" when absent).
  direction: v.optional(v.union(v.literal("self"), v.literal("targets"))),
  // appliesMods healing rows only: actor-claimed dice added to `value`.
  dice: v.optional(v.array(diceTermValidator)),
});

// Re-exported so convex-test / handlers can reference the runtime validators
// without redefining the union.
export { modifierSpecValidator };
export type { Mode, Stat };

export const hitTypeValidator = v.union(
  v.literal("attack"),
  v.literal("save"),
  v.literal("automatic"),
);

export const multiTargetValidator = v.union(
  v.literal("none"),
  v.literal("aoe"),
  v.literal("darts"),
);

/** Validators for a recipe's extra dice rolls (roleplay flavor or a second battle damage roll). */
export const extraRollUsageValidator = v.union(
  v.literal("roleplay"),
  v.literal("battle"),
);

export const extraRollValidator = v.object({
  label: v.string(),
  usage: extraRollUsageValidator,
  dice: v.array(diceTermValidator),
  damageMod: v.number(),
  damageType: v.string(),
});

/**
 * A Game is one instance of the Shared Board. It is identified by a public
 * `playerToken` (in the player URL) and authorized by a secret `dmToken`
 * (in the DM URL). No accounts: possession of the DM URL grants DM powers.
 *
 * `note` and `counter` are shared editable state (Slice 1's minimal sync
 * proof). `dmNote` is a DM-only field used to prove backend-enforced
 * withholding from Frontstage (ADR-0002 / PRD US6).
 */
export default defineSchema({
  games: defineTable({
    playerToken: v.string(),
    dmToken: v.string(),
    note: v.string(),
    counter: v.number(),
    dmNote: v.string(),
    round: v.number(),
    // Lite initiative pointer: which combatant's turn it is. Absent before
    // combat starts / when no combatants exist.
    currentTurnId: v.optional(v.id("combatants")),
    // Batch battle run (issue #8): an optional mode where one Batch roll serves
    // a run of consecutive turns — no batch-rerolling until the run ends.
    // `turnIds` is the queue snapshot (initiative order at start); `turnIndex`
    // points at whose Confirm is next. Absent = no run (normal flow). Bounded
    // (a run is a handful of combatants) — embedded object is fine.
    batchRun: v.optional(
      v.object({
        // A fresh identifier per run keeps prepared drafts from an older run
        // out of a later run with the same combatants. Optional because prod
        // docs written before PR #52 lack it; readers default to "legacy".
        runId: v.optional(v.string()),
        turnIds: v.array(v.id("combatants")),
        turnIndex: v.number(),
      }),
    ),
    // Map system (add-map-system / ADR-0011): which map is currently rendered on
    // the shared 地圖 board. At most one active map per Game. Optional/additive —
    // absent before any map is created, and cleared if the active map is deleted.
    // Purely a display pointer: no combat-resolution code reads it (ADR-0011).
    activeMapId: v.optional(v.id("maps")),
  }).index("byPlayerToken", ["playerToken"]),

  /**
   * Global character cards (issue #9) — 六人角色卡. NO gameId: cards persist
   * across Games and are the campaign-state source of truth for a linked PC's
   * hp/maxHp/ac and character-owned recipes/resources/effects. The CSV seed is
   * initial state + field blueprint only; after seeding, this table is
   * authoritative forever. No edit gating (friend group, open-buttons ethos).
   * Text fields are preferred over over-modeling — the card displays and edits
   * them; only combat scalars feed math.
   */
  characters: defineTable({
    // Stable seed identity (the CSV's character_id) — `seedAll` is idempotent
    // by this key. Absent on manually created cards.
    seedKey: v.optional(v.string()),
    // Playground isolation (prep-public-release / design D2). Absent = global
    // card, visible from every Game — the pre-existing behavior and the only
    // shape a non-playground deployment ever writes. Stamped with the creating
    // Game's id ONLY when the server-side `PLAYGROUND_MODE` flag is on, which
    // confines a public visitor's cards to their own Game.
    gameId: v.optional(v.id("games")),
    // Identity (card top section, in the user's 欄位 order).
    player: v.string(),
    nameZh: v.string(),
    nameEn: v.string(),
    race: v.string(),
    classesText: v.string(),
    level: v.number(),
    alignment: v.string(),
    statusText: v.string(),
    // Combat scalars (feed math / the linked combatant).
    hp: v.number(),
    maxHp: v.number(),
    // 臨時生命值 (PHB p.198): separate damage-buffer pool, NOT capped by maxHp.
    // Damage absorbs here first, overflow hits hp. Doesn't stack (grant = max of
    // old/new); healing never restores it. Optional so existing cards validate;
    // readers default to 0.
    tempHp: v.optional(v.number()),
    ac: v.number(),
    acFormula: v.string(),
    speedText: v.string(),
    // 先攻 bonus — Roll Initiative uses this for linked PCs. Auto-fills from
    // DEX mod (dndCalc) but stays editable (feat bonuses); stored so combat
    // reads a single effective value.
    initBonus: v.number(),
    pb: v.number(),
    // Six ability scores + modifiers, in display order (力量..魅力). Mods are
    // auto-synced from scores (dndCalc.modFor) but stored + editable — the DM
    // can override any value (manual-ethos); an override sticks until the score
    // changes again. Bounded (always 6).
    abilities: v.array(
      v.object({ key: v.string(), score: v.number(), mod: v.number() }),
    ),
    // Spellcasting ability (zh key 力量..魅力, or "" for none). Drives the
    // auto-calculated spellAttack / spellDc. Optional for backward compat with
    // pre-toolkit cards (treated as none).
    spellcastingAbility: v.optional(v.string()),
    // Auto-calculated spell numbers (dndCalc); stored + editable like mods.
    spellAttack: v.optional(v.number()),
    spellDc: v.optional(v.number()),
    attackText: v.string(),
    // Structured saves/skills (dndCalc auto-calc): one row per save (6) /
    // skill (18) with a proficiency flag/state + computed total. Optional —
    // migrated cards default them from the dndCalc templates on first open.
    saves: v.optional(
      v.array(
        v.object({ key: v.string(), prof: v.boolean(), total: v.number() }),
      ),
    ),
    skills: v.optional(
      v.array(
        v.object({
          key: v.string(),
          ability: v.string(),
          prof: v.union(
            v.literal("none"),
            v.literal("proficient"),
            v.literal("expertise"),
          ),
          total: v.number(),
        }),
      ),
    ),
    // Deprecated free-text proficiency notes (superseded by `saves`/`skills`).
    // Kept optional so old docs validate; the card no longer renders them.
    savesText: v.optional(v.string()),
    skillsText: v.optional(v.string()),
    toolsText: v.string(),
    goldText: v.string(),
    // Long reference sections (法術/特性/裝備/物品 …), never computed. Bounded
    // (a card has a handful of sections).
    refs: v.array(v.object({ title: v.string(), body: v.string() })),
    // Free-text homebrew/class-specific rule notes (each character deviates
    // from standard 5e differently) — plain strings, no title, never computed.
    // Optional for backward compat with pre-existing cards.
    classRules: v.optional(v.array(v.string())),
    story: v.string(),
  })
    .index("bySeedKey", ["seedKey"])
    .index("byGameId", ["gameId"]),

  /**
   * Enemy templates (issue #6): the enemy database. Global (no gameId) like
   * `characters` — templates persist across Games. Sources: the shipped gothic
   * bestiary + SRD monsters (seeded via `enemies.seedAll`, idempotent by
   * `seedKey`) and DM-entered custom/CoS entries (never shipped; local DB only).
   * Spawning copies a template into an independent `combatants` row + recipes —
   * no back-reference, so editing either side never affects the other (ADR-0002).
   *
   * The five action blocks are `v.array(v.any())`: the two seed sources use
   * different per-action shapes (bestiary: kind/to_hit/damage/on_hit/save/dc/
   * on_fail/on_success/…; SRD: attack_bonus/damage[]/desc; multiattack/legendary
   * add attacks/cost/trigger), and the acceptance criterion is lossless schema
   * preservation. Bounded (a stat block has a handful of actions). `spawn`
   * reads only the fields it knows; everything else is DM reference text.
   */
  enemies: defineTable({
    seedKey: v.optional(v.string()),
    source: v.union(v.literal("seed"), v.literal("srd"), v.literal("custom")),
    nameZh: v.string(),
    nameEn: v.string(),
    // Flavor/reference (bestiary columns; SRD maps what it has, "" otherwise).
    symbol: v.string(),
    role: v.string(),
    themeTags: v.string(),
    size: v.string(),
    creatureType: v.string(),
    temperament: v.string(),
    threatTier: v.number(),
    // Combat scalars.
    ac: v.number(),
    hpMax: v.number(),
    hpFormula: v.string(),
    speedText: v.string(),
    // Six ability scores + mods, zh keys (力量..魅力), same shape as characters.
    abilities: v.array(
      v.object({ key: v.string(), score: v.number(), mod: v.number() }),
    ),
    // Per-ability save bonuses (zh keys) + skill bonuses (source keys as-is).
    saveBonuses: v.array(v.object({ key: v.string(), bonus: v.number() })),
    skills: v.array(v.object({ key: v.string(), bonus: v.number() })),
    senses: v.string(),
    passivePerception: v.number(),
    languages: v.string(),
    // Damage/condition modifier text ("," / "、" separated); spawn splits these
    // into the combatant's resist/vuln/immune lists.
    damageResistances: v.string(),
    damageVulnerabilities: v.string(),
    damageImmunities: v.string(),
    conditionImmunities: v.string(),
    // Schema-preserving action blocks (see doc comment above).
    traits: v.array(v.any()),
    actions: v.array(v.any()),
    bonusActions: v.array(v.any()),
    reactions: v.array(v.any()),
    legendaryActions: v.array(v.any()),
    // DM reference text.
    tactics: v.string(),
    encounterNotes: v.string(),
  }).index("bySeedKey", ["seedKey"]),

  combatants: defineTable({
    gameId: v.id("games"),
    name: v.string(),
    kind: v.union(
      v.literal("pc"),
      v.literal("npc"),
      v.literal("enemy"),
    ),
    // Live link to a global character card (issue #9). When set, hp/maxHp/ac
    // live ON the character (this row's copies are the join-time snapshot,
    // ignored by readers); recipes/resources/effects are character-owned.
    // Absent = plain combatant (enemies/NPCs), everything combatant-owned.
    characterId: v.optional(v.id("characters")),
    // Hex color used as the Claiming identity on the Dice Board. Auto-assigned
    // on combat entry; DM may override.
    color: v.string(),
    hp: v.number(),
    maxHp: v.number(),
    // 臨時生命值 (PHB p.198): separate damage buffer, not capped by maxHp. Lives
    // on the stat carrier (linked PC → character card). Optional for backward
    // compat with pre-existing combatants; readers default to 0.
    tempHp: v.optional(v.number()),
    ac: v.number(),
    initiative: v.number(),
    notes: v.string(),
    // DM-only field; withheld from Frontstage by the backend.
    dmNotes: v.string(),
    alive: v.boolean(),
    // Overrideable action-economy reminders (nudge, never enforce).
    actionUsed: v.boolean(),
    bonusUsed: v.boolean(),
    reactionUsed: v.boolean(),
    // Damage-type modifiers (issue #7): lists of damage-type names. The engine
    // applies these at Confirm (resist halves, vuln doubles, immune negates).
    // Bounded lists (a handful of types) — array on the doc is fine. Optional so
    // existing combatants (pre-#7) validate; readers default to [].
    resist: v.optional(v.array(v.string())),
    vuln: v.optional(v.array(v.string())),
    immune: v.optional(v.array(v.string())),
    // Curated-condition immunities (keys into modifiers.CONDITIONS), derived
    // from the stat block's 狀態免疫 text. Drives a non-blocking ⚠ warn when
    // an immune condition is applied — never a gatekeeper (ADR-0002).
    conditionImmune: v.optional(v.array(v.string())),
    // Per-instance enemy stat-block snapshot (the full 敵人庫 field set),
    // deep-copied at spawn — no back-reference to the template (ADR-0002) —
    // and editable from the on-field enemy editor window. DM-only in the
    // projection (Backstage secret). Absent on PCs, NPCs, hand-added enemies,
    // and instances spawned before this field existed.
    statBlock: v.optional(v.object(enemyFieldsValidator)),
    // Insertion order for stable display when initiatives tie.
    order: v.number(),
  })
    .index("byGame", ["gameId"])
    .index("byCharacter", ["characterId"]),

  /**
   * The Dice Board: a grid of pre-rolled dice grouped by type, shared across
   * all combatants and refreshed by a Batch roll. One row per die. A die is
   * "claimed" by a combatant (their Color) via `claimedBy`; claimed dice of a
   * type are that combatant's roll for the pending action (Slice 3 / PRD
   * US14–US18). High-churn during a turn, so it lives in its own table rather
   * than embedded on the game (Convex: no unbounded arrays on a doc).
   */
  dice: defineTable({
    gameId: v.id("games"),
    type: v.union(
      v.literal("d20"),
      v.literal("d12"),
      v.literal("d10"),
      v.literal("d8"),
      v.literal("d6"),
      v.literal("d4"),
      v.literal("d100"),
    ),
    // Rolled face, 1..sides.
    value: v.number(),
    // Stable position within type for deterministic rendering.
    order: v.number(),
    // Which combatant has claimed this die (null = unclaimed).
    claimedBy: v.optional(v.id("combatants")),
  })
    .index("byGame", ["gameId"])
    .index("byGameAndType", ["gameId", "type"]),

  /**
   * High-churn, unconfirmed combat action state. Kept outside `games` so
   * typing in Battle does not contend with metadata/initiative updates or
   * invalidate unrelated subscriptions. `slotKey` is `normal` or a run-scoped
   * Batch actor key; one row represents one collaborative action draft.
   */
  battleDrafts: defineTable({
    gameId: v.id("games"),
    slotKey: v.string(),
    scope: v.union(v.literal("normal"), v.literal("batch")),
    actorId: v.optional(v.id("combatants")),
    runId: v.optional(v.string()),
    recipeId: v.optional(v.id("recipes")),
    attackMod: v.string(),
    actorAdvOverride: v.string(),
    damageMod: v.string(),
    damageType: v.string(),
    dc: v.string(),
    dartTotal: v.string(),
    effectText: v.string(),
    manualTargets: v.array(
      v.object({ combatantId: v.optional(v.id("combatants")), hpDelta: v.number() }),
    ),
    recipeTargets: v.array(
      v.object({
        combatantId: v.optional(v.id("combatants")),
        saveBonus: v.string(),
        forceOutcome: v.string(),
        forceDamage: v.string(),
        darts: v.string(),
        reactionRecipeId: v.optional(v.id("recipes")),
        advOverride: v.string(),
        saveMode: v.string(),
      }),
    ),
    spendResources: v.array(v.object({ resourceId: v.id("resources"), amount: v.number() })),
    modExcluded: v.array(v.string()),
    updatedAt: v.number(),
  })
    .index("byGame", ["gameId"])
    .index("byGameAndSlotKey", ["gameId", "slotKey"]),

  /**
   * Append-only combat log: one entry per Confirm, recording who acted, the
   * roll summary, and the effects applied (PRD US48). Append-only — rows are
   * only inserted, never edited or deleted. Snapshots (actingName, per-target
   * name) keep the log readable even if a combatant is later removed.
   *
   * `event` (i18n change): the same resolution as STRUCTURED data — the client
   * renders it in the viewer's language. Dual-write: `rollSummary` keeps being
   * written (skew-safe fallback + the only render path for pre-event rows).
   * One flexible object rather than a per-kind v.union: the fields are mostly
   * shared across kinds and the confirm engine is the only writer, so a strict
   * union would add validator bulk without extra safety.
   */
  combatLog: defineTable({
    gameId: v.id("games"),
    round: v.number(),
    // Who acted; absent for a DM-forced action with no combatant.
    actingCombatantId: v.optional(v.id("combatants")),
    actingName: v.string(),
    // e.g. "d20: 14 · 3d6: 4+2+5 = 11". Empty when no dice were claimed.
    rollSummary: v.string(),
    // Free-text result / effect note entered by the actor.
    effectText: v.string(),
    // Bounded (a few targets per Confirm) — array is fine.
    effects: v.array(
      v.object({
        combatantId: v.id("combatants"),
        name: v.string(),
        // Negative = damage, positive = healing.
        hpDelta: v.number(),
      }),
    ),
    // Structured event for client-side localized rendering. Absent on legacy
    // rows (they render via rollSummary). Player-entered text (names, recipe
    // names, extra-roll labels) is embedded verbatim; damageType/saveAbility
    // are canonical English keys the client localizes.
    event: v.optional(
      v.object({
        kind: v.union(
          v.literal("attack"),
          v.literal("save"),
          v.literal("auto"),
          v.literal("heal"),
          v.literal("darts"),
          v.literal("manual"),
        ),
        recipeName: v.optional(v.string()),
        dc: v.optional(v.number()),
        // Canonical lowercase English ("dex") as stored on the recipe.
        saveAbility: v.optional(v.string()),
        roleplayNote: v.optional(v.string()),
        // Manual mode: the acting combatant's claimed dice, for dice-notation display.
        claimedDice: v.optional(
          v.array(v.object({ type: v.string(), value: v.number() })),
        ),
        targets: v.array(
          v.object({
            name: v.string(),
            reactionName: v.optional(v.string()),
            adv: v.optional(
              v.union(v.literal("advantage"), v.literal("disadvantage")),
            ),
            autoFail: v.optional(v.boolean()),
            // DM override was in play (forceOutcome and/or forceDamage).
            forced: v.optional(v.boolean()),
            hit: v.optional(v.boolean()),
            crit: v.optional(v.boolean()),
            saveSuccess: v.optional(v.boolean()),
            saveMode: v.optional(
              v.union(v.literal("hitOrMiss"), v.literal("damage")),
            ),
            damage: v.optional(v.number()),
            // Canonical English damage-type key.
            damageType: v.optional(v.string()),
            heal: v.optional(v.number()),
            darts: v.optional(v.number()),
            extras: v.optional(
              v.array(
                v.object({
                  label: v.string(),
                  amount: v.number(),
                  isHeal: v.boolean(),
                }),
              ),
            ),
          }),
        ),
        // Applied-mods chips granted by this Confirm (recipe mode).
        grants: v.optional(
          v.array(
            v.object({
              to: v.string(),
              mods: v.array(
                v.object({
                  mode: v.string(),
                  stat: v.string(),
                  value: v.number(),
                }),
              ),
            }),
          ),
        ),
        // Instant healing / temp-HP rows applied by this Confirm.
        heals: v.optional(
          v.array(
            v.object({
              amount: v.number(),
              tempHp: v.boolean(),
              to: v.array(v.string()),
            }),
          ),
        ),
        // Resources spent at Confirm.
        spent: v.optional(
          v.array(v.object({ label: v.string(), amount: v.number() })),
        ),
      }),
    ),
    // _creationTime (auto) serves as the append timestamp.
  }).index("byGame", ["gameId"]),

  /**
   * Active effects (Conditions + custom Modifiers) on a combatant. One row per
   * effect: a curated Condition carries its bundled specs; a custom Modifier
   * carries a single spec. `active` is the toggle — inactive effects contribute
   * nothing to the Effective stat, so toggling off reverts without mutating the
   * base (issue #5 / ADR-0002). High-churn and unbounded over a fight, so it's
   * a child table (not an embedded array). Deleted with its combatant.
   *
   * Dual ownership (issue #9): a row belongs EITHER to a combatant
   * (gameId+combatantId, deleted with it) OR to a global character
   * (characterId only — persists across Games; NOT deleted with a combatant).
   */
  effects: defineTable({
    gameId: v.optional(v.id("games")),
    combatantId: v.optional(v.id("combatants")),
    characterId: v.optional(v.id("characters")),
    type: v.union(v.literal("condition"), v.literal("custom")),
    // Present iff type === "condition" — the curated condition key.
    conditionKey: v.optional(v.string()),
    label: v.string(),
    // Bounded (a condition bundles a few specs; a custom modifier is one) —
    // array is fine.
    specs: v.array(modifierSpecValidator),
    active: v.boolean(),
  })
    .index("byGame", ["gameId"])
    .index("byCombatant", ["combatantId"])
    .index("byCharacter", ["characterId"]),

  /**
   * Action recipes (issue #7 / PRD US22–US24): a combatant's known actions.
   * Defines hit type (attack/save/automatic), the dice to Claim, a manual
   * modifier (DM-entered, never auto-derived), damage type, save DC, crit
   * immunity, optional Resource consumption, and a multi-target mode (Stage B).
   * Child table; deleted with its combatant.
   *
   * Dual ownership (issue #9): combatant-owned (gameId+combatantId) OR
   * character-owned (characterId only — persists across Games).
   */
  recipes: defineTable({
    gameId: v.optional(v.id("games")),
    combatantId: v.optional(v.id("combatants")),
    characterId: v.optional(v.id("characters")),
    name: v.string(),
    hitType: hitTypeValidator,
    // To-hit modifier (attack recipes).
    attackMod: v.number(),
    // Dice to Claim for damage/heal, e.g. [{type:"d6",count:2}] = 2d6.
    damageDice: v.array(diceTermValidator),
    damageMod: v.number(),
    // "slashing" / "fire" / "healing" / "force" / …
    damageType: v.string(),
    // Save DC + ability (save recipes; ability is informational).
    dc: v.number(),
    saveAbility: v.string(),
    // Magic Missile / automatic effects that never crit. (Saves never crit by rule.)
    critImmune: v.boolean(),
    // Optional Resource pool to consume on Confirm (healing/spells).
    resourceId: v.optional(v.id("resources")),
    resourceCost: v.number(),
    // Stage B: "aoe" / "darts". Stage A uses "none".
    multiTarget: multiTargetValidator,
    // Modifier specs the recipe APPLIES to its target on Confirm (issue #7):
    // non-damage buffs like Shield (+5 AC) or True Strike (adv. attack). Reuses
    // the #5 Modifier model; on Confirm these insert as one toggleable `effects`
    // row on the target (revertible; v1 manual expiry via the spec `note`).
    // Optional so existing recipe docs validate; readers default to [].
    appliesMods: v.optional(v.array(modifierSpecValidator)),
    // Extra dice rolls beyond the main roll: roleplay flavor dice (claimed +
    // logged, no math) or a second battle damage roll (own dice/mod/type,
    // added to the target's damage on the same hit/save result). Optional so
    // existing recipe docs validate; readers default to [].
    extraRolls: v.optional(v.array(extraRollValidator)),
  })
    .index("byGame", ["gameId"])
    .index("byCombatant", ["combatantId"])
    .index("byCharacter", ["characterId"]),

  /**
   * Resources (issue #7 minimal; expanded + seeded in #9 character editor):
   * per-combatant pools with current/max — spell slots, Lay on Hands, etc.
   * Consumed by recipes at Confirm; restoration is manual in v1 (DM edits
   * current/max; no rest automation). Child table; deleted with its combatant.
   *
   * Dual ownership (issue #9): combatant-owned (gameId+combatantId) OR
   * character-owned (characterId only — persists across Games).
   */
  resources: defineTable({
    gameId: v.optional(v.id("games")),
    combatantId: v.optional(v.id("combatants")),
    characterId: v.optional(v.id("characters")),
    label: v.string(),
    current: v.number(),
    max: v.number(),
    // BG3-style pip UI (resource-pips-build-plan): per-resource overrides,
    // both optional — undefined icon = plain square, undefined color = the
    // owning combatant's identity color.
    icon: v.optional(v.string()),
    color: v.optional(v.string()),
  })
    .index("byGame", ["gameId"])
    .index("byCombatant", ["combatantId"])
    .index("byCharacter", ["characterId"]),

  /**
   * Map system (add-map-system / ADR-0011). A DM-managed image + derived grid,
   * scoped to one Game. `cols`/`rows` are stored as plain integers derived
   * client-side from the uploaded image's aspect ratio (an aspect-ratio-
   * preserving step slider — the server never computes grid dimensions).
   * `imageStorageId` is Convex file storage (first use of `ctx.storage` in this
   * codebase). Purely visual reference: no combat-resolution code reads it.
   */
  maps: defineTable({
    gameId: v.id("games"),
    name: v.string(),
    imageStorageId: v.id("_storage"),
    cols: v.number(),
    rows: v.number(),
    // The uploaded image's natural pixel dimensions, recorded at creation so the
    // re-grid editor can offer the same aspect-faithful density ladder creation
    // did (instead of re-deriving from the rounded cols/rows, which drifts the
    // ratio on odd-ratio maps). Optional/additive — legacy maps fall back to the
    // cols/rows-derived ladder.
    imageWidth: v.optional(v.number()),
    imageHeight: v.optional(v.number()),
  }).index("byGame", ["gameId"]),

  /**
   * Chess pieces (add-map-system / ADR-0011): visual tokens on the map board,
   * DECOUPLED from `combatants` — a piece can exist whether or not its subject
   * is in combat, and vice versa. Snapshot-at-creation (ADR-0005 pattern): a
   * character/enemy-linked piece copies name/color/portrait once; editing the
   * source later never moves or changes the piece (no live link).
   *
   * `location` is a discriminated union so impossible states (on a map with no
   * coordinates, or "nowhere") are unrepresentable: a piece is EITHER on a
   * specific map's board (grid row/col) OR in the one global backstage (free
   * x/y percentages). Indexed by `byGame` only — piece counts per Game are
   * small (a handful), board-vs-backstage split happens in memory, so no index
   * on the union subfield is needed (resolves tasks.md 1.3's open question).
   *
   * Position is display data ONLY — never read by combatLog.ts / modifiers.ts /
   * the Confirm engine (ADR-0011, the load-bearing non-spatial boundary).
   */
  pieces: defineTable({
    gameId: v.id("games"),
    label: v.string(),
    color: v.string(),
    portraitStorageId: v.optional(v.id("_storage")),
    sourceType: v.union(
      v.literal("character"),
      v.literal("enemy"),
      v.literal("none"),
    ),
    location: v.union(
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
    ),
  }).index("byGame", ["gameId"]),

  /**
   * Flavor dice (add-map-system): a shared/synced non-combat mini dice board —
   * exactly one row per die type (d20/d12/d10/d8/d6/d4 + d100 percentile) per
   * Game, for out-of-combat rolls (a Perception check) that still need table-
   * wide auditability. Structurally distinct from the combat `dice` table
   * (ADR-0007): no `claimedBy`, no batch semantics, one row per type. Kept a
   * separate table so "never read by combatLog.ts" stays trivially auditable —
   * this board must never become a second path into the Confirm engine.
   */
  flavorDice: defineTable({
    gameId: v.id("games"),
    type: v.union(
      v.literal("d20"),
      v.literal("d12"),
      v.literal("d10"),
      v.literal("d8"),
      v.literal("d6"),
      v.literal("d4"),
      v.literal("d100"),
    ),
    // undefined = not yet rolled.
    value: v.optional(v.number()),
  }).index("byGame", ["gameId"]),
});
