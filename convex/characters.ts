import {
  queryGeneric as query,
  mutationGeneric as mutation,
} from "convex/server";
import { ConvexError, v } from "convex/values";
import { resolveGame } from "./games";
import { pickNextColor } from "./colors";
import { resolveCombatant } from "./combatants";
import { childBelongsTo, childOwner } from "./ownership";
import { DEMO_SEED } from "./demoSeed";
import {
  assertCardWritable,
  CARD_ERROR,
  isPlaygroundMode,
  validateCardSize,
} from "./cardGuards";
import type { HitType, Recipe } from "./rules";
import type { ModifierSpec } from "./modifiers";
import type { EffectView } from "./effects";
import type { RecipeView } from "./recipes";
import type { ResourceView } from "./resources";

/**
 * Global character cards (issue #9) — 六人角色卡. Cards live OUTSIDE any Game
 * and persist across them: hp/maxHp/ac, resources, recipes, and conditions on
 * a linked PC are campaign state (lingering curses are a feature, per the
 * grilling record). No edit gating — any valid game token may read/write any
 * card (friend group, open-buttons ethos); the token only proves the caller
 * holds a game URL.
 *
 * The card UI edits as a draft with one Save sending only dirty fields, so
 * `update` has PATCH semantics: absent fields are left untouched and can never
 * clobber concurrent combat writes.
 */

/** One ability score + modifier (mod auto-synced from score, stored + editable). */
export type AbilityView = { key: string; score: number; mod: number };

/** One long-form reference section (法術/特性/裝備 … — displayed, never computed). */
export type RefSection = { title: string; body: string };

/** Skill proficiency state (none / proficient / expertise = 2×PB). */
export type SkillProf = "none" | "proficient" | "expertise";

/** One save row (auto-calc: total = ability mod + (prof ? pb : 0)). */
export type SaveView = { key: string; prof: boolean; total: number };

/** One skill row (auto-calc: total = governing mod + prof bonus). */
export type SkillView = {
  key: string;
  ability: string;
  prof: SkillProf;
  total: number;
};

/** A character card as projected to any role (no DM-only fields on cards). */
/** One structured class row (character-builder). `classesText` is derived from
 * this for display; a card without `classes` renders `classesText` (legacy). */
export type ClassEntry = {
  classId: string;
  classNameZh?: string;
  subclassId?: string;
  subclassNameZh?: string;
  level: number;
  active: boolean;
};

export type CharacterView = {
  _id: string;
  _creationTime: number;
  seedKey: string | null;
  player: string;
  nameZh: string;
  nameEn: string;
  race: string;
  classesText: string;
  /** Structured class list (character-builder); absent on migrated/old cards
   * (they render `classesText`). Multiclass combination math is out of scope. */
  classes?: ClassEntry[];
  level: number;
  alignment: string;
  statusText: string;
  hp: number;
  maxHp: number;
  /** 臨時生命值 (PHB p.198): a separate damage buffer, NOT capped by maxHp.
   * Combat write-through puts it on the card, so the card must carry it —
   * without this the value is writable but not readable or exportable. */
  tempHp: number;
  ac: number;
  acFormula: string;
  speedText: string;
  initBonus: number;
  pb: number;
  abilities: AbilityView[];
  spellcastingAbility: string; // "" = none
  spellAttack: number;
  spellDc: number;
  /** Optional so cards predating the field (or a migrated card) arrive as
   *  `undefined` — the card window then auto-derives it from the Perception
   *  skill total. Defaulting to 10 here would mask that derivation (10 is
   *  non-nullish, so the snapshot's `?? passiveDefault` would never fire and
   *  every existing card would show 10 until a manual 重算). */
  passivePerception?: number;
  attackText: string;
  saves: SaveView[];
  skills: SkillView[];
  /** @deprecated superseded by `saves` (structured). Kept for old docs. */
  savesText?: string;
  /** @deprecated superseded by `skills` (structured). Kept for old docs. */
  skillsText?: string;
  toolsText: string;
  /** Structured proficiency categories (character-builder); absent on migrated/
   * old cards, which render `toolsText` verbatim as a fallback. */
  armorProfs?: string[];
  weaponProfs?: string[];
  toolProfs?: string[];
  languageProfs?: string[];
  goldText: string;
  refs: RefSection[];
  /** Free-text homebrew/class-specific rule notes — plain strings, no title. */
  classRules: string[];
  story: string;
  // Character-owned Resources + Recipes (issue #9 step 4): the card window's
  // embedded sheet reads these directly, so a card can be viewed/edited even
  // when not in battle. Same rows also project onto a linked combatant in
  // getCombatants — duplicate by design, canonical owner is the character.
  resources: ResourceView[];
  recipes: RecipeView[];
  /** Character-owned Conditions/Modifiers. A curse applied to a linked PC is
   * stamped onto the CARD (ownership.childOwner) and outlives the Game — the
   * schema calls that a feature, so an export that dropped these would quietly
   * cure the party on restore. */
  effects: EffectView[];
};

