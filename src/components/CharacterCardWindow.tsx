import { useEffect, useRef, useState, type ReactNode } from "react";
import { SafeMarkdown } from "./SafeMarkdown";
import { useT } from "../i18n";
import { abilityLabel, skillLabel } from "../i18n/terms";
import { clampedDragPos } from "./windowState";
import { downloadCard } from "../lib/cardFile";
import "./CharacterCardWindow.css";
import type {
  AbilityView,
  CharacterCardPatch,
  CharacterView,
  RefSection,
} from "../../convex/characters";
import type { CombatantView } from "../../convex/games";
import type { RecipeDraft } from "../../convex/recipeLibrary";
import {
  ResourcesSection,
  RecipesSection,
  RVISection,
} from "./CombatantSheet";
import {
  ABILITY_KEYS,
  SKILLS,
  defaultSaves,
  defaultSkills,
  modFor,
  modByKey,
  nextSkillProf,
  pbForLevel,
  recalcCard,
  saveTotal,
  skillTotal,
  spellAttackFn,
  spellDcFn,
  type SaveRow,
  type SkillRow,
} from "../lib/dndCalc";

/**
 * Issue #9 step 4 — a floating parchment character-card window (gothic horror,
 * grilling Q5/Q9). Draggable / foldable / z-layerable (reuses the prototype's
 * proven pointer-capture drag + z-order machinery, rewritten as a real comp).
 *
 * The card's own fields are a **draft + one dirty-fields-only Save** (Q2: sync
 * lag must not fight typing; Save sends only touched fields so it can't clobber
 * concurrent combat writes). The embedded sheet (Resources / Recipes / R-V-I)
 * is the **combat surface** — those write through immediately, only the card's
 * own fields are draft-gated. R/V/I renders only when the card is linked to a
 * combatant in this Game (linked-only decision); unlinked cards omit it.
 */

/** Window geometry + state, owned by the global window manager in GameShell. */
export type CardWindow = {
  x: number;
  y: number;
  z: number;
  folded: boolean;
};

/** Handlers the card window needs from the page (all role-open). */
export type CharacterCardWindowProps = {
  character: CharacterView;
  /** The linked combatant in THIS Game, or null when the card isn't in battle. */
  combatant: CombatantView | null;
  win: CardWindow;
  inBattle: boolean;
  /**
   * A demo card on the public playground (design D3): the server refuses to
   * write it, so the editor says so up front rather than letting someone type
   * for ten minutes into a Save that was never going to land. Display only —
   * the refusal is server-side, so flipping this in a devtools console buys a
   * Save button that still fails.
   */
  readOnly?: boolean;
  onDrag: (x: number, y: number) => void;
  onFocus: () => void;
  onFold: () => void;
  onClose: () => void;
  onUpdateCharacter: (characterId: string, patch: CharacterCardPatch) => void;
  onJoinBattle: (characterId: string) => void;
  // Character-owned sheet (write-through):
  onAddResource: (label: string, max: number) => void;
  onUpdateResource: (
    resourceId: string,
    patch: { label?: string; current?: number; max?: number },
  ) => void;
  onRemoveResource: (resourceId: string) => void;
  onAddRecipe: (recipe: RecipeDraft) => void;
  onUpdateRecipe: (recipeId: string, recipe: RecipeDraft) => void;
  onRemoveRecipe: (recipeId: string) => void;
  // Linked-combatant R/V/I patch (combatant-owned; only used when in battle):
  onPatchCombatant?: (
    patch: Partial<{ resist: string[]; vuln: string[]; immune: string[] }>,
  ) => void;
};

/** Editable scalar card fields held as strings (uniform input binding). */
const SCALAR_FIELDS = [
  "player",
  "nameZh",
  "nameEn",
  "race",
  "classesText",
  "level",
  "alignment",
  "statusText",
  "hp",
  "maxHp",
  "ac",
  "acFormula",
  "speedText",
  "initBonus",
  "pb",
  "spellcastingAbility",
  "spellAttack",
  "spellDc",
  "attackText",
  "toolsText",
  "goldText",
  "story",
] as const;
type ScalarField = (typeof SCALAR_FIELDS)[number];

/** Scalar fields stored as numbers (converted on Save). */
const NUMBER_FIELDS = new Set<ScalarField>([
  "level",
  "hp",
  "maxHp",
  "ac",
  "initBonus",
  "pb",
  "spellAttack",
  "spellDc",
]);

