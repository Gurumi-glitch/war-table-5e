import { useState } from "react";
import type { CombatantView } from "../../convex/games";
import type { RecipeView } from "../../convex/recipes";
import type { ResourceView } from "../../convex/resources";
import { LIBRARY, toRecipeDraft, type LibraryEntry, type RecipeDraft } from "../../convex/recipeLibrary";
import { DAMAGE_TYPES, type DiceTerm, type ExtraRoll, type ExtraRollUsage, type HitType } from "../../convex/rules";
import { useT, type Messages } from "../i18n";
import { damageTypeLabel, modeLabel, saveAbilityLabel, statLabel } from "../i18n/terms";
import { MODE_LABELS, STAT_LABELS, type Mode, type ModifierSpec, type Stat } from "../../convex/modifiers";
import { ResourceIconPickerButton } from "./ResourcePip";

/** Handlers for editing a combatant's Resources. */
export type ResourceHandlers = {
  onAddResource?: (combatantId: string, label: string, max: number, current?: number) => void;
  // icon/color: BG3-style pip overrides (docs/DESIGN.md) — editable here (character
  // sheet) AND from a gear button on the Battle/Batch Battle board pips themselves.
  onUpdateResource?: (
    resourceId: string,
    patch: { label?: string; current?: number; max?: number; icon?: string; color?: string | null },
  ) => void;
  onRemoveResource?: (resourceId: string) => void;
};

/** Handlers for editing a combatant's Action recipes. */
export type RecipeHandlers = {
  onAddRecipe?: (combatantId: string, recipe: RecipeDraft) => void;
  onUpdateRecipe?: (recipeId: string, recipe: RecipeDraft) => void;
  onRemoveRecipe?: (recipeId: string) => void;
};

type Props = ResourceHandlers &
  RecipeHandlers & {
    combatant: CombatantView;
    onPatch?: (patch: Partial<{ resist: string[]; vuln: string[]; immune: string[] }>) => void;
  };

/**
 * A per-combatant expandable "sheet" (issue #7): Resources (current/max), damage
 * modifiers (resist/vulnerability/immunity), and Action recipes (CRUD + starter
 * library). Collapsed by default to keep the combat table scannable. Open to
 * either role; the backend is the authority.
 */
export function CombatantSheet({
  combatant: c,
  onPatch,
  onAddResource,
  onUpdateResource,
  onRemoveResource,
  onAddRecipe,
  onUpdateRecipe,
  onRemoveRecipe,
}: Props) {
  const msg = useT();
  return (
    <details aria-label={`sheet ${c.name}`} style={{ marginTop: "0.2em" }}>
      <summary style={{ cursor: "pointer" }}>{msg.sheet.sheet}</summary>
      <div
        style={{
          marginLeft: "1em",
          marginTop: "0.3em",
          padding: "0.4em",
          borderLeft: "2px solid #ccc",
          display: "flex",
          flexDirection: "column",
          gap: "0.6em",
        }}
      >
        <ResourcesSection
          resources={c.resources ?? []}
          onAdd={onAddResource ? (label, max) => onAddResource(c._id, label, max) : undefined}
          onUpdate={onUpdateResource}
          onRemove={onRemoveResource}
          defaultColor={c.color}
        />
        <RVISection combatant={c} onPatch={onPatch} />
        <RecipesSection
          recipes={c.recipes ?? []}
          resources={c.resources ?? []}
          onAdd={onAddRecipe ? (recipe) => onAddRecipe(c._id, recipe) : undefined}
          onUpdate={onUpdateRecipe}
          onRemove={onRemoveRecipe}
        />
      </div>
    </details>
  );
}

/**
 * Curated resource presets — the spell-slot ladder every caster carries.
 * Selecting one fills the add form (label + a sensible max the DM edits).
 * Future (#9 / 六人角色卡 seed): the character DB auto-adds the right slot
 * levels with the right maxima; these presets stay for manual additions.
 */
const RESOURCE_PRESETS: ReadonlyArray<{ label: string; max: number }> = [
  { label: "L1 slots", max: 2 },
  { label: "L2 slots", max: 2 },
  { label: "L3 slots", max: 2 },
  { label: "L4 slots", max: 1 },
  { label: "L5 slots", max: 1 },
  { label: "L6 slots", max: 1 },
  { label: "L7 slots", max: 1 },
  { label: "L8 slots", max: 1 },
  { label: "L9 slots", max: 1 },
  { label: "L10 slots", max: 1 },
  { label: "Ki", max: 3 },
  { label: "Rage", max: 2 },
  { label: "Lay on Hands", max: 5 },
];