const abilityValidator = v.object({
  key: v.string(),
  score: v.number(),
  mod: v.number(),
});

const refValidator = v.object({ title: v.string(), body: v.string() });

/** One structured class row (character-builder; mirrors the schema). */
const classEntryValidator = v.object({
  classId: v.string(),
  classNameZh: v.optional(v.string()),
  subclassId: v.optional(v.string()),
  subclassNameZh: v.optional(v.string()),
  level: v.number(),
  active: v.boolean(),
});

const saveValidator = v.object({
  key: v.string(),
  prof: v.boolean(),
  total: v.number(),
});

const skillValidator = v.object({
  key: v.string(),
  ability: v.string(),
  prof: v.union(
    v.literal("none"),
    v.literal("proficient"),
    v.literal("expertise"),
  ),
  total: v.number(),
});

/** Full card fields (create). `seedKey` is reserved for the seed pipeline.
 * Structured spell/saves/skills fields are optional — the card builds them
 * from the dndCalc templates on first open if absent (migrated / manual cards). */
const characterFieldsValidator = v.object({
  player: v.string(),
  nameZh: v.string(),
  nameEn: v.string(),
  race: v.string(),
  classesText: v.string(),
  classes: v.optional(v.array(classEntryValidator)),
  level: v.number(),
  alignment: v.string(),
  statusText: v.string(),
  hp: v.number(),
  maxHp: v.number(),
  tempHp: v.optional(v.number()),
  ac: v.number(),
  acFormula: v.string(),
  speedText: v.string(),
  initBonus: v.number(),
  pb: v.number(),
  abilities: v.array(abilityValidator),
  spellcastingAbility: v.optional(v.string()),
  spellAttack: v.optional(v.number()),
  spellDc: v.optional(v.number()),
  passivePerception: v.optional(v.number()),
  attackText: v.string(),
  saves: v.optional(v.array(saveValidator)),
  skills: v.optional(v.array(skillValidator)),
  savesText: v.optional(v.string()),
  skillsText: v.optional(v.string()),
  toolsText: v.string(),
  armorProfs: v.optional(v.array(v.string())),
  weaponProfs: v.optional(v.array(v.string())),
  toolProfs: v.optional(v.array(v.string())),
  languageProfs: v.optional(v.array(v.string())),
  goldText: v.string(),
  refs: v.array(refValidator),
  classRules: v.optional(v.array(v.string())),
  story: v.string(),
});

/** PATCH validator: every card field optional (dirty-fields-only Save). */
const characterPatchValidator = v.object({
  player: v.optional(v.string()),
  nameZh: v.optional(v.string()),
  nameEn: v.optional(v.string()),
  race: v.optional(v.string()),
  classesText: v.optional(v.string()),
  classes: v.optional(v.array(classEntryValidator)),
  level: v.optional(v.number()),
  alignment: v.optional(v.string()),
  statusText: v.optional(v.string()),
  hp: v.optional(v.number()),
  maxHp: v.optional(v.number()),
  tempHp: v.optional(v.number()),
  ac: v.optional(v.number()),
  acFormula: v.optional(v.string()),
  speedText: v.optional(v.string()),
  initBonus: v.optional(v.number()),
  pb: v.optional(v.number()),
  abilities: v.optional(v.array(abilityValidator)),
  spellcastingAbility: v.optional(v.string()),
  spellAttack: v.optional(v.number()),
  spellDc: v.optional(v.number()),
  passivePerception: v.optional(v.number()),
  attackText: v.optional(v.string()),
  saves: v.optional(v.array(saveValidator)),
  skills: v.optional(v.array(skillValidator)),
  savesText: v.optional(v.string()),
  skillsText: v.optional(v.string()),
  toolsText: v.optional(v.string()),
  armorProfs: v.optional(v.array(v.string())),
  weaponProfs: v.optional(v.array(v.string())),
  toolProfs: v.optional(v.array(v.string())),
  languageProfs: v.optional(v.array(v.string())),
  goldText: v.optional(v.string()),
  refs: v.optional(v.array(refValidator)),
  classRules: v.optional(v.array(v.string())),
  story: v.optional(v.string()),
});