type Draft = {
  scalars: Record<ScalarField, string>;
  abilities: AbilityView[];
  saves: SaveRow[];
  skills: SkillRow[];
  refs: RefSection[];
  classRules: string[];
};

/**
 * Build the draft from a (possibly migrated) character view. Structured
 * saves/skills default from the dndCalc templates when absent, with totals
 * computed from the current mods+pb so a migrated card shows correct numbers
 * immediately (Save persists them; 重算 also backfills).
 */
function snapshot(c: CharacterView): Draft {
  const mods = modByKey(c.abilities ?? []);
  const pb = c.pb ?? 0;
  // Be defensive against deploy skew: the backend may briefly serve an older
  // card shape without the structured saves/skills/spell fields (undefined).
  // Default them from the dndCalc templates so the card never crashes.
  const savesSrc = c.saves ?? [];
  const saves =
    savesSrc.length === 6
      ? savesSrc.map((s) => ({ ...s }))
      : defaultSaves(mods, pb);
  const skillsSrc = c.skills ?? [];
  const skills =
    skillsSrc.length === SKILLS.length
      ? skillsSrc.map((s) => ({ ...s }))
      : defaultSkills(mods, pb);
  return {
    scalars: {
      player: c.player ?? "",
      nameZh: c.nameZh ?? "",
      nameEn: c.nameEn ?? "",
      race: c.race ?? "",
      classesText: c.classesText ?? "",
      level: String(c.level ?? 0),
      alignment: c.alignment ?? "",
      statusText: c.statusText ?? "",
      hp: String(c.hp ?? 0),
      maxHp: String(c.maxHp ?? 0),
      ac: String(c.ac ?? 0),
      acFormula: c.acFormula ?? "",
      speedText: c.speedText ?? "",
      initBonus: String(c.initBonus ?? 0),
      pb: String(pb),
      spellcastingAbility: c.spellcastingAbility ?? "",
      spellAttack: String(c.spellAttack ?? 0),
      spellDc: String(c.spellDc ?? 0),
      attackText: c.attackText ?? "",
      toolsText: c.toolsText ?? "",
      goldText: c.goldText ?? "",
      story: c.story ?? "",
    },
    abilities: (c.abilities ?? []).map((a) => ({ ...a })),
    saves,
    skills,
    refs: (c.refs ?? []).map((r) => ({ ...r })),
    classRules: [...(c.classRules ?? [])],
  };
}

/** Shallow deep-equal for small arrays/objects (abilities, refs). */
function sameArr<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => JSON.stringify(x) === JSON.stringify(b[i]));
}