/** Resources: list with inline current/max edit + preset or custom add. */
export function ResourcesSection({
  resources,
  onAdd,
  onUpdate,
  onRemove,
  defaultColor,
}: {
  resources: ResourceView[];
  onAdd?: (label: string, max: number) => void;
  onUpdate?: ResourceHandlers["onUpdateResource"];
  onRemove?: ResourceHandlers["onRemoveResource"];
  /** The owning combatant's identity color, previewed when a resource has no
   * color override yet. Absent (e.g. an unlinked character card) falls back
   * to a neutral gray — the real pip still resolves the actual combatant
   * color once joined to battle; this is only a sheet preview. */
  defaultColor?: string;
}) {
  const msg = useT();
  const [label, setLabel] = useState("");
  const [max, setMax] = useState(1);
  return (
    <fieldset>
      <legend>{msg.sheet.resources}</legend>
      {resources.map((r) => (
        <div key={r._id} style={{ marginBottom: "0.2em" }}>
          <input
            value={r.label}
            onChange={(e) => onUpdate?.(r._id, { label: e.target.value })}
            size={14}
            aria-label={`resource label ${r._id}`}
          />{" "}
          <input
            type="number"
            value={r.current}
            onChange={(e) => onUpdate?.(r._id, { current: Number(e.target.value) })}
            style={{ width: "4em" }}
            aria-label={`resource current ${r._id}`}
          />
          /
          <input
            type="number"
            value={r.max}
            onChange={(e) => onUpdate?.(r._id, { max: Number(e.target.value) })}
            style={{ width: "4em" }}
            aria-label={`resource max ${r._id}`}
          />
          <button onClick={() => onRemove?.(r._id)} aria-label={`remove resource ${r._id}`}>
            ×
          </button>{" "}
          <ResourceIconPickerButton
            icon={r.icon ?? "square"}
            color={r.color ?? defaultColor ?? "#888888"}
            onChange={(icon) => onUpdate?.(r._id, { icon })}
            ariaLabel={`resource icon ${r._id}`}
          />{" "}
          <input
            type="color"
            value={r.color ?? defaultColor ?? "#888888"}
            onChange={(e) => onUpdate?.(r._id, { color: e.target.value })}
            aria-label={`resource color ${r._id}`}
            style={{ width: "1.6em", height: "1.6em", padding: 0, verticalAlign: "middle" }}
          />
          {r.color !== undefined && (
            <button
              onClick={() => onUpdate?.(r._id, { color: null })}
              aria-label={`reset resource color ${r._id}`}
              title={msg.sheet.resetToCombatantColor}
            >
              ⟲
            </button>
          )}
        </div>
      ))}
      <label>
        {msg.sheet.addLabel}{" "}
        <select
          value=""
          onChange={(e) => {
            const preset = RESOURCE_PRESETS.find((p) => p.label === e.target.value);
            if (preset) {
              setLabel(preset.label);
              setMax(preset.max);
            }
          }}
          aria-label="resource preset"
        >
          <option value="">{msg.sheet.presetPlaceholder}</option>
          {RESOURCE_PRESETS.map((p) => (
            <option key={p.label} value={p.label}>
              {p.label}
            </option>
          ))}
        </select>{" "}
        <input value={label} onChange={(e) => setLabel(e.target.value)} size={10} placeholder={msg.sheet.labelPlaceholder} aria-label="new resource label" />{" "}
        {msg.sheet.maxLabel}{" "}
        <input
          type="number"
          value={max}
          onChange={(e) => setMax(Number(e.target.value))}
          style={{ width: "4em" }}
          aria-label="new resource max"
        />{" "}
        <button
          onClick={() => {
            if (label.trim()) {
              onAdd?.(label.trim(), max);
              setLabel("");
              setMax(1);
            }
          }}
        >
          +
        </button>
      </label>
    </fieldset>
  );
}

/** The R/V/I choices: every damage type the engine knows, minus healing. */
const RVI_TYPES = DAMAGE_TYPES.filter((t) => t !== "healing");

/**
 * Damage modifiers: resist / vulnerability / immunity picked from the damage
 * type list (dropdown + removable chips — no free text, no typos; the Confirm
 * math matches types by exact string). Saves immediately on add/remove.
 */