/**
 * Project a character doc to its view. `resources`/`recipes` default to empty
 * — `list` attaches the character-owned kids after mapping (mirroring the join
 * getCombatants does for linked combatants).
 */
export function toCharacterView(
  c: any,
  kids?: {
    resources?: ResourceView[];
    recipes?: RecipeView[];
    effects?: EffectView[];
  },
): CharacterView {
  return {
    _id: c._id,
    _creationTime: c._creationTime,
    seedKey: c.seedKey ?? null,
    player: c.player,
    nameZh: c.nameZh,
    nameEn: c.nameEn,
    race: c.race,
    classesText: c.classesText,
    classes: c.classes,
    level: c.level,
    alignment: c.alignment,
    statusText: c.statusText,
    hp: c.hp,
    maxHp: c.maxHp,
    tempHp: c.tempHp ?? 0,
    ac: c.ac,
    acFormula: c.acFormula,
    speedText: c.speedText,
    initBonus: c.initBonus,
    pb: c.pb,
    abilities: c.abilities,
    spellcastingAbility: c.spellcastingAbility ?? "",
    spellAttack: c.spellAttack ?? 0,
    spellDc: c.spellDc ?? 0,
    // Pass through undefined when absent (see CharacterView.passivePerception) —
    // the card window derives from skills. Do NOT default to 10 here.
    passivePerception: c.passivePerception,
    attackText: c.attackText,
    // Migrated / manual cards may lack structured saves/skills — default to
    // empty; the card window builds them from the dndCalc templates on open.
    saves: c.saves ?? [],
    skills: c.skills ?? [],
    savesText: c.savesText,
    skillsText: c.skillsText,
    toolsText: c.toolsText,
    armorProfs: c.armorProfs,
    weaponProfs: c.weaponProfs,
    toolProfs: c.toolProfs,
    languageProfs: c.languageProfs,
    goldText: c.goldText,
    refs: c.refs,
    classRules: c.classRules ?? [],
    story: c.story,
    resources: kids?.resources ?? [],
    recipes: kids?.recipes ?? [],
    effects: kids?.effects ?? [],
  };
}

/** A card's editable fields (everything but identity/system columns + the
 * child rows, which are owned separately as recipes/resources/effects).
 * `tempHp` is optional here: it is combat state that a seed or an imported
 * file may simply not mention, and readers default it to 0. */
export type CharacterFields = Omit<
  CharacterView,
  | "_id"
  | "_creationTime"
  | "seedKey"
  | "resources"
  | "recipes"
  | "effects"
  | "tempHp"
> & { tempHp?: number };

/**
 * A dirty-fields-only card Save payload (issue #9 step 4). Matches
 * `characterPatchValidator` exactly — resources/recipes are NOT here (they're
 * the combat surface, edited write-through, not draft-gated).
 */
export type CharacterCardPatch = Partial<
  Omit<CharacterFields, "resources" | "recipes">
>;

/** One seeded resource pool. `key` is referenced by SeedRecipe.resourceKey. */
export type SeedResource = {
  key: string;
  label: string;
  current: number;
  max: number;
};

/** One seeded recipe; `resourceKey` is resolved to a real id at insert time. */
export type SeedRecipe = {
  name: string;
  hitType: HitType;
  attackMod: number;
  damageDice: Recipe["damageDice"];
  damageMod: number;
  damageType: string;
  dc: number;
  saveAbility: string;
  critImmune: boolean;
  resourceKey?: string;
  resourceCost: number;
  multiTarget: Recipe["multiTarget"];
  appliesMods: ModifierSpec[];
};

/** One character in a seed module (convex/demoSeed.ts). */
export type SeedCharacter = {
  seedKey: string;
  fields: CharacterFields;
  resources: SeedResource[];
  recipes: SeedRecipe[];
};