export function CharacterCardWindow({
  character: c,
  combatant,
  win,
  inBattle,
  readOnly = false,
  onDrag,
  onFocus,
  onFold,
  onClose,
  onUpdateCharacter,
  onJoinBattle,
  onAddResource,
  onUpdateResource,
  onRemoveResource,
  onAddRecipe,
  onUpdateRecipe,
  onRemoveRecipe,
  onPatchCombatant,
}: CharacterCardWindowProps) {
  const t = useT();
  const [draft, setDraft] = useState<Draft>(() => snapshot(c));
  // Last server-synced snapshot; tells "user edited" from "server changed" so
  // we never clobber unsaved typing (CombatantRow baseRef pattern).
  const baseRef = useRef<Draft>(snapshot(c));
  // Per-block Markdown preview toggle (法術/特性 refs, 職業特殊規則) — UI-only,
  // keyed by array index, never persisted.
  const [refPreview, setRefPreview] = useState<Record<number, boolean>>({});
  // Default each 職業特殊規則 block that already has text to preview (rendered
  // Markdown) rather than the raw textarea — it's usually read, not edited. New
  // (empty) blocks stay in edit mode. Local UI-only, never persisted.
  const [classRulePreview, setClassRulePreview] = useState<Record<number, boolean>>(
    () =>
      Object.fromEntries(
        (c.classRules ?? []).map((body, i) => [i, body.trim() !== ""]),
      ),
  );

  // Adopt remote changes for fields the user isn't currently editing. Scalars
  // adopt per-field; abilities/saves/skills/refs adopt only if untouched
  // (deep-equal to base).
  useEffect(() => {
    const next = snapshot(c);
    const base = baseRef.current;
    setDraft((prev) => {
      const scalars = { ...prev.scalars };
      let changed = false;
      for (const f of SCALAR_FIELDS) {
        if (next.scalars[f] !== base.scalars[f] && prev.scalars[f] === base.scalars[f]) {
          scalars[f] = next.scalars[f];
          changed = true;
        }
      }
      const adopt = <T,>(prevArr: T[], baseArr: T[], nextArr: T[]): T[] =>
        sameArr(prevArr, baseArr) && !sameArr(baseArr, nextArr) ? nextArr : prevArr;
      const abilities = adopt(prev.abilities, base.abilities, next.abilities);
      const saves = adopt(prev.saves, base.saves, next.saves);
      const skills = adopt(prev.skills, base.skills, next.skills);
      const refs = adopt(prev.refs, base.refs, next.refs);
      const classRules = adopt(prev.classRules, base.classRules, next.classRules);
      if (abilities !== prev.abilities) changed = true;
      if (saves !== prev.saves) changed = true;
      if (skills !== prev.skills) changed = true;
      if (refs !== prev.refs) changed = true;
      if (classRules !== prev.classRules) changed = true;
      return changed ? { scalars, abilities, saves, skills, refs, classRules } : prev;
    });
    baseRef.current = next;
  }, [
    c.player,
    c.nameZh,
    c.nameEn,
    c.race,
    c.classesText,
    c.level,
    c.alignment,
    c.statusText,
    c.hp,
    c.maxHp,
    c.ac,
    c.acFormula,
    c.speedText,
    c.initBonus,
    c.pb,
    c.spellcastingAbility,
    c.spellAttack,
    c.spellDc,
    c.attackText,
    c.toolsText,
    c.goldText,
    c.story,
    c.abilities,
    c.saves,
    c.skills,
    c.refs,
    c.classRules,
  ]);

  const base = baseRef.current;
  const dirtyScalars = SCALAR_FIELDS.filter(
    (f) => draft.scalars[f] !== base.scalars[f],
  );
  const dirtyAbilities = !sameArr(draft.abilities, base.abilities);
  const dirtySaves = !sameArr(draft.saves, base.saves);
  const dirtySkills = !sameArr(draft.skills, base.skills);
  const dirtyRefs = !sameArr(draft.refs, base.refs);
  const dirtyClassRules = !sameArr(draft.classRules, base.classRules);
  const isDirty =
    dirtyScalars.length > 0 ||
    dirtyAbilities ||
    dirtySaves ||
    dirtySkills ||
    dirtyRefs ||
    dirtyClassRules;

  /** Recompute the saves/skills/spell/init that depend on one ability's mod. */
  const recomputeDependents = (d: Draft, key: string, mod: number): Partial<Draft> => {
    const pb = Number(d.scalars.pb) || 0;
    const saves = d.saves.map((s) =>
      s.key === key ? { ...s, total: saveTotal(mod, pb, s.prof) } : s,
    );
    const skills = d.skills.map((s) =>
      s.ability === key ? { ...s, total: skillTotal(mod, pb, s.prof) } : s,
    );
    const scalars = { ...d.scalars };
    if (key === "敏捷") scalars.initBonus = String(mod);
    if (d.scalars.spellcastingAbility === key) {
      scalars.spellAttack = String(spellAttackFn(mod, pb));
      scalars.spellDc = String(spellDcFn(mod, pb));
    }
    return { saves, skills, scalars };
  };

  // --- Input handlers (auto-calc + overrideable) -----------------------------
  // Editing an INPUT (score, pb, proficiency, spellcasting ability) recomputes
  // only the dependent derived values — manual overrides on unrelated fields
  // survive. Editing a derived value directly (mod, a total, spellAttack/Dc,
  // initBonus) is a manual override that sticks until its own input changes.

  const setScalar = (f: ScalarField, v: string) =>
    setDraft((d) => ({ ...d, scalars: { ...d.scalars, [f]: v } }));

  const setAbilityKey = (i: number, key: string) =>
    setDraft((d) => ({
      ...d,
      abilities: d.abilities.map((a, idx) => (idx === i ? { ...a, key } : a)),
    }));

  /** Score change → auto-sync mod + recompute dependents (overrides stick
   *  until the score changes again). */
  const setAbilityScore = (i: number, score: number) =>
    setDraft((d) => {
      const key = d.abilities[i].key;
      const mod = modFor(score);
      const abilities = d.abilities.map((a, idx) =>
        idx === i ? { ...a, score, mod } : a,
      );
      return { ...d, abilities, ...recomputeDependents(d, key, mod) };
    });

  /** Manual mod override → propagate to dependents (they track the live mod). */
  const setAbilityMod = (i: number, mod: number) =>
    setDraft((d) => {
      const key = d.abilities[i].key;
      const abilities = d.abilities.map((a, idx) => (idx === i ? { ...a, mod } : a));
      return { ...d, abilities, ...recomputeDependents(d, key, mod) };
    });

  /** The PB cascade: recompute all save/skill totals + spell numbers for a new
   *  pb (mods/init don't depend on PB, so they're left untouched). */
  const cascadePb = (d: Draft, pb: number): Draft => {
    const mods = modByKey(d.abilities);
    const scalars = { ...d.scalars, pb: String(pb) };
    const saves = d.saves.map((s) => ({
      ...s,
      total: saveTotal(mods[s.key] ?? 0, pb, s.prof),
    }));
    const skills = d.skills.map((s) => ({
      ...s,
      total: skillTotal(mods[s.ability] ?? 0, pb, s.prof),
    }));
    const sa = d.scalars.spellcastingAbility;
    if (sa) {
      const sm = mods[sa] ?? 0;
      scalars.spellAttack = String(spellAttackFn(sm, pb));
      scalars.spellDc = String(spellDcFn(sm, pb));
    }
    return { ...d, scalars, saves, skills };
  };

  /** Manual PB override → cascade (sticks until level changes again). */
  const setPb = (pb: number) => setDraft((d) => cascadePb(d, pb));

  /** Level change → pb = 2+⌊(lv−1)/4⌋ → full PB cascade. Only pb (and its
   *  dependents) derive from level; max HP / class resources also scale with
   *  level in 5e but depend on class composition, so they stay manual. */
  const setLevel = (v: string) =>
    setDraft((d) => {
      const next = cascadePb(d, pbForLevel(Number(v) || 1));
      return { ...next, scalars: { ...next.scalars, level: v } };
    });

  const toggleSave = (i: number) =>
    setDraft((d) => {
      const s = d.saves[i];
      const prof = !s.prof;
      const mod = modByKey(d.abilities)[s.key] ?? 0;
      const total = saveTotal(mod, Number(d.scalars.pb) || 0, prof);
      return {
        ...d,
        saves: d.saves.map((x, idx) => (idx === i ? { ...x, prof, total } : x)),
      };
    });

  const cycleSkill = (i: number) =>
    setDraft((d) => {
      const s = d.skills[i];
      const prof = nextSkillProf(s.prof);
      const mod = modByKey(d.abilities)[s.ability] ?? 0;
      const total = skillTotal(mod, Number(d.scalars.pb) || 0, prof);
      return {
        ...d,
        skills: d.skills.map((x, idx) => (idx === i ? { ...x, prof, total } : x)),
      };
    });

  /** Manual override of a single save/skill total (no recalc). */
  const setSaveTotal = (i: number, total: number) =>
    setDraft((d) => ({
      ...d,
      saves: d.saves.map((x, idx) => (idx === i ? { ...x, total } : x)),
    }));
  const setSkillTotal = (i: number, total: number) =>
    setDraft((d) => ({
      ...d,
      skills: d.skills.map((x, idx) => (idx === i ? { ...x, total } : x)),
    }));

  const setSpellcastingAbility = (a: string) =>
    setDraft((d) => {
      const scalars = { ...d.scalars, spellcastingAbility: a };
      if (a) {
        const mod = modByKey(d.abilities)[a] ?? 0;
        const pb = Number(d.scalars.pb) || 0;
        scalars.spellAttack = String(spellAttackFn(mod, pb));
        scalars.spellDc = String(spellDcFn(mod, pb));
      } else {
        scalars.spellAttack = "0";
        scalars.spellDc = "0";
      }
      return { ...d, scalars };
    });

  /** 重算 — full recompute from inputs (backfills migrated cards; resets every
   *  manual override on derived values). */
  const recalcAll = () =>
    setDraft((d) => {
      const card = recalcCard({
        abilities: d.abilities,
        level: Number(d.scalars.level) || 1,
        pb: Number(d.scalars.pb) || 0,
        initBonus: Number(d.scalars.initBonus) || 0,
        saves: d.saves,
        skills: d.skills,
        spellcastingAbility: d.scalars.spellcastingAbility,
        spellAttack: Number(d.scalars.spellAttack) || 0,
        spellDc: Number(d.scalars.spellDc) || 0,
      });
      return {
        ...d,
        abilities: card.abilities,
        saves: card.saves,
        skills: card.skills,
        scalars: {
          ...d.scalars,
          pb: String(card.pb),
          initBonus: String(card.initBonus),
          spellAttack: String(card.spellAttack),
          spellDc: String(card.spellDc),
        },
      };
    });

  const setRef = (i: number, patch: Partial<RefSection>) =>
    setDraft((d) => ({
      ...d,
      refs: d.refs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    }));
  const addRef = () =>
    setDraft((d) => ({ ...d, refs: [...d.refs, { title: "", body: "" }] }));
  const removeRef = (i: number) =>
    setDraft((d) => ({ ...d, refs: d.refs.filter((_, idx) => idx !== i) }));
  const toggleRefPreview = (i: number) =>
    setRefPreview((p) => ({ ...p, [i]: !p[i] }));

  const setClassRule = (i: number, body: string) =>
    setDraft((d) => ({
      ...d,
      classRules: d.classRules.map((r, idx) => (idx === i ? body : r)),
    }));
  const addClassRule = () =>
    setDraft((d) => ({ ...d, classRules: [...d.classRules, ""] }));
  const removeClassRule = (i: number) =>
    setDraft((d) => ({
      ...d,
      classRules: d.classRules.filter((_, idx) => idx !== i),
    }));
  const toggleClassRulePreview = (i: number) =>
    setClassRulePreview((p) => ({ ...p, [i]: !p[i] }));

  const save = () => {
    if (!isDirty) return;
    const patch: CharacterCardPatch = {};
    for (const f of dirtyScalars) {
      (patch as Record<string, unknown>)[f] = NUMBER_FIELDS.has(f)
        ? Number(draft.scalars[f])
        : draft.scalars[f];
    }
    if (dirtyAbilities) patch.abilities = draft.abilities;
    if (dirtySaves) patch.saves = draft.saves;
    if (dirtySkills) patch.skills = draft.skills;
    if (dirtyRefs) patch.refs = draft.refs;
    if (dirtyClassRules) patch.classRules = draft.classRules;
    onUpdateCharacter(c._id, patch);
  };

  const drag = useRef<{ dx: number; dy: number } | null>(null);

  return (
    <div
      className="ccw-card"
      style={{ left: win.x, top: win.y, zIndex: win.z }}
      onPointerDown={onFocus}
    >
      <div
        className="ccw-head"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          drag.current = { dx: e.clientX - win.x, dy: e.clientY - win.y };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current) {
            const { x, y } = clampedDragPos(e, drag.current);
            onDrag(x, y);
          }
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <span className="ccw-title">📜 {c.nameZh}</span>
        <button className="ccw-btn" style={{ padding: "0 .5em" }} onClick={() => onFold()} aria-label="fold card">
          {win.folded ? "▾" : "▴"}
        </button>
        <button className="ccw-btn" style={{ padding: "0 .5em" }} onClick={() => onClose()} aria-label="close card">
          ×
        </button>
      </div>
      {!win.folded && (
        <div className="ccw-body">
          {/* Masthead — the document's identity line. */}
          <div className="ccw-masthead">
            <div className="ccw-names">
              <input
                className="ccw-name-zh"
                value={draft.scalars.nameZh}
                onChange={(e) => setScalar("nameZh", e.target.value)}
                aria-label="name zh"
              />
              <input
                className="ccw-name-en"
                value={draft.scalars.nameEn}
                onChange={(e) => setScalar("nameEn", e.target.value)}
                aria-label="name en"
              />
            </div>
            <div className="ccw-idgrid">
              <Field label={t.card.player}>
                <CardInput value={draft.scalars.player} onChange={(v) => setScalar("player", v)} ariaLabel="player" />
              </Field>
              <Field label={t.card.race}>
                <CardInput value={draft.scalars.race} onChange={(v) => setScalar("race", v)} ariaLabel="race" />
              </Field>
              <Field label={t.card.level}>
                <CardInput value={draft.scalars.level} onChange={setLevel} ariaLabel="level" />
              </Field>
              <Field label={t.card.alignment}>
                <CardInput value={draft.scalars.alignment} onChange={(v) => setScalar("alignment", v)} ariaLabel="alignment" />
              </Field>
              <Field label={t.card.status}>
                <CardInput value={draft.scalars.statusText} onChange={(v) => setScalar("statusText", v)} ariaLabel="status" />
              </Field>
              <Field label={t.card.classes} span3>
                <CardTextarea value={draft.scalars.classesText} onChange={(v) => setScalar("classesText", v)} ariaLabel="classes" />
              </Field>
            </div>
          </div>

          {/* Main grid — ability rail | saves+skills ledger | sheet | vitals rail
              (layout per docs/plans/ui-design-requirement-character-card.md). */}
          <div className="ccw-main">
            <div className="ccw-rail">
              {draft.abilities.map((a, i) => (
                <div key={i} className="ccw-ab-block">
                  <AbilityKeyInput
                    value={a.key}
                    onChange={(v) => setAbilityKey(i, v)}
                    ariaLabel={`ability ${i} key`}
                  />
                  <div className="ccw-ab-nums">
                    <input
                      className="ccw-ab-score"
                      type="number"
                      value={a.score}
                      onChange={(e) => setAbilityScore(i, Number(e.target.value))}
                      aria-label={`ability ${i} score`}
                    />
                    <input
                      className="ccw-ab-mod"
                      type="number"
                      value={a.mod}
                      onChange={(e) => setAbilityMod(i, Number(e.target.value))}
                      aria-label={`ability ${i} mod`}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="ccw-profcol">
              <div className="ccw-prof-head">{t.card.saves}</div>
              {draft.saves.map((s, i) => (
                <div className="ccw-prof-row" key={i}>
                  <label className="ccw-prof-name">
                    <input
                      type="checkbox"
                      checked={s.prof}
                      onChange={() => toggleSave(i)}
                      aria-label={`save ${i} prof`}
                    />{" "}
                    {abilityLabel(t, s.key)}
                  </label>
                  <span className="ccw-leader" />
                  <input
                    className="ccw-prof-total"
                    type="number"
                    value={s.total}
                    onChange={(e) => setSaveTotal(i, Number(e.target.value))}
                    aria-label={`save ${i} total`}
                  />
                </div>
              ))}
              <div className="ccw-prof-head">{t.card.skills}</div>
              {draft.skills.map((s, i) => (
                <div className="ccw-prof-row" key={i}>
                  <button
                    className={`ccw-prof-toggle prof-${s.prof}`}
                    onClick={() => cycleSkill(i)}
                    aria-label={`skill ${i} prof`}
                    title={s.prof === "none" ? t.card.profNone : s.prof === "proficient" ? t.card.profProficient : t.card.profExpert}
                  >
                    {s.prof === "none" ? "○" : s.prof === "proficient" ? "●" : "★"}
                  </button>
                  <span className="ccw-prof-name">{skillLabel(t, s.key)}</span>
                  <span className="ccw-leader" />
                  <input
                    className="ccw-prof-total"
                    type="number"
                    value={s.total}
                    onChange={(e) => setSkillTotal(i, Number(e.target.value))}
                    aria-label={`skill ${i} total`}
                  />
                </div>
              ))}
            </div>

            <div className="ccw-sheetcol">
              <ResourcesSection
                resources={c.resources}
                onAdd={onAddResource}
                onUpdate={onUpdateResource}
                onRemove={onRemoveResource}
              />
              <RecipesSection
                recipes={c.recipes}
                resources={c.resources}
                onAdd={onAddRecipe}
                onUpdate={onUpdateRecipe}
                onRemove={onRemoveRecipe}
              />
              {combatant && onPatchCombatant && (
                <RVISection combatant={combatant} onPatch={onPatchCombatant} />
              )}
            </div>

            <div className="ccw-rail">
              <Plaque label={t.card.hp}>
                <input
                  value={draft.scalars.hp}
                  onChange={(e) => setScalar("hp", e.target.value)}
                  aria-label="hp"
                />
                <span className="ccw-plaque-plus">/</span>
                <input
                  value={draft.scalars.maxHp}
                  onChange={(e) => setScalar("maxHp", e.target.value)}
                  aria-label="max hp"
                />
              </Plaque>
              <Plaque
                label={t.card.ac}
                cap={
                  <>
                    <input
                      value={draft.scalars.acFormula}
                      onChange={(e) => setScalar("acFormula", e.target.value)}
                      aria-label="ac formula"
                      title={draft.scalars.acFormula}
                    />
                    {combatant && <span className="ccw-eff">{t.card.effective} {combatant.effectiveAc?.value}</span>}
                  </>
                }
              >
                <input
                  value={draft.scalars.ac}
                  onChange={(e) => setScalar("ac", e.target.value)}
                  aria-label="ac"
                />
              </Plaque>
              <Plaque label={t.card.speed}>
                <input
                  className="wide"
                  value={draft.scalars.speedText}
                  onChange={(e) => setScalar("speedText", e.target.value)}
                  aria-label="speed"
                />
              </Plaque>
              <Plaque label={t.card.initiative}>
                <span className="ccw-plaque-plus">+</span>
                <input
                  value={draft.scalars.initBonus}
                  onChange={(e) => setScalar("initBonus", e.target.value)}
                  aria-label="init bonus"
                  title={t.card.initAutoTitle}
                />
              </Plaque>
              <Plaque label={t.card.pb}>
                <span className="ccw-plaque-plus">+</span>
                <input
                  value={draft.scalars.pb}
                  onChange={(e) => setPb(Number(e.target.value) || 0)}
                  aria-label="pb"
                  title={t.card.pbAutoTitle}
                />
              </Plaque>
              <Plaque label={t.card.spellAbility}>
                <select
                  value={draft.scalars.spellcastingAbility}
                  onChange={(e) => setSpellcastingAbility(e.target.value)}
                  aria-label="spellcasting ability"
                >
                  <option value="">{t.card.noneOption}</option>
                  {ABILITY_KEYS.map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              </Plaque>
              <Plaque label={t.card.spellAttack}>
                <span className="ccw-plaque-plus">+</span>
                <input
                  value={draft.scalars.spellAttack}
                  onChange={(e) => setScalar("spellAttack", e.target.value)}
                  aria-label="spell attack"
                />
              </Plaque>
              <Plaque label={t.card.spellDc}>
                <input
                  value={draft.scalars.spellDc}
                  onChange={(e) => setScalar("spellDc", e.target.value)}
                  aria-label="spell dc"
                />
              </Plaque>
            </div>
          </div>

          <h4>{t.card.attacksProfsWealth}</h4>
          <div className="ccw-misc">
            <Field label={t.card.attackNotes}>
              <CardInput value={draft.scalars.attackText} onChange={(v) => setScalar("attackText", v)} ariaLabel="attack" />
            </Field>
            <Field label={t.card.money}>
              <CardInput value={draft.scalars.goldText} onChange={(v) => setScalar("goldText", v)} ariaLabel="gold" />
            </Field>
          </div>
          <div className="ccw-ref">
            <div className="ccw-ref-head">
              <span className="ccw-block-title">{t.card.toolProfs}</span>
            </div>
            <textarea
              className="ccw-ref-body"
              value={draft.scalars.toolsText}
              onChange={(e) => setScalar("toolsText", e.target.value)}
              aria-label="tools"
            />
          </div>

          <h4>{t.card.spellsAndTraits}</h4>
          <div className="ccw-refs">
            {draft.refs.map((r, i) => (
              <div key={i} className="ccw-ref">
                <div className="ccw-ref-head">
                  <input
                    className="ccw-ref-title"
                    value={r.title}
                    onChange={(e) => setRef(i, { title: e.target.value })}
                    aria-label={`ref ${i} title`}
                  />
                  <PreviewToggle
                    previewing={!!refPreview[i]}
                    onToggle={() => toggleRefPreview(i)}
                    ariaLabel={`toggle ref ${i} preview`}
                  />
                  <button onClick={() => removeRef(i)} aria-label={`remove ref ${i}`}>
                    ×
                  </button>
                </div>
                <MarkdownBody
                  value={r.body}
                  onChange={(v) => setRef(i, { body: v })}
                  bodyAriaLabel={`ref ${i} body`}
                  previewing={!!refPreview[i]}
                />
              </div>
            ))}
          </div>
          <button onClick={addRef}>+ section</button>

          <h4>{t.card.classRules}</h4>
          <div className="ccw-class-rules">
            {draft.classRules.map((body, i) => (
              <div key={i} className="ccw-class-rule">
                <div className="ccw-ref-head">
                  <PreviewToggle
                    previewing={!!classRulePreview[i]}
                    onToggle={() => toggleClassRulePreview(i)}
                    ariaLabel={`toggle class rule ${i} preview`}
                  />
                  <button onClick={() => removeClassRule(i)} aria-label={`remove class rule ${i}`}>
                    ×
                  </button>
                </div>
                <MarkdownBody
                  value={body}
                  onChange={(v) => setClassRule(i, v)}
                  bodyAriaLabel={`class rule ${i} body`}
                  previewing={!!classRulePreview[i]}
                />
              </div>
            ))}
          </div>
          <button onClick={addClassRule}>+ section</button>

          <h4>{t.card.story}</h4>
          <textarea
            className="ccw-story"
            value={draft.scalars.story}
            onChange={(e) => setScalar("story", e.target.value)}
            aria-label="story"
          />
        </div>
      )}
      {!win.folded && readOnly && (
        <p className="ccw-readonly" role="note">
          <strong>{t.card.readOnly}</strong> {t.card.readOnlyHint}
        </p>
      )}
      {!win.folded && (
        <div className="ccw-foot">
          {isDirty && <span className="ccw-dirty">{t.card.unsaved}</span>}
          <button
            className="ccw-btn"
            onClick={() => downloadCard(c)}
            title={t.card.exportCardTitle}
            aria-label={`export ${c.nameZh}`}
          >
            {t.card.exportCard}
          </button>
          <button
            className="ccw-btn blood"
            onClick={() => onJoinBattle(c._id)}
            disabled={inBattle}
            title={inBattle ? t.card.inBattleTitle : t.card.joinBattleTitle}
          >
            {inBattle ? t.card.inBattle : t.card.joinBattle}
          </button>
          <button
            className="ccw-btn"
            onClick={recalcAll}
            title={t.card.recalcTitle}
            aria-label="recalc"
          >
            {t.card.recalc}
          </button>
          <button
            className="ccw-btn"
            onClick={save}
            disabled={!isDirty || readOnly}
            aria-label={`save ${c.nameZh}`}
          >
            {t.card.save}{isDirty ? " ●" : ""}
          </button>
        </div>
      )}
    </div>
  );
}

/** A small labeled field: printed-form caption above an ink line. */
function Field({
  label,
  span3,
  children,
}: {
  label: string;
  span3?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={`ccw-field${span3 ? " span3" : ""}`}>
      <span className="ccw-field-label">{label}</span>
      {children}
    </label>
  );
}

/** An engraved stat plaque: caption on top, big value, optional footnote. */
function Plaque({
  label,
  cap,
  children,
}: {
  label: string;
  cap?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="ccw-plaque">
      <span className="ccw-plaque-label">{label}</span>
      <span className="ccw-plaque-value">{children}</span>
      {cap != null && <span className="ccw-plaque-cap">{cap}</span>}
    </div>
  );
}

/**
 * Ability-key editor. The stored key stays the zh storage key (力量…, indexed
 * by saves/skills/condition specs) — blurred, the input shows the localized
 * display name; focused, it exposes the raw key so a manual rename edits
 * storage, never the translation.
 */
function AbilityKeyInput({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
}) {
  const t = useT();
  const [focused, setFocused] = useState(false);
  return (
    <input
      className="ccw-ab-key"
      value={focused ? value : abilityLabel(t, value)}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      aria-label={ariaLabel}
    />
  );
}

/** A text input bound to a scalar draft value. */
function CardInput({
  value,
  onChange,
  ariaLabel,
  narrow,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  narrow?: boolean;
}) {
  return (
    <input
      className="ccw-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      style={{ width: narrow ? "4em" : undefined }}
    />
  );
}

function CardTextarea({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
}) {
  return (
    <textarea
      className="ccw-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      rows={2}
    />
  );
}

/** A small 編輯/預覽 toggle button (法術/特性 refs, 職業特殊規則 — belongs in
 *  the block's header row, next to its remove button). */
function PreviewToggle({
  previewing,
  onToggle,
  ariaLabel,
}: {
  previewing: boolean;
  onToggle: () => void;
  ariaLabel: string;
}) {
  const t = useT();
  return (
    <button className="ccw-md-toggle" onClick={onToggle} aria-label={ariaLabel}>
      {previewing ? t.card.edit : t.card.preview}
    </button>
  );
}

/**
 * A note-block body that supports Markdown (法術/特性 refs, 職業特殊規則):
 * renders the raw textarea while editing, or the rendered Markdown (GFM —
 * tables/strikethrough/task lists) while previewing (toggled via
 * `PreviewToggle`) — so typing is never fought by a live-rendering view.
 */
function MarkdownBody({
  value,
  onChange,
  bodyAriaLabel,
  previewing,
}: {
  value: string;
  onChange: (v: string) => void;
  bodyAriaLabel: string;
  previewing: boolean;
}) {
  if (previewing) {
    return (
      <div className="ccw-ref-body ccw-md" data-testid={bodyAriaLabel}>
        <SafeMarkdown>{value}</SafeMarkdown>
      </div>
    );
  }
  return (
    <textarea
      className="ccw-ref-body"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={bodyAriaLabel}
    />
  );
}
