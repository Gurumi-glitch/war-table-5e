/**
 * Codegen: turns the SRD 5.1 spell + equipment data in `seed/` into a committed
 * pure-data module `convex/library.ts` — the weapons + spells database that
 * feeds the recipe picker (issue #7). Re-run: `npm run gen:library`.
 *
 * SOURCE (2026-07-17): this generator previously read local reference CSVs from
 * `infos/`. Whatever a local file is convenient for, it cannot be redistributed
 * unless its provenance is one we are licensed to pass on — and a data file's
 * label is not its provenance. Byte-identical strings tell you where data came
 * from; a "source" column only tells you what someone typed.
 *
 * It now reads the same open dataset the enemy database already uses
 * (5e-bits/5e-database), so provenance is a URL anyone can check rather than a
 * claim: SRD 5.1 content, released by Wizards of the Coast under CC-BY-4.0.
 * See NOTICE.md.
 *
 * Traditional Chinese names come from `seed/zh-tw-names.json`, which is OUR
 * translation of the SRD's English names — not lifted from any published
 * translation. Kept in a separate file on purpose: the two sources have
 * different licenses and different authors, and a future reader has to be able
 * to tell them apart without taking anyone's word for it.
 *
 * Everything here is metadata for targeting/validation. Full effect text is not
 * copied in: a library entry pre-fills a recipe's computable fields, and the DM
 * is always the authority (ADR-0002).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SPELLS_JSON = resolve(ROOT, "seed/5e-SRD-Spells.json");
const EQUIPMENT_JSON = resolve(ROOT, "seed/5e-SRD-Equipment.json");
const ZH_JSON = resolve(ROOT, "seed/zh-tw-names.json");
const OUT = resolve(ROOT, "convex/library.ts");

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

/** SRD indexes are hyphenated; this project's entry ids are underscored. */
const slug = (index) => index.replace(/-/g, "_");

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * "8d6" -> [{d6 x8}, mod 0]; "3d4 + 3" -> [{d4 x3}, mod 3];
 * "1d8 + MOD" -> [{d8 x1}, mod 0] — MOD is the caster's ability modifier, which
 * the DM enters per character (the library never guesses a character's numbers).
 */
function parseDice(expr) {
  if (!expr) return { dice: [], mod: 0 };
  const dice = [];
  for (const m of expr.matchAll(/(\d+)d(\d+)/g)) {
    dice.push({ type: `d${m[2]}`, count: Number(m[1]) });
  }
  const flat = expr.match(/\+\s*(\d+)\b/);
  return { dice, mod: flat ? Number(flat[1]) : 0 };
}

/** The damage/heal expression for a spell cast at its BASE level. */
function baseExpression(spell) {
  const d = spell.damage;
  if (d?.damage_at_slot_level) {
    const lowest = Math.min(...Object.keys(d.damage_at_slot_level).map(Number));
    return d.damage_at_slot_level[String(lowest)];
  }
  if (d?.damage_at_character_level) {
    // Cantrips scale with the caster's level; level 1 is the base.
    return d.damage_at_character_level["1"];
  }
  if (spell.heal_at_slot_level) {
    const lowest = Math.min(...Object.keys(spell.heal_at_slot_level).map(Number));
    return spell.heal_at_slot_level[String(lowest)];
  }
  return "";
}


// ---------------------------------------------------------------------------
// Curation
//
// Everything below is judgement the SRD data cannot supply on its own. It was
// worked out for the retired PHB-CSV mapper and is carried over unchanged in
// substance: the source of the STATS changed, the rules did not.
// ---------------------------------------------------------------------------

/**
 * Per-dart base for darts spells. The SRD expresses Magic Missile as the whole
 * volley ("3d4 + 3" at level 1, "4d4 + 4" at 2 — i.e. +1 per dart), but this
 * engine multiplies BY dart count at Confirm:
 *   combatLog.ts → `mod: t.dartValues.length * damageMod`
 * So a library entry must carry the PER-DART values, or three darts would
 * resolve as 3d4+3 dice × 3 darts. `1d4 + 1` per dart × 3 = 3d4+3 = SRD RAW.
 */
const DARTS = {
  spell_magic_missile: { dice: [{ type: "d4", count: 1 }], mod: 1 },
};

/**
 * Buffs the engine can express as modifier rows. `direction: "self"` matters:
 * Shield's range is Self and True Strike's advantage belongs to the CASTER —
 * without it the chip lands on the confirmed target (an enemy), inverting the
 * spell. Value 0 = a visible, toggleable reminder chip with no math (the rule
 * needs a d4 rolled by hand, or an AC edit the engine must not guess).
 */
const BUFF_MODS = {
  spell_shield: [{ stat: "ac", mode: "bonus", value: 5, direction: "self", note: "Shield — +5 AC until the start of your next turn" }],
  spell_shield_of_faith: [{ stat: "ac", mode: "bonus", value: 2, note: "Shield of Faith — +2 AC (concentration)" }],
  spell_haste: [{ stat: "ac", mode: "bonus", value: 2, note: "Haste — +2 AC (adv. Dex saves, speed ×2, extra action: manual)" }],
  spell_true_strike: [{ stat: "attack", mode: "advantage", value: 0, direction: "self", note: "True Strike — advantage on your next attack roll vs the target" }],
  spell_blur: [{ stat: "attackAgainst", mode: "disadvantage", value: 0, direction: "self", note: "Blur — attackers with blindsight/truesight are unaffected (manual); concentration, 1 min" }],
  spell_faerie_fire: [{ stat: "attackAgainst", mode: "advantage", value: 0, direction: "targets", note: "Faerie Fire — untick/toggle off targets that saved; no invisibility; concentration, 1 min" }],
  spell_invisibility: [
    { stat: "attack", mode: "advantage", value: 0, direction: "targets", note: "Invisibility — ends when the target attacks or casts (toggle the chip off); concentration, 1 hr" },
    { stat: "attackAgainst", mode: "disadvantage", value: 0, direction: "targets", note: "Invisibility — ends when the target attacks or casts (toggle the chip off); concentration, 1 hr" },
  ],
  spell_greater_invisibility: [
    { stat: "attack", mode: "advantage", value: 0, direction: "targets", note: "Greater Invisibility — attacking/casting does not break it; concentration, 1 min" },
    { stat: "attackAgainst", mode: "disadvantage", value: 0, direction: "targets", note: "Greater Invisibility — attacking/casting does not break it; concentration, 1 min" },
  ],
  spell_magic_weapon: [{ stat: "attack", mode: "bonus", value: 1, direction: "targets", note: "Magic Weapon — damage is also +1 (add it to damage mod at Confirm); concentration, 1 hr" }],
  spell_bless: [{ stat: "attack", mode: "bonus", value: 0, direction: "targets", note: "Bless — add 1d4 by hand to attack rolls and saves; concentration, 1 min" }],
  spell_bane: [{ stat: "attack", mode: "bonus", value: 0, direction: "targets", note: "Bane — failed savers subtract 1d4 by hand (untick those who saved); concentration, 1 min" }],
  spell_guidance: [{ stat: "abilityCheck", mode: "bonus", value: 0, direction: "targets", note: "Guidance — add 1d4 by hand to one ability check; concentration, 1 min" }],
  spell_resistance: [{ stat: "save", mode: "bonus", value: 0, direction: "targets", note: "Resistance — add 1d4 by hand to one save; concentration, 1 min" }],
  spell_mage_armor: [{ stat: "ac", mode: "bonus", value: 0, direction: "targets", note: "Mage Armor — base AC becomes 13+DEX (edit AC by hand; do not use override); 8 hrs" }],
  spell_barkskin: [{ stat: "ac", mode: "bonus", value: 0, direction: "targets", note: "Barkskin — AC cannot be below 16 (edit AC only if lower); concentration, 1 hr" }],
};

/**
 * Instant temp-HP grants (PHB p.198 rules, SRD data): the dice describe a GRANT,
 * not damage, so they move onto a `tempHp` row and the main damage fields are
 * zeroed — otherwise the leftover 1d4+4 resolves as untyped damage.
 */
const TEMP_HP_MODS = {
  spell_false_life: [
    { stat: "tempHp", mode: "bonus", value: 4, dice: [{ type: "d4", count: 1 }], direction: "self", note: "False Life — 1d4+4 temp HP (no stacking; keep the larger pool)" },
  ],
};

/**
 * Flat-amount heals. Heal restores a fixed 70 HP and the SRD data carries no
 * dice for it, so the dice-based heal detection misses it: Confirm computed 0
 * and a bare forceDamage took the DAMAGE branch and SUBTRACTED HP. Baking the
 * amount into damageMod rides the existing empty-dice heal path.
 */
const FLAT_HEAL = {
  spell_heal: 70,
};

/**
 * Spells the SRD marks with `heal_at_slot_level` that are NOT a heal the engine
 * can compute, and must not be labelled "healing" — Confirm would restore HP
 * that the rule never grants:
 *   - Aid raises the hp MAXIMUM (no stat models that; edit maxHp by hand).
 *   - Mass Heal is a 700-point pool split freely across targets — no single
 *     number to bake in.
 * False Life is excluded by its temp-HP row instead (a grant, not a heal).
 */
const NOT_A_HEAL = new Set(["spell_aid", "spell_mass_heal"]);

/** Spells whose effect needs manual handling the generic note doesn't explain. */
const NOTE_EXTRA = {
  spell_heal: "Restores a flat 70 HP (already in damage mod); ending blindness/deafness/disease is a manual condition removal; no effect on constructs or undead.",
  spell_mass_heal: "A 700-HP pool split freely — manual: pick healing as the damage type at Confirm and put each target's share in its forceDamage.",
  spell_aid: "Raises the hp MAXIMUM and heals 5 (not temp HP) — edit maxHp and HP by hand.",
  spell_heroes_feast: "After the feast: hp maximum +2d10 (not temp HP), immunity to fear/poison, advantage on WIS saves — roll 2d10, edit maxHp, add a modifier.",
};

const GENERIC_NOTE =
  "Use this entry for targeting and validation; consult the rules for full effect selection, exceptions, and exact upcast text.";

// ---------------------------------------------------------------------------
// SRD -> LibraryEntry
// ---------------------------------------------------------------------------

function mapSpell(s, zh) {
  const id = `spell_${slug(s.index)}`;
  // An attack spell rolls to hit; a spell with a DC is saved against; anything
  // else just happens (Magic Missile, Cure Wounds). Saves and automatic effects
  // never crit.
  const hitType = s.attack_type ? "attack" : s.dc ? "save" : "automatic";
  const isHeal = Boolean(s.heal_at_slot_level);
  const parsed = parseDice(baseExpression(s));
  const darts = DARTS[id];
  const tempHpMods = TEMP_HP_MODS[id];
  const flatHeal = FLAT_HEAL[id];
  // Precedence: per-dart curation > temp-HP grant (dice move to the mod row) >
  // flat heal > the parsed SRD expression.
  const zeroed = Boolean(tempHpMods) || NOT_A_HEAL.has(id);
  const dice = darts ? darts.dice : zeroed ? [] : parsed.dice;
  const mod = darts ? darts.mod : zeroed ? 0 : (flatHeal ?? parsed.mod);
  const components = [
    (s.components ?? []).join(", "),
    s.material ? `(${s.material.replace(/\.$/, "")})` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    id,
    kind: "spell",
    name: s.name,
    nameZh: zh.spells[s.index] ?? "",
    hitType,
    attackMod: 0,
    damageDice: dice,
    damageMod: mod,
    damageType:
      tempHpMods || NOT_A_HEAL.has(id)
        ? ""
        : isHeal || flatHeal !== undefined
          ? "healing"
          : (s.damage?.damage_type?.index ?? ""),
    dc: 0,
    saveAbility: s.dc?.dc_type?.index ?? "",
    critImmune: hitType !== "attack",
    resourceCost: 0,
    multiTarget: darts ? "darts" : s.area_of_effect ? "aoe" : "none",
    appliesMods: BUFF_MODS[id] ?? tempHpMods ?? [],
    ref: {
      level: s.level,
      school: s.school?.index ?? "",
      schoolZh: zh.schools[s.school?.index] ?? "",
      castingTime: s.casting_time ?? "",
      range: s.range ?? "",
      components,
      material: s.material ?? "",
      duration: s.duration ?? "",
      concentration: Boolean(s.concentration),
      ritual: Boolean(s.ritual),
      classLists: (s.classes ?? []).map((c) => c.name).join("|"),
      note: NOTE_EXTRA[id] ? `${GENERIC_NOTE} ${NOTE_EXTRA[id]}` : GENERIC_NOTE,
    },
  };
}

function mapWeapon(w, zh) {
  const { dice, mod } = parseDice(w.damage?.damage_dice ?? "");
  const props = (w.properties ?? []).map((p) => p.name);
  // Finesse lets the wielder pick; a thrown/ranged weapon uses DEX. The DM sets
  // the actual attack modifier — this is a hint on the entry, not a number.
  const attackAbility = props.includes("Finesse")
    ? "STR_or_DEX"
    : w.weapon_range === "Ranged"
      ? "DEX"
      : "STR";

  return {
    id: `weapon_${slug(w.index)}`,
    kind: "weapon",
    name: w.name,
    nameZh: zh.weapons[w.index] ?? "",
    hitType: "attack",
    attackMod: 0,
    damageDice: dice,
    damageMod: mod,
    damageType: w.damage?.damage_type?.index ?? "",
    dc: 0,
    saveAbility: "",
    critImmune: false,
    resourceCost: 0,
    multiTarget: "none",
    appliesMods: [],
    ref: {
      category: w.weapon_category ?? "",
      group: w.category_range ?? "",
      attackMode: (w.weapon_range ?? "").toLowerCase(),
      attackAbility,
      properties: props.join("、"),
      versatile: w.two_handed_damage?.damage_dice ?? "",
      normalRange: w.range?.normal ?? undefined,
      longRange: w.range?.long ?? undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// Emit convex/library.ts
// ---------------------------------------------------------------------------

const dieLiteral = (d) => `{ type: "${d.type}", count: ${d.count} }`;

function modLiteral(m) {
  const parts = [
    `stat: ${JSON.stringify(m.stat)}`,
    `mode: ${JSON.stringify(m.mode)}`,
    `value: ${m.value}`,
  ];
  if (m.dice?.length) parts.push(`dice: [${m.dice.map(dieLiteral).join(", ")}]`);
  if (m.direction) parts.push(`direction: ${JSON.stringify(m.direction)}`);
  if (m.note) parts.push(`note: ${JSON.stringify(m.note)}`);
  return `{ ${parts.join(", ")} }`;
}

function refLiteral(ref) {
  const lines = [];
  for (const [k, v] of Object.entries(ref)) {
    if (v === null || v === undefined || v === "") continue;
    if (typeof v === "boolean" || typeof v === "number") lines.push(`    ${k}: ${v},`);
    else lines.push(`    ${k}: ${JSON.stringify(v)},`);
  }
  return `{\n${lines.join("\n")}\n  }`;
}

function entryLiteral(e) {
  return [
    "  {",
    `    id: ${JSON.stringify(e.id)},`,
    `    kind: ${JSON.stringify(e.kind)},`,
    `    name: ${JSON.stringify(e.name)},`,
    `    nameZh: ${JSON.stringify(e.nameZh)},`,
    `    hitType: ${JSON.stringify(e.hitType)},`,
    `    attackMod: ${e.attackMod},`,
    `    damageDice: [${e.damageDice.map(dieLiteral).join(", ")}],`,
    `    damageMod: ${e.damageMod},`,
    `    damageType: ${JSON.stringify(e.damageType)},`,
    `    dc: ${e.dc},`,
    `    saveAbility: ${JSON.stringify(e.saveAbility)},`,
    `    critImmune: ${e.critImmune},`,
    `    resourceCost: ${e.resourceCost},`,
    `    multiTarget: ${JSON.stringify(e.multiTarget)},`,
    `    appliesMods: [${e.appliesMods.map(modLiteral).join(", ")}],`,
    `    ref: ${refLiteral(e.ref)},`,
    "  },",
  ].join("\n");
}

function main() {
  const zh = readJson(ZH_JSON);
  const spells = readJson(SPELLS_JSON)
    .map((s) => mapSpell(s, zh))
    .sort((a, b) => a.name.localeCompare(b.name));
  const weapons = readJson(EQUIPMENT_JSON)
    .filter((e) => e.equipment_category?.index === "weapon")
    .map((w) => mapWeapon(w, zh))
    .sort((a, b) => a.name.localeCompare(b.name));
  const library = [...weapons, ...spells];

  const missing = library.filter((e) => e.nameZh === "").map((e) => e.id);
  if (missing.length > 0) {
    // Loud, not silent: a blank Chinese name is invisible in the picker's zh-TW
    // view, and a missing translation should be fixed rather than shipped.
    console.warn(`⚠ ${missing.length} entries have no zh-TW name: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? " …" : ""}`);
  }

  const banner = [
    "/**",
    " * AUTO-GENERATED by `npm run gen:library` (scripts/gen-library.mjs).",
    " *",
    " * Sources:",
    " *   - seed/5e-SRD-Spells.json + seed/5e-SRD-Equipment.json — SRD 5.1 content",
    " *     (Wizards of the Coast, CC-BY-4.0), via 5e-bits/5e-database (MIT).",
    " *   - seed/zh-tw-names.json — our own zh-TW translation of the SRD's English",
    " *     names. Not taken from any published translation. AGPL-3.0, like the code.",
    " * See NOTICE.md for the full attribution.",
    " *",
    " * The weapons + spells DATABASE for the recipe picker (issue #7). Pure data —",
    " * no Convex runtime. Each entry carries a best-effort Action-recipe draft (the",
    " * computable fields) plus a `ref` block of reference metadata. Full effect text",
    " * is deliberately NOT copied in: consult the rules for exceptions and upcast",
    " * text. The DM is the authority (ADR-0002) — every derived field is editable",
    " * once the entry is added to a combatant.",
    " *",
    ` * ${weapons.length} weapons · ${spells.length} spells · ${library.length} total.`,
    " */",
  ].join("\n");

  const body = `${banner}
import type { LibraryEntry } from "./recipeLibrary";

export const LIBRARY: readonly LibraryEntry[] = [
${library.map(entryLiteral).join("\n")}
];

export const WEAPONS: readonly LibraryEntry[] = LIBRARY.filter((e) => e.kind === "weapon");
export const SPELLS: readonly LibraryEntry[] = LIBRARY.filter((e) => e.kind === "spell");
`;

  writeFileSync(OUT, body, "utf8");
  console.log(`wrote ${OUT}: ${weapons.length} weapons, ${spells.length} spells, ${library.length} total.`);
}

main();