/**
 * Resolve a character by id after validating the caller holds a game token.
 * Cards are global — any valid token grants access (no gating).
 */
export async function resolveCharacter(
  db: any,
  playerToken: string,
  characterId: string,
): Promise<any> {
  await resolveGame(db, playerToken);
  const character = await db.get(characterId);
  if (character === null) {
    throw new Error("Character not found");
  }
  return character;
}

/** Resolve an existing child row by id, authorizing via its owner. */
export async function resolveChild(
  db: any,
  playerToken: string,
  childId: string,
  label: "Recipe" | "Resource",
): Promise<any> {
  const row = await db.get(childId);
  if (row === null) {
    throw new Error(`${label} not found`);
  }
  if (row.combatantId !== undefined) {
    // Combatant-owned: its combatant must belong to the token's game.
    await resolveCombatant(db, playerToken, row.combatantId);
  } else {
    // Character-owned: cards are global — any valid game token grants access.
    await resolveGame(db, playerToken);
  }
  return row;
}

/**
 * A resolved child-row owner (issue #9): recipes/resources are added EITHER
 * via a combatant (a linked PC redirects onto its character) OR via a
 * character directly (the card window, no combatant in play). `fields` are
 * the owner columns to stamp on the new row.
 */
export type ChildOwnerRef = {
  fields: { gameId?: string; combatantId?: string; characterId?: string };
  combatant: any | null;
  characterId: string | null;
};

/** Resolve the owner for a child-row mutation. Exactly one id must be given. */
export async function resolveChildOwner(
  db: any,
  playerToken: string,
  combatantId: string | undefined,
  characterId: string | undefined,
): Promise<ChildOwnerRef> {
  if (combatantId !== undefined) {
    const combatant = await resolveCombatant(db, playerToken, combatantId);
    return {
      fields: childOwner(combatant),
      combatant,
      characterId: combatant.characterId ?? null,
    };
  }
  if (characterId !== undefined) {
    const character = await resolveCharacter(db, playerToken, characterId);
    return {
      fields: { characterId: character._id },
      combatant: null,
      characterId: character._id,
    };
  }
  throw new Error("combatantId or characterId required");
}

/** Whether a child row belongs to the resolved owner (directly or via link). */
export function ownsChild(owner: ChildOwnerRef, row: any): boolean {
  if (owner.combatant !== null) {
    return childBelongsTo(row, owner.combatant);
  }
  return (
    row.characterId !== undefined && row.characterId === owner.characterId
  );
}

/**
 * Character cards visible from this Game (its own subscription, separate from
 * getGameState, so card edits don't re-render the whole board). The table is a
 * friend group's PCs — inherently small; 100 is a generous ceiling per bucket,
 * not a page size.
 *
 * Visibility = unstamped cards + this Game's stamped cards (design D2). Off
 * the playground nothing is ever stamped, so this returns every card exactly
 * as it did before. The two indexed reads (rather than one scan + a filter)
 * are what keep a playground's visitor cards from crowding the demo cards out
 * of a 100-row take.
 */