export function RVISection({
  combatant: c,
  onPatch,
}: {
  combatant: CombatantView;
  onPatch?: Props["onPatch"];
}) {
  const msg = useT();
  const lists = { resist: c.resist ?? [], vuln: c.vuln ?? [], immune: c.immune ?? [] };
  const patch = (key: keyof typeof lists, next: string[]) =>
    onPatch?.({ ...lists, [key]: next });

  const row = (key: keyof typeof lists, label: string) => (
    <div style={{ marginBottom: "0.2em" }}>
      {label}{" "}
      {lists[key].map((t) => (
        <span
          key={t}
          style={{
            display: "inline-block",
            border: "1px solid #bbb",
            borderRadius: "0.8em",
            padding: "0 0.5em",
            marginRight: "0.25em",
          }}
        >
          {damageTypeLabel(msg, t)}{" "}
          <button
            onClick={() => patch(key, lists[key].filter((x) => x !== t))}
            aria-label={`remove ${label} ${t}`}
            style={{ border: "none", background: "none", cursor: "pointer", padding: 0 }}
          >
            ×
          </button>
        </span>
      ))}
      <select
        value=""
        onChange={(e) => {
          const t = e.target.value;
          if (t && !lists[key].includes(t)) patch(key, [...lists[key], t]);
        }}
        aria-label={`add ${label}`}
      >
        <option value="">{msg.sheet.addRvi}</option>
        {RVI_TYPES.filter((t) => !lists[key].includes(t)).map((t) => (
          <option key={t} value={t}>
            {damageTypeLabel(msg, t)}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <fieldset>
      <legend>{msg.sheet.damageMods}</legend>
      {row("resist", msg.sheet.resist)}
      {row("vuln", msg.sheet.vuln)}
      {row("immune", msg.sheet.immune)}
    </fieldset>
  );
}

/** Recipes: list with edit + add-from-library + custom add. */
export function RecipesSection({
  recipes,
  resources,
  onAdd,
  onUpdate,
  onRemove,
}: {
  recipes: RecipeView[];
  resources: ResourceView[];
  onAdd?: (recipe: RecipeDraft) => void;
  onUpdate?: RecipeHandlers["onUpdateRecipe"];
  onRemove?: RecipeHandlers["onRemoveRecipe"];
}) {
  const msg = useT();
  return (
    <fieldset>
      <legend>{msg.sheet.recipes}</legend>
      {recipes.map((r) => (
        <RecipeRow
          key={r._id}
          recipe={r}
          resources={resources}
          onUpdate={onUpdate}
          onRemove={onRemove}
        />
      ))}
      <LibraryPicker onAdd={onAdd} />
      <RecipeAddForm resources={resources} onAdd={onAdd} />
    </fieldset>
  );
}

/** The RecipeDraft projection of an existing recipe row. */
function toDraft(recipe: RecipeView): RecipeDraft {
  return {
    name: recipe.name,
    hitType: recipe.hitType,
    attackMod: recipe.attackMod,
    damageDice: recipe.damageDice,
    damageMod: recipe.damageMod,
    damageType: recipe.damageType,
    dc: recipe.dc,
    saveAbility: recipe.saveAbility,
    critImmune: recipe.critImmune,
    resourceId: recipe.resourceId ?? undefined,
    resourceCost: recipe.resourceCost,
    multiTarget: recipe.multiTarget,
    appliesMods: recipe.appliesMods ?? [],
    extraRolls: recipe.extraRolls ?? [],
  };
}

/** One editable recipe row (inline edit of key fields). */
function RecipeRow({
  recipe,
  resources,
  onUpdate,
  onRemove,
}: {
  recipe: RecipeView;
  resources: ResourceView[];
  onUpdate?: RecipeHandlers["onUpdateRecipe"];
  onRemove?: RecipeHandlers["onRemoveRecipe"];
}) {
  const msg = useT();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RecipeDraft>(() => toDraft(recipe));
  const set = <K extends keyof RecipeDraft>(k: K, v: RecipeDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const linkedPool =
    recipe.resourceId !== null
      ? resources.find((r) => r._id === recipe.resourceId)
      : undefined;

  return (
    <div style={{ marginBottom: "0.2em" }}>
      <button onClick={() => setOpen((o) => !o)} aria-label={`edit recipe ${recipe.name}`}>
        {open ? "▾" : "▸"}
      </button>{" "}
      <strong>{recipe.name}</strong> <em>{recipe.hitType}</em>{" "}
      {recipe.hitType === "attack" && msg.sheet.toHit(recipe.attackMod)}
      {recipe.hitType === "save" && `DC ${recipe.dc} ${saveAbilityLabel(msg, recipe.saveAbility)}`}
      {" · "}
      {recipe.damageDice
        .map((d: DiceTerm) => `${d.count}${d.type}`)
        .join("+")}
      {recipe.damageMod >= 0 ? "+" : ""}
      {recipe.damageMod} {damageTypeLabel(msg, recipe.damageType)}
      {(recipe.appliesMods ?? []).length > 0 && (
        <>
          {" · "}
          <strong>{msg.sheet.grants}</strong> {summarizeMods(recipe.appliesMods ?? [], msg)}
        </>
      )}
      {(recipe.extraRolls ?? []).length > 0 && (
        <>
          {" · "}
          <strong>{msg.sheet.rolls}</strong> {summarizeExtraRolls(recipe.extraRolls ?? [], msg)}
        </>
      )}
      {linkedPool !== undefined && (
        <>
          {" · "}
          <em>
            {msg.sheet.consumesPool(linkedPool.label, recipe.resourceCost !== 1 ? ` ×${recipe.resourceCost}` : "")}
          </em>
        </>
      )}
      <button onClick={() => onRemove?.(recipe._id)} aria-label={`remove recipe ${recipe.name}`}>
        ×
      </button>
      {open && (
        <div
          style={{ marginLeft: "1em", marginTop: "0.2em" }}
          aria-label={`edit form ${recipe.name}`}
        >
          <RecipeFormFields draft={draft} set={set} resources={resources} />
          <button
            onClick={() => {
              onUpdate?.(recipe._id, draft);
              setOpen(false);
            }}
          >
            {msg.common.save}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Everything an entry is searchable by, joined lowercase: names + id, plus
 * spell level tokens ("l4", "level 4", "cantrip"), school (en+zh), classes,
 * concentration/ritual, weapon category/mode/properties, hit type, damage
 * type, save ability, aoe/darts. Multi-word queries AND together, so
 * "l4 fire" = level-4 fire spells.
 */
function entryHaystack(e: LibraryEntry): string {
  const r = e.ref;
  const bits: Array<string | undefined> = [
    e.name,
    e.nameZh,
    e.id,
    e.kind,
    e.hitType,
    e.damageType,
    e.saveAbility,
    e.multiTarget === "none" ? undefined : e.multiTarget,
  ];
  if (e.kind === "spell") {
    if (r.level != null) {
      bits.push(r.level === 0 ? "cantrip l0 level 0" : `l${r.level} level ${r.level}`);
    }
    bits.push(r.school, r.schoolZh, r.classLists);
    if (r.concentration) bits.push("concentration");
    if (r.ritual) bits.push("ritual");
  } else {
    bits.push(r.category, r.attackMode, r.attackAbility, r.properties);
  }
  return bits.filter(Boolean).join(" ").toLowerCase();
}

const HAYSTACKS = new Map(LIBRARY.map((e) => [e.id, entryHaystack(e)]));

const PAGE = 50;

/**
 * Searchable browser over the weapons + spells database (LIBRARY). 416 entries
 * is too many for one-click buttons, so: a kind filter + multi-field text
 * search (see entryHaystack — "L4" lists all level-4 spells, "wizard fire"
 * works too) + a paged result list that expands 50 at a time. Clicking + adds
 * the entry as a recipe draft (DM then fills in attack mod / DC / damage mod).
 */
function LibraryPicker({
  onAdd,
}: {
  onAdd?: (recipe: RecipeDraft) => void;
}) {
  const msg = useT();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "weapon" | "spell">("all");
  const [limit, setLimit] = useState(PAGE);
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = LIBRARY.filter((e) => {
    if (kind !== "all" && e.kind !== kind) return false;
    if (terms.length === 0) return true;
    const hay = HAYSTACKS.get(e.id) ?? "";
    return terms.every((t) => hay.includes(t));
  });
  const shown = matches.slice(0, limit);
  return (
    <details style={{ marginTop: "0.3em" }}>
      <summary>
        {msg.sheet.fromLibrary} <em>{msg.sheet.matchCount(matches.length)}</em>
      </summary>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.2em", marginTop: "0.2em" }}>
        <div>
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as "all" | "weapon" | "spell");
              setLimit(PAGE);
            }}
            aria-label="library kind filter"
          >
            <option value="all">{msg.sheet.libAll}</option>
            <option value="weapon">{msg.sheet.libWeapons}</option>
            <option value="spell">{msg.sheet.libSpells}</option>
          </select>{" "}
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
            placeholder={msg.sheet.searchPlaceholder}
            size={22}
            aria-label="library search"
          />
        </div>
        <div style={{ maxHeight: "12em", overflowY: "auto", border: "1px solid #ddd", padding: "0.2em" }}>
          {shown.length === 0 && <span style={{ color: "#888" }}>{msg.sheet.noMatches}</span>}
          {shown.map((e) => (
            <div key={e.id} style={{ marginBottom: "0.1em" }}>
              <button
                onClick={() => onAdd?.(toRecipeDraft(e))}
                aria-label={`add ${e.name} from library`}
                style={{ marginRight: "0.2em" }}
              >
                +
              </button>
              <span title={entryTitle(e)}>
                <strong>{e.name}</strong> <span style={{ color: "#888" }}>{e.nameZh}</span>{" "}
                <em style={{ color: "#555" }}>{entrySummary(e, msg)}</em>
              </span>
            </div>
          ))}
          {matches.length > limit && (
            <div style={{ color: "#888" }}>
              {msg.sheet.moreCount(matches.length - limit)}
              <button onClick={() => setLimit(limit + PAGE)} aria-label="show more library results">
                {msg.sheet.showMore(Math.min(PAGE, matches.length - limit))}
              </button>
            </div>
          )}
        </div>
      </div>
    </details>
  );
}

/** Short one-line summary of a library entry for the picker list. */
function entrySummary(e: LibraryEntry, msg: Messages): string {
  const dice = e.damageDice.map((d) => `${d.count}${d.type}`).join("+");
  const parts: string[] = [e.hitType];
  if (e.kind === "spell") {
    const lvl = e.ref.level === 0 ? "cantrip" : e.ref.level != null ? `L${e.ref.level}` : "";
    if (lvl) parts.push(lvl);
    if (e.ref.school) parts.push(e.ref.school);
  } else {
    if (e.ref.category) parts.push(e.ref.category);
  }
  if (dice) parts.push(`${dice}${e.damageMod ? `+${e.damageMod}` : ""}`);
  if (e.damageType) parts.push(damageTypeLabel(msg, e.damageType));
  if (e.hitType === "save" && e.saveAbility) parts.push(`DC·${saveAbilityLabel(msg, e.saveAbility)}`);
  if (e.multiTarget === "aoe") parts.push("AoE");
  if (e.multiTarget === "darts") parts.push("darts");
  if (e.appliesMods.length > 0) parts.push(`${msg.sheet.grants} ${summarizeMods(e.appliesMods, msg)}`);
  return parts.join(" · ");
}

/** Full reference string for the hover tooltip. */
function entryTitle(e: LibraryEntry): string {
  const r = e.ref;
  const bits: string[] = [];
  if (e.kind === "spell") {
    bits.push(
      [
        r.level === 0 ? "cantrip" : r.level != null ? `level ${r.level}` : "",
        r.schoolZh,
        r.school,
      ]
        .filter(Boolean)
        .join(" "),
    );
    if (r.castingTime) bits.push(`cast ${r.castingTime}`);
    if (r.range) bits.push(`range ${r.range}`);
    if (r.components) bits.push(`comp ${r.components}`);
    if (r.duration) bits.push(`dur ${r.duration}`);
    if (r.concentration) bits.push("concentration");
    if (r.ritual) bits.push("ritual");
    if (r.classLists) bits.push(`classes ${r.classLists}`);
  } else {
    if (r.attackMode) bits.push(r.attackMode);
    if (r.attackAbility) bits.push(`ability ${r.attackAbility}`);
    if (r.properties) bits.push(r.properties);
    if (r.versatile) bits.push(`versatile ${r.versatile}`);
    if (r.normalRange) bits.push(`range ${r.normalRange}/${r.longRange ?? ""}`);
  }
  if (r.diceRaw) bits.push(`dice ${r.diceRaw}`);
  if (r.note) bits.push(r.note);
  return bits.join(" · ");
}

/** Custom recipe add form. */
function RecipeAddForm({
  resources,
  onAdd,
}: {
  resources: CombatantView["resources"];
  onAdd?: (recipe: RecipeDraft) => void;
}) {
  const msg = useT();
  const [draft, setDraft] = useState<RecipeDraft>(blankRecipe());
  const set = <K extends keyof RecipeDraft>(k: K, v: RecipeDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));
  return (
    <details style={{ marginTop: "0.3em" }}>
      <summary>{msg.sheet.customRecipe}</summary>
      <RecipeFormFields draft={draft} set={set} resources={resources} />
      <button onClick={() => onAdd?.(draft)}>{msg.sheet.addRecipe}</button>
    </details>
  );
}

/** Shared form fields for a RecipeDraft. */
function RecipeFormFields({
  draft,
  set,
  resources = [],
}: {
  draft: RecipeDraft;
  set: <K extends keyof RecipeDraft>(k: K, v: RecipeDraft[K]) => void;
  resources?: CombatantView["resources"];
}) {
  const msg = useT();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.2em" }}>
      <label>
        {msg.sheet.nameLabel}{" "}
        <input value={draft.name} onChange={(e) => set("name", e.target.value)} size={14} />
      </label>
      <label>
        {msg.sheet.hitTypeLabel}{" "}
        <select value={draft.hitType} onChange={(e) => set("hitType", e.target.value as HitType)}>
          <option value="attack">{msg.sheet.hitTypeAttack}</option>
          <option value="save">{msg.sheet.hitTypeSave}</option>
          <option value="automatic">{msg.sheet.hitTypeAuto}</option>
        </select>
      </label>
      <label>
        {msg.sheet.multiTargetLabel}{" "}
        <select
          value={draft.multiTarget}
          onChange={(e) => set("multiTarget", e.target.value as RecipeDraft["multiTarget"])}
        >
          <option value="none">{msg.sheet.multiTargetNone}</option>
          <option value="aoe">{msg.sheet.multiTargetAoe}</option>
          <option value="darts">{msg.sheet.multiTargetDarts}</option>
        </select>
      </label>
      {draft.hitType === "attack" && (
        <label>
          {msg.confirm.attackMod}{" "}
          <input type="number" value={draft.attackMod} onChange={(e) => set("attackMod", Number(e.target.value))} style={{ width: "4em" }} />
        </label>
      )}
      {draft.hitType === "save" && (
        <label>
          {msg.sheet.dcSaveAbility}{" "}
          <input type="number" value={draft.dc} onChange={(e) => set("dc", Number(e.target.value))} style={{ width: "4em" }} />
          <input value={draft.saveAbility} onChange={(e) => set("saveAbility", e.target.value)} size={5} placeholder="dex" />
        </label>
      )}
      <label>
        {msg.sheet.damageDice}{" "}
        <DiceTermsInput terms={draft.damageDice} onChange={(t) => set("damageDice", t)} />
      </label>
      <label>
        {msg.confirm.damageMod}{" "}
        <input type="number" value={draft.damageMod} onChange={(e) => set("damageMod", Number(e.target.value))} style={{ width: "4em" }} />
      </label>
      <label>
        {msg.confirm.damageType}{" "}
        <select value={draft.damageType} onChange={(e) => set("damageType", e.target.value)}>
          {DAMAGE_TYPES.map((t) => (
            <option key={t} value={t}>
              {damageTypeLabel(msg, t)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {msg.sheet.consumes}{" "}
        <select
          value={draft.resourceId ?? ""}
          onChange={(e) => set("resourceId", e.target.value === "" ? undefined : e.target.value)}
          aria-label="recipe consumes resource"
        >
          <option value="">{msg.sheet.noPool}</option>
          {(resources ?? []).map((r) => (
            <option key={r._id} value={r._id}>
              {r.label} ({r.current}/{r.max})
            </option>
          ))}
        </select>{" "}
        {msg.sheet.cost}{" "}
        <input type="number" value={draft.resourceCost} onChange={(e) => set("resourceCost", Number(e.target.value))} style={{ width: "4em" }} aria-label="recipe resource cost" />
      </label>
      <label>
        <input type="checkbox" checked={draft.critImmune} onChange={(e) => set("critImmune", e.target.checked)} />
        {msg.sheet.critImmune}
      </label>
      <AppliesModsEditor mods={draft.appliesMods} onChange={(mods) => set("appliesMods", mods)} />
      <ExtraRollsEditor rolls={draft.extraRolls} onChange={(rolls) => set("extraRolls", rolls)} />
    </div>
  );
}

/** Short label for one modifier spec, e.g. "+5 AC", "advantage attack", "治療 1d8+3". */
function summarizeMod(m: ModifierSpec, msg: Messages): string {
  const self = m.direction === "self" ? msg.sheet.toSelfPrefix : "";
  if (m.stat === "healing" || m.stat === "tempHp") {
    const dice = (m.dice ?? []).map((d) => `${d.count}${d.type}`).join("+");
    const amount =
      dice === "" ? `${m.value}` : m.value === 0 ? dice : `${dice}${m.value > 0 ? "+" : ""}${m.value}`;
    return `${self}${m.stat === "healing" ? msg.confirm.heal : msg.confirm.tempHpWord} ${amount}`;
  }
  if (m.mode === "advantage" || m.mode === "disadvantage") return `${self}${m.mode} ${m.stat}`;
  return `${self}${m.value >= 0 ? "+" : ""}${m.value} ${m.stat}`;
}

function summarizeMods(mods: readonly ModifierSpec[], msg: Messages): string {
  return mods.map((m) => summarizeMod(m, msg)).join(", ");
}

/** Short label for one extra roll, e.g. "Push (d4, roleplay)" or "Sneak Attack (2d6, battle)". */
function summarizeExtraRoll(r: ExtraRoll, msg: Messages): string {
  const dice = r.dice.map((d) => `${d.count}${d.type}`).join("+");
  return `${r.label || msg.confirm.untitled} (${dice}, ${r.usage})`;
}

function summarizeExtraRolls(rolls: readonly ExtraRoll[], msg: Messages): string {
  return rolls.map((r) => summarizeExtraRoll(r, msg)).join(", ");
}

/**
 * Edit the modifier specs a recipe APPLIES on Confirm. Each row is directed at
 * the confirmed targets (default, adjustable per target at Confirm) or the
 * actor ("自身"). Non-healing rows reuse the #5 Modifier model — same stat/mode
 * vocabulary as the combatant's Conditions/Modifiers column — and become one
 * toggleable chip per recipient. A 治療 row is an instant heal instead:
 * actor-claimed dice + a flat number, full amount to each recipient, no chip.
 */
function AppliesModsEditor({
  mods,
  onChange,
}: {
  mods: ModifierSpec[];
  onChange: (mods: ModifierSpec[]) => void;
}) {
  const msg = useT();
  const set = (i: number, patch: Partial<ModifierSpec>) =>
    onChange(mods.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  const remove = (i: number) => onChange(mods.filter((_, idx) => idx !== i));
  const add = () => onChange([...mods, { stat: "ac", mode: "bonus", value: 0 }]);
  const stats = Object.keys(STAT_LABELS) as Stat[];
  const modes = Object.keys(MODE_LABELS) as Mode[];
  return (
    <fieldset>
      <legend>{msg.confirm.appliedMods}</legend>
      {mods.map((m, i) => (
        <div key={i} style={{ marginBottom: "0.2em" }}>
          <select
            value={m.stat}
            onChange={(e) => {
              const stat = e.target.value as ModifierSpec["stat"];
              // Instant rows (healing/tempHp) are always bonus-mode (dice +
              // flat); dice only belong to instant rows.
              const instant = stat === "healing" || stat === "tempHp";
              set(i, instant ? { stat, mode: "bonus" } : { stat, dice: undefined });
            }}
            aria-label={`mod stat ${i}`}
          >
            {stats.map((s) => (
              <option key={s} value={s}>
                {statLabel(msg, s)}
              </option>
            ))}
            <option value="healing">{msg.sheet.healingInstant}</option>
            <option value="tempHp">{msg.sheet.tempHpInstant}</option>
          </select>{" "}
          {m.stat === "healing" || m.stat === "tempHp" ? (
            <>
              <DiceTermsInput terms={m.dice ?? []} onChange={(t) => set(i, { dice: t })} />{" "}
              <input
                type="number"
                value={m.value}
                onChange={(e) => set(i, { value: Number(e.target.value) })}
                style={{ width: "4em" }}
                aria-label={`mod value ${i}`}
              />
            </>
          ) : (
            <>
              <select value={m.mode} onChange={(e) => set(i, { mode: e.target.value as Mode })} aria-label={`mod mode ${i}`}>
                {modes.map((md) => (
                  <option key={md} value={md}>
                    {modeLabel(msg, md)}
                  </option>
                ))}
              </select>{" "}
              {(m.mode === "bonus" || m.mode === "override") && (
                <input
                  type="number"
                  value={m.value}
                  onChange={(e) => set(i, { value: Number(e.target.value) })}
                  style={{ width: "4em" }}
                  aria-label={`mod value ${i}`}
                />
              )}
            </>
          )}{" "}
          <select
            value={m.direction ?? "targets"}
            onChange={(e) => set(i, { direction: e.target.value as ModifierSpec["direction"] })}
            aria-label={`mod direction ${i}`}
            title={msg.sheet.directionTitle}
          >
            <option value="targets">{msg.sheet.toTargets}</option>
            <option value="self">{msg.sheet.toSelf}</option>
          </select>{" "}
          <input
            value={m.note ?? ""}
            onChange={(e) => set(i, { note: e.target.value })}
            size={14}
            placeholder={msg.sheet.notePlaceholder}
            aria-label={`mod note ${i}`}
          />{" "}
          <button onClick={() => remove(i)} aria-label={`remove mod ${i}`}>
            ×
          </button>
        </div>
      ))}
      <button onClick={add}>{msg.sheet.addMod}</button>
    </fieldset>
  );
}

/**
 * Edit a recipe's extra dice rolls: rolled alongside the main roll (after the
 * main damage dice), each either `roleplay` (claimed + logged, no math — e.g.
 * a d4 to decide which way to push something) or `battle` (a second damage
 * roll with its own dice/mod/damage type, added to the target's damage on the
 * same hit/save result as the main roll — an elemental rider, Sneak Attack, …;
 * the 治療 type heals the target instead, with the same gating).
 */
function ExtraRollsEditor({
  rolls,
  onChange,
}: {
  rolls: ExtraRoll[];
  onChange: (rolls: ExtraRoll[]) => void;
}) {
  const msg = useT();
  const set = (i: number, patch: Partial<ExtraRoll>) =>
    onChange(rolls.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(rolls.filter((_, idx) => idx !== i));
  const add = () =>
    onChange([
      ...rolls,
      { label: "", usage: "roleplay", dice: [{ type: "d4", count: 1 }], damageMod: 0, damageType: DAMAGE_TYPES[0] },
    ]);
  return (
    <fieldset>
      <legend>{msg.sheet.extraRollsLegend}</legend>
      {rolls.map((r, i) => (
        <div key={i} style={{ marginBottom: "0.2em" }}>
          <input
            value={r.label}
            onChange={(e) => set(i, { label: e.target.value })}
            placeholder={msg.sheet.extraLabelPlaceholder}
            size={16}
            aria-label={`extra roll label ${i}`}
          />{" "}
          <select
            value={r.usage}
            onChange={(e) => set(i, { usage: e.target.value as ExtraRollUsage })}
            aria-label={`extra roll usage ${i}`}
          >
            <option value="roleplay">roleplay (flavor only)</option>
            <option value="battle">battle (2nd damage roll)</option>
          </select>{" "}
          <DiceTermsInput terms={r.dice} onChange={(t) => set(i, { dice: t })} />
          {r.usage === "battle" && (
            <>
              {" "}
              <label>
                mod{" "}
                <input
                  type="number"
                  value={r.damageMod}
                  onChange={(e) => set(i, { damageMod: Number(e.target.value) })}
                  style={{ width: "4em" }}
                  aria-label={`extra roll mod ${i}`}
                />
              </label>{" "}
              <select
                value={r.damageType}
                onChange={(e) => set(i, { damageType: e.target.value })}
                aria-label={`extra roll damage type ${i}`}
              >
                {DAMAGE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {damageTypeLabel(msg, t)}
                  </option>
                ))}
              </select>
            </>
          )}{" "}
          <button onClick={() => remove(i)} aria-label={`remove extra roll ${i}`}>
            ×
          </button>
        </div>
      ))}
      <button onClick={add}>+ extra roll</button>
    </fieldset>
  );
}

/** Edit a list of {type, count} dice terms via a text box like "2d6+1d8". */
function DiceTermsInput({
  terms,
  onChange,
}: {
  terms: RecipeDraft["damageDice"];
  onChange: (t: RecipeDraft["damageDice"]) => void;
}) {
  const [text, setText] = useState(terms.map((t) => `${t.count}${t.type}`).join("+"));
  const parse = (s: string): RecipeDraft["damageDice"] => {
    const out: RecipeDraft["damageDice"] = [];
    for (const part of s.split("+")) {
      const m = part.trim().match(/^(\d+)\s*(d\d+|d100)$/i);
      if (m) out.push({ count: Number(m[1]), type: m[2].toLowerCase() as RecipeDraft["damageDice"][number]["type"] });
    }
    return out;
  };
  return (
    <input
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parse(e.target.value));
      }}
      size={10}
      placeholder="2d6"
      aria-label="damage dice"
    />
  );
}

function blankRecipe(): RecipeDraft {
  return {
    name: "",
    hitType: "attack",
    attackMod: 0,
    damageDice: [{ type: "d6", count: 1 }],
    damageMod: 0,
    damageType: "slashing",
    dc: 10,
    saveAbility: "dex",
    critImmune: false,
    resourceCost: 0,
    multiTarget: "none",
    appliesMods: [],
    extraRolls: [],
  };
}