export const list = query({
  args: {
    playerToken: v.string(),
  },
  handler: async (ctx, args) => {
    const { game } = await resolveGame(ctx.db, args.playerToken);
    const byGame = (gameId: string | undefined) =>
      ctx.db
        .query("characters")
        .withIndex("byGameId", (q: any) => q.eq("gameId", gameId))
        .take(100);
    const [globalCards, gameCards] = await Promise.all([
      byGame(undefined),
      byGame(game._id),
    ]);
    const chars = [...globalCards, ...gameCards];
    if (chars.length === 0) return [];
    const ids = chars.map((c: any) => c._id);
    // Fetch each character's resources + recipes in parallel (the table is a
    // friend group's PCs — inherently small; the byCharacter index keeps this
    // cheap). Mirrors the join getCombatants does for linked combatants.
    const fetchKids = async (table: "resources" | "recipes" | "effects") =>
      Promise.all(
        ids.map((id) =>
          ctx.db
            .query(table)
            .withIndex("byCharacter", (q: any) => q.eq("characterId", id))
            .collect(),
        ),
      );
    const [resourcesByChar, recipesByChar, effectsByChar] = await Promise.all([
      fetchKids("resources"),
      fetchKids("recipes"),
      fetchKids("effects"),
    ]);
    return chars.map((c: any, i: number) =>
      toCharacterView(c, {
        resources: resourcesByChar[i].map((r: any) => ({
          _id: r._id,
          _creationTime: r._creationTime,
          // Character-owned rows carry no combatant; the view's combatantId is
          // an opaque owner string the card window never reads.
          combatantId: r.combatantId ?? c._id,
          label: r.label,
          current: r.current,
          max: r.max,
          icon: r.icon,
          color: r.color,
        })),
        recipes: recipesByChar[i].map((r: any) => ({
          _id: r._id,
          _creationTime: r._creationTime,
          combatantId: r.combatantId ?? c._id,
          name: r.name,
          hitType: r.hitType,
          attackMod: r.attackMod,
          damageDice: r.damageDice,
          damageMod: r.damageMod,
          damageType: r.damageType,
          dc: r.dc,
          saveAbility: r.saveAbility,
          critImmune: r.critImmune,
          resourceId: r.resourceId ?? null,
          resourceCost: r.resourceCost,
          multiTarget: r.multiTarget,
          appliesMods: r.appliesMods ?? [],
          extraRolls: r.extraRolls ?? [],
        })),
        effects: effectsByChar[i].map((e: any) => ({
          _id: e._id,
          _creationTime: e._creationTime,
          combatantId: e.combatantId ?? c._id,
          type: e.type,
          conditionKey: e.conditionKey ?? null,
          label: e.label,
          specs: e.specs,
          active: e.active,
        })),
      }),
    );
  },
});

/**
 * Create a card manually (the CSV seed uses its own mutation). Either role.
 * On the playground the card is stamped with the creating Game's id, confining
 * it to that Game's card menu (design D2); off the playground it is stamped
 * with nothing and stays global, exactly as before.
 */
export const create = mutation({
  args: {
    playerToken: v.string(),
    fields: characterFieldsValidator,
  },
  handler: async (ctx, args) => {
    const { game } = await resolveGame(ctx.db, args.playerToken);
    validateCardSize(args.fields);
    const id = await ctx.db.insert("characters", {
      ...args.fields,
      gameId: isPlaygroundMode() ? game._id : undefined,
    });
    return id;
  },
});

/**
 * The envelope an exported card file carries (design D4). `version` lets the
 * importer migrate old files on the way in (switch by version) instead of
 * rejecting them. v2 (character-builder) added optional structured fields
 * (`classes[]`, armor/weapon/tool/language profs); a v1 file simply lacks them
 * and the optional-field whitelist carries it through untouched.
 */
export const CARD_FILE_FORMAT = "war-table-5e-character";
export const CARD_FILE_VERSION = 2;

/**
 * Formats this importer still accepts. `dnd-combat-toolkit-character` is what
 * files exported before the project was renamed carry — including the backups
 * a table took of its own cards. Renaming the discriminator without honouring
 * the old one would turn every existing backup into "this isn't a card file",
 * which is precisely the failure the format contract exists to prevent.
 */
const ACCEPTED_CARD_FILE_FORMATS: readonly string[] = [
  CARD_FILE_FORMAT,
  "dnd-combat-toolkit-character",
];

/**
 * The card fields an export writes and an import accepts, derived from the
 * create validator so a field added there is carried by both on the same day.
 * Everything else — `seedKey`, `gameId`, `_id`, `_creationTime`, and anything
 * a hand-edited file invents — is dropped on import without complaint: a file
 * carrying junk is a file to clean, not a reason to refuse the character.
 */
export const CARD_FIELD_KEYS = Object.keys(
  characterFieldsValidator.fields,
) as (keyof CharacterFields)[];

/** Keep only the whitelisted card fields; silently drop everything else. */
export function pickCardFields(card: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of CARD_FIELD_KEYS) {
    if (card[key] !== undefined) out[key] = card[key];
  }
  return out;
}

/**
 * Defaults for every REQUIRED card column, applied under an imported card.
 *
 * A file exported before a required column existed doesn't carry it, and
 * without this the insert dies in the schema validator — surfaced to the
 * player as a generic "unknown error" on a file the app itself once wrote.
 * The customs stance is symmetric: junk in a file is dropped without
 * complaint, so a hole in a file is filled without complaint. A default is
 * visible on the card and editable; a rejection loses the character.
 *
 * Keep every default the blank-card value (`blankCardFields` in
 * src/lib/cardFile.ts) so an old file imports as "blank card + whatever the
 * file does carry". The structural test in cardRoundTrip.test.ts fails the
 * day a new required column is added without a default here.
 */
export const REQUIRED_CARD_DEFAULTS: Record<string, unknown> = {
  player: "",
  nameZh: "",
  nameEn: "",
  race: "",
  classesText: "",
  level: 1,
  alignment: "",
  statusText: "",
  hp: 10,
  maxHp: 10,
  ac: 10,
  acFormula: "",
  speedText: "30",
  initBonus: 0,
  pb: 2,
  abilities: ["力量", "敏捷", "體質", "智力", "感知", "魅力"].map((key) => ({
    key,
    score: 10,
    mod: 0,
  })),
  attackText: "",
  toolsText: "",
  goldText: "",
  refs: [],
  story: "",
};

/**
 * The child rows a card file carries, and the keys each may set. Enumerated
 * rather than passed through: Convex rejects a document carrying a field the
 * schema doesn't declare, so an un-picked stray key would make the whole
 * import fail instead of being quietly dropped the way a stray card field is.
 *
 * `resourceId` is absent on purpose — a file names its pools by label
 * (`resourceKey`), and the ids are minted fresh below.
 */
export const CHILD_KEYS = {
  resources: ["label", "current", "max", "icon", "color"],
  recipes: [
    "name",
    "hitType",
    "attackMod",
    "damageDice",
    "damageMod",
    "damageType",
    "dc",
    "saveAbility",
    "critImmune",
    "resourceCost",
    "multiTarget",
    "appliesMods",
    "extraRolls",
  ],
  effects: ["type", "conditionKey", "label", "specs", "active"],
} as const;

/**
 * Pick a child row's known keys; ignore anything else the file invented.
 *
 * `null` is treated as absent, not as a value. None of these tables declares a
 * nullable field — they use `v.optional`, i.e. the key is missing — but the
 * views they're exported from render "no value" as `null` (`conditionKey`,
 * `resourceId`), and JSON cannot carry `undefined` anyway. Without this, a card
 * exported with a custom effect round-trips into "Expected string, got null".
 */
function pickChild(
  row: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) out[key] = row[key];
  }
  return out;
}

/** A card file's child array, or [] when the file omits/malforms it. */
function childRows(card: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const rows = card[key];
  if (!Array.isArray(rows)) return [];
  return rows.filter(
    (r): r is Record<string, unknown> =>
      r !== null && typeof r === "object" && !Array.isArray(r),
  );
}

/**
 * Import cards from an exported `.dndcard.json` (design D4). The envelope is
 * whatever JSON the visitor picked, so it arrives as `v.any()` and is checked
 * here — declaring the real shape in `args` would reject a wrong file with an
 * unreadable validator dump instead of "this isn't a card file".
 *
 * Customs, in order: envelope → whitelist → size → hp clamp → shape. Shape is
 * enforced by the schema at insert time (the schema IS the shape), and because
 * a mutation is one transaction, a bad third card rolls the first two back —
 * an import either lands whole or not at all.
 */
export const importCards = mutation({
  args: {
    playerToken: v.string(),
    envelope: v.any(),
  },
  handler: async (ctx, args) => {
    const { game } = await resolveGame(ctx.db, args.playerToken);
    const envelope = args.envelope;
    if (
      envelope === null ||
      typeof envelope !== "object" ||
      !ACCEPTED_CARD_FILE_FORMATS.includes(envelope.format) ||
      !Array.isArray(envelope.cards) ||
      envelope.cards.length === 0
    ) {
      throw new ConvexError({ code: CARD_ERROR.badEnvelope });
    }
    // Version customs: v1 and v2 are both accepted (v1 simply lacks the
    // structured fields v2 added — the optional-field whitelist carries it
    // through). A file from a NEWER build than this deployment carries fields
    // we can't validate, so refuse it rather than silently drop them.
    if (typeof envelope.version === "number" && envelope.version > CARD_FILE_VERSION) {
      throw new ConvexError({ code: CARD_ERROR.unsupportedVersion });
    }
    const ids: string[] = [];
    for (const raw of envelope.cards) {
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        throw new ConvexError({ code: CARD_ERROR.badEnvelope });
      }
      const fields = { ...REQUIRED_CARD_DEFAULTS, ...pickCardFields(raw) };
      const resources = childRows(raw, "resources").map((r) =>
        pickChild(r, CHILD_KEYS.resources),
      );
      const recipes = childRows(raw, "recipes");
      const effects = childRows(raw, "effects").map((e) =>
        pickChild(e, CHILD_KEYS.effects),
      );
      // Size is measured on the sanitized card INCLUDING children — they are
      // most of a card's bytes, and a limit that ignored them would not be a
      // limit. Measured post-strip so junk in the file can't push a legitimate
      // card over.
      validateCardSize({ ...fields, resources, recipes, effects });
      // An imported card is exactly a card created here by hand: same clamp,
      // same playground stamp. A file cannot smuggle in a state the create
      // button could not produce.
      const maxHp = Number(fields.maxHp);
      if (typeof fields.hp === "number" && Number.isFinite(maxHp)) {
        fields.hp = Math.max(0, Math.min(fields.hp, maxHp));
      }
      const characterId = await ctx.db.insert("characters", {
        ...(fields as any),
        gameId: isPlaygroundMode() ? game._id : undefined,
      });

      // Pools first, so recipes can bind to them by label. A file names its
      // pool by `resourceKey`; the ids here are fresh, which is what makes a
      // card portable between deployments at all.
      const poolIdByLabel = new Map<string, any>();
      for (const r of resources) {
        const id = await ctx.db.insert("resources", { characterId, ...(r as any) });
        if (typeof r.label === "string" && !poolIdByLabel.has(r.label)) {
          poolIdByLabel.set(r.label, id);
        }
      }
      for (const raw of recipes) {
        const recipe = pickChild(raw, CHILD_KEYS.recipes);
        const key = raw.resourceKey;
        await ctx.db.insert("recipes", {
          characterId,
          ...(recipe as any),
          // An unresolvable key means a hand-edited file; drop the link rather
          // than reject the card — an unlinked recipe still rolls, and the DM
          // can re-point it. Silently binding to the wrong pool would be worse.
          resourceId:
            typeof key === "string" ? poolIdByLabel.get(key) : undefined,
        });
      }
      for (const e of effects) {
        await ctx.db.insert("effects", { characterId, ...(e as any) });
      }
      ids.push(characterId);
    }
    return ids;
  },
});

/**
 * Edit a card. PATCH semantics: only the provided fields change, so a
 * dirty-fields-only Save can never clobber concurrent combat writes. `hp` is
 * clamped to [0, maxHp] against the effective maxHp (same rule as combatants).
 */
export const update = mutation({
  args: {
    playerToken: v.string(),
    characterId: v.id("characters"),
    patch: characterPatchValidator,
  },
  handler: async (ctx, args) => {
    const character = await resolveCharacter(
      ctx.db,
      args.playerToken,
      args.characterId,
    );
    assertCardWritable(character);
    // Measure the card as it will be AFTER the patch, not the patch alone:
    // checking only the dirty fields would let a card grow past the whole-card
    // limit one field at a time.
    validateCardSize({ ...character, ...args.patch });
    const patch: Record<string, unknown> = { ...args.patch };
    if (patch.hp !== undefined) {
      const maxHp = (patch.maxHp as number) ?? character.maxHp;
      patch.hp = Math.max(0, Math.min(patch.hp as number, maxHp));
    }
    await ctx.db.patch(character._id, patch);
  },
});

/**
 * Delete a card entirely, with its character-owned recipes/resources/effects,
 * unlinking (not deleting) any combatants that point at it — they keep
 * fighting with their join-time stat snapshot. Either role.
 */
export const remove = mutation({
  args: {
    playerToken: v.string(),
    characterId: v.id("characters"),
  },
  handler: async (ctx, args) => {
    const character = await resolveCharacter(
      ctx.db,
      args.playerToken,
      args.characterId,
    );
    assertCardWritable(character);
    for (const table of ["recipes", "resources", "effects"] as const) {
      const rows = await ctx.db
        .query(table)
        .withIndex("byCharacter", (q: any) =>
          q.eq("characterId", character._id),
        )
        .collect();
      await Promise.all(rows.map((r: any) => ctx.db.delete(r._id)));
    }
    // Unlink combatants in any Game: freeze their card stats onto the row so
    // they keep fighting with what they had (removal never breaks a battle).
    const linked = await ctx.db
      .query("combatants")
      .withIndex("byCharacter", (q: any) =>
        q.eq("characterId", character._id),
      )
      .collect();
    await Promise.all(
      linked.map((c: any) =>
        ctx.db.patch(c._id, {
          characterId: undefined,
          hp: character.hp,
          maxHp: character.maxHp,
          ac: character.ac,
        }),
      ),
    );
    await ctx.db.delete(character._id);
  },
});

/**
 * Seed the four SRD sample characters (`convex/demoSeed.ts`): inserts each
 * card with its character-owned resources + recipes, resolving `resourceKey`
 * links to the freshly inserted resource ids. **Idempotent by `seedKey`** —
 * existing ids are skipped, so re-running can never reset live campaign state.
 * Returns how many characters were inserted. Either role.
 *
 * This used to seed the friend group's own six cards from a CSV codegen (issue
 * #9, grilling Q8). That seed left the repo when it went public — it was real
 * people's aliases and writing — and it had no job left anyway: the table has
 * been seeded since 2026-07, and the schema's own comment is the rule ("after
 * seeding, this table is authoritative forever"). A card's backup is now its
 * exported `.dndcard.json`, restorable through Import, which works for any
 * card rather than only the six the CSV knew about.
 */
export const seedAll = mutation({
  args: {
    playerToken: v.string(),
  },
  handler: async (ctx, args) => {
    await resolveGame(ctx.db, args.playerToken);
    let inserted = 0;
    for (const seed of DEMO_SEED) {
      const existing = await ctx.db
        .query("characters")
        .withIndex("bySeedKey", (q: any) => q.eq("seedKey", seed.seedKey))
        .unique();
      if (existing !== null) continue;
      const characterId = await ctx.db.insert("characters", {
        seedKey: seed.seedKey,
        ...seed.fields,
      });
      const resourceIds = new Map<string, string>();
      for (const r of seed.resources) {
        const id = await ctx.db.insert("resources", {
          characterId,
          label: r.label,
          current: r.current,
          max: r.max,
        });
        resourceIds.set(r.key, id);
      }
      for (const { resourceKey, ...recipe } of seed.recipes) {
        await ctx.db.insert("recipes", {
          characterId,
          ...recipe,
          resourceId:
            resourceKey !== undefined ? resourceIds.get(resourceKey) : undefined,
        });
      }
      inserted++;
    }
    return inserted;
  },
});

/**
 * Throw the character into the current Game as a linked combatant (grilling
 * Q7): kind pc, auto color (anyone may recolor), initiative 0 until Roll
 * Initiative (which uses the card's 先攻 bonus for linked PCs). One character
 * = one combatant per Game — throws if already in this battle. The row's
 * hp/maxHp/ac are a join-time snapshot; readers project the live card values.
 * Removing/killing the combatant never touches the card.
 */
export const joinBattle = mutation({
  args: {
    playerToken: v.string(),
    characterId: v.id("characters"),
  },
  handler: async (ctx, args) => {
    const { game } = await resolveGame(ctx.db, args.playerToken);
    const character = await ctx.db.get(args.characterId);
    if (character === null) {
      throw new Error("Character not found");
    }
    const existing = await ctx.db
      .query("combatants")
      .withIndex("byGame", (q: any) => q.eq("gameId", game._id))
      .collect();
    if (existing.some((c: any) => c.characterId === character._id)) {
      throw new Error(`${character.nameZh} is already in this battle`);
    }
    const color = pickNextColor(existing.map((c: any) => c.color));
    const order =
      existing.reduce((max: number, c: any) => Math.max(max, c.order), -1) + 1;
    const id = await ctx.db.insert("combatants", {
      gameId: game._id,
      characterId: character._id,
      name: character.nameZh,
      kind: "pc",
      color,
      hp: character.hp,
      maxHp: character.maxHp,
      ac: character.ac,
      initiative: 0,
      notes: "",
      dmNotes: "",
      alive: true,
      actionUsed: false,
      bonusUsed: false,
      reactionUsed: false,
      resist: [],
      vuln: [],
      immune: [],
      order,
    });
    return id;
  },
});
