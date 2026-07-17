import { useEffect, useRef, useState } from "react";
import type { CombatantView } from "../../convex/games";
import type { EnemyFields } from "../../convex/enemyFields";
import { buildCombatantScalarChanges } from "./combatantScalarDraft";
import { PALETTE } from "../../convex/colors";
import { ColorSwatch } from "./ColorSwatch";
import { useT } from "../i18n";
import { EffectsCell, type EffectHandlers } from "./EffectsCell";
import { CombatantSheet, type RecipeHandlers, type ResourceHandlers } from "./CombatantSheet";

export type CombatantPatch = Partial<{
  name: string;
  color: string;
  hp: number;
  maxHp: number;
  /** 臨時生命值 (PHB p.198) — not clamped to maxHp. */
  tempHp: number;
  ac: number;
  initiative: number;
  notes: string;
  dmNotes: string;
  actionUsed: boolean;
  bonusUsed: boolean;
  reactionUsed: boolean;
  resist: string[];
  vuln: string[];
  immune: string[];
  conditionImmune: string[];
  /** Full 敵人庫 stat-block snapshot (on-field enemy editor). */
  statBlock: EnemyFields;
}>;

type Props = EffectHandlers & RecipeHandlers & ResourceHandlers & {
  combatant: CombatantView;
  isCurrentTurn: boolean;
  editable?: boolean;
  showDmNotes?: boolean;
  onPatch?: (patch: CombatantPatch) => void;
  onKill?: () => void;
  onRemove?: () => void;
  /** Open/focus this linked PC's floating card window (issue #9 step 4). */
  onOpenCard?: (characterId: string) => void;
  /** Open/focus this linked PC's read-only 職業特殊規則 pop-out. */
  onOpenClassRules?: (characterId: string) => void;
  /** Open/focus this enemy's floating editor window. */
  onOpenEnemyEditor?: () => void;
};

/** Editable scalar fields held in the row draft (strings for uniform input binding). */
type ScalarField = "hp" | "maxHp" | "tempHp" | "ac" | "initiative" | "notes" | "dmNotes";
type Draft = Record<ScalarField, string>;

const BASE_FIELDS: readonly ScalarField[] = [
  "hp",
  "maxHp",
  "tempHp",
  "ac",
  "initiative",
  "notes",
];
const DM_FIELDS: readonly ScalarField[] = [...BASE_FIELDS, "dmNotes"];

/** Snapshot a combatant's editable scalars into the string draft shape. */
function snapshot(c: CombatantView, withDm: boolean): Draft {
  return {
    hp: c.hp !== null ? String(c.hp) : "",
    maxHp: c.maxHp !== null ? String(c.maxHp) : "",
    tempHp: c.tempHp != null ? String(c.tempHp) : "",
    ac: c.ac !== null ? String(c.ac) : "",
    initiative: String(c.initiative),
    notes: c.notes,
    dmNotes: withDm ? (c.dmNotes ?? "") : "",
  };
}

/**
 * One combatant in the table. Editable by either role (open-buttons ethos):
 * anyone can edit any stat, override the Color, kill/revive, or remove —
 * manual override always wins (ADR-0002). The DM-only `dmNotes` column renders
 * only for the DM (`showDmNotes`); the backend never sends `dmNotes` to players.
 *
 * The typeable scalars (HP, Max HP, AC, Init, Notes — and DM Notes when shown)
 * are held in a single row-level draft and committed by one Save button at the
 * end of the row, instead of mutating per keystroke (which mangles text when
 * typing fast). Remote updates still flow in: a field is adopted from the
 * server whenever the user isn't mid-editing it.
 */
export function CombatantRow({
  combatant: c,
  isCurrentTurn,
  editable = false,
  showDmNotes = false,
  onPatch,
  onKill,
  onRemove,
  onOpenCard,
  onOpenClassRules,
  onOpenEnemyEditor,
  onApplyCondition,
  onAddCustom,
  onToggleEffect,
  onRemoveEffect,
  onAddResource,
  onUpdateResource,
  onRemoveResource,
  onAddRecipe,
  onUpdateRecipe,
  onRemoveRecipe,
}: Props) {
  const fields = showDmNotes ? DM_FIELDS : BASE_FIELDS;
  const [draft, setDraft] = useState<Draft>(() => snapshot(c, showDmNotes));
  // Last server-synced value per field; used to tell "user edited" apart from
  // "server changed" so we never clobber unsaved typing.
  const baseRef = useRef<Draft>(snapshot(c, showDmNotes));

  // Adopt remote changes for fields the user isn't currently editing.
  useEffect(() => {
    const next = snapshot(c, showDmNotes);
    const base = baseRef.current;
    setDraft((prev) => {
      let changed = false;
      const updated = { ...prev };
      for (const f of fields) {
        if (next[f] !== base[f] && prev[f] === base[f]) {
          updated[f] = next[f];
          changed = true;
        }
      }
      return changed ? updated : prev;
    });
    baseRef.current = next;
  }, [c.hp, c.maxHp, c.tempHp, c.ac, c.initiative, c.notes, c.dmNotes, showDmNotes, fields]);

  const t = useT();
  const isDirty = fields.some((f) => draft[f] !== baseRef.current[f]);

  const setField = (f: ScalarField, v: string) =>
    setDraft((prev) => ({ ...prev, [f]: v }));

  const save = () => {
    const changes = buildCombatantScalarChanges(
      fields,
      draft,
      baseRef.current,
    );
    if (Object.keys(changes).length > 0) onPatch?.(changes as CombatantPatch);
  };

  const hpPct =
    c.maxHp !== null && c.maxHp > 0
      ? Math.max(0, Math.min(100, ((c.hp ?? 0) / c.maxHp) * 100))
      : 0;

  return (
    <div
      className={`wt-frame${isCurrentTurn ? " current" : ""}${c.alive ? "" : " down"}`}
      style={{ ["--fcolor" as string]: c.color }}
    >
      <div className="wt-frame-head">
        <ColorSwatch color={c.color} />
        <span className="wt-frame-name" title={c.name}>
          {c.name}
        </span>
        <span className="wt-frame-kind">{t.combat.kinds[c.kind]}</span>
        <EconomyFlags combatant={c} editable={editable} onPatch={onPatch} />
        {c.characterId !== null && onOpenCard && (
          <button
            onClick={() => onOpenCard(c.characterId as string)}
            title={t.combat.openCardTitle}
            aria-label={`open card ${c.name}`}
          >
            📜
          </button>
        )}
        {c.characterId !== null && onOpenClassRules && (
          <button
            onClick={() => onOpenClassRules(c.characterId as string)}
            title={t.combat.openClassRulesTitle}
            aria-label={`open class rules ${c.name}`}
          >
            ❓
          </button>
        )}
        {c.kind === "enemy" && onOpenEnemyEditor && (
          <button
            onClick={onOpenEnemyEditor}
            title={t.combat.openEnemyEditorTitle}
            aria-label={`open enemy editor ${c.name}`}
          >
            👹
          </button>
        )}
      </div>
      {c.hp !== null && (
        <div
          className="wt-hpbar"
          title={`HP ${c.hp}/${c.maxHp}${c.tempHp ? ` +${c.tempHp} ${t.combat.tempShort}` : ""}`}
        >
          <div style={{ width: `${hpPct}%` }} />
        </div>
      )}
      <div className="wt-frame-stats">
        {editable ? (
          <>
            {c.hp !== null && (
              <>
                <span className="wt-stat-label">HP</span>
                <DraftInput
                  value={draft.hp}
                  onChange={(v) => setField("hp", v)}
                  ariaLabel={`hp ${c.name}`}
                />
                /
                <DraftInput
                  value={draft.maxHp}
                  onChange={(v) => setField("maxHp", v)}
                  ariaLabel={`max hp ${c.name}`}
                />
                <span className="wt-stat-label" title={t.combat.tempHpLabelTitle}>
                  {t.combat.tempShort}
                </span>
                <DraftInput
                  value={draft.tempHp}
                  onChange={(v) => setField("tempHp", v)}
                  ariaLabel={`temp hp ${c.name}`}
                />
              </>
            )}
            {c.ac !== null && (
              <>
                <span className="wt-stat-label">AC</span>
                <DraftInput
                  value={draft.ac}
                  onChange={(v) => setField("ac", v)}
                  ariaLabel={`ac ${c.name}`}
                />
              </>
            )}
            <span className="wt-stat-label">{t.combat.init}</span>
            <DraftInput
              value={draft.initiative}
              onChange={(v) => setField("initiative", v)}
              ariaLabel={`initiative ${c.name}`}
            />
            <button
              onClick={save}
              disabled={!isDirty}
              aria-label={`save ${c.name}`}
              title={t.combat.saveStatsTitle}
              style={{ marginLeft: "auto" }}
            >
              {t.common.save}
              {isDirty ? " ●" : ""}
            </button>
          </>
        ) : (
          <>
            {c.hp !== null ? (
              <>
                <span className="wt-stat-label">HP</span> {c.hp}/{c.maxHp}
                {c.tempHp != null && c.tempHp > 0 && (
                  <span title={t.combat.tempHpInlineTitle}> +{c.tempHp}{t.combat.tempShort}</span>
                )}
              </>
            ) : (
              <>
                <span className="wt-stat-label">HP</span> ???
              </>
            )}
            {c.ac !== null ? (
              <>
                <span className="wt-stat-label">AC</span> {c.ac}
              </>
            ) : (
              <>
                <span className="wt-stat-label">AC</span>???
              </>
            )}
            <span className="wt-stat-label">{t.combat.init}</span> {c.initiative}
          </>
        )}
      </div>
      {editable ? (
        <input
          value={draft.notes}
          onChange={(e) => setField("notes", e.target.value)}
          placeholder={t.combat.notesPlaceholder}
          aria-label={`notes ${c.name}`}
          style={{ width: "100%", marginTop: "0.25em" }}
        />
      ) : (
        c.notes !== "" && <div>{c.notes}</div>
      )}
      <EffectsCell
        combatant={c}
        editable={editable}
        onApplyCondition={onApplyCondition}
        onAddCustom={onAddCustom}
        onToggleEffect={onToggleEffect}
        onRemoveEffect={onRemoveEffect}
      />
      {(c.characterId === null || !onOpenCard) && (
        <CombatantSheet
          combatant={c}
          onPatch={editable ? onPatch : undefined}
          onAddResource={onAddResource}
          onUpdateResource={onUpdateResource}
          onRemoveResource={onRemoveResource}
          onAddRecipe={onAddRecipe}
          onUpdateRecipe={onUpdateRecipe}
          onRemoveRecipe={onRemoveRecipe}
        />
      )}
      {!editable && showDmNotes && c.dmNotes !== undefined && (
        <div>{c.dmNotes}</div>
      )}
      {editable && (
        <details className="wt-frame-more" aria-label={`manage ${c.name}`}>
          <summary>⋯ {t.combat.manage}</summary>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4em", alignItems: "center", marginTop: "0.3em" }}>
            <button onClick={onKill}>{c.alive ? t.combat.kill : t.combat.revive}</button>
            <button onClick={onRemove}>{t.common.remove}</button>
            <ColorSelect color={c.color} onChange={(color) => onPatch?.({ color })} />
          </div>
          {showDmNotes && (
            <input
              value={draft.dmNotes}
              onChange={(e) => setField("dmNotes", e.target.value)}
              placeholder={t.combat.dmNotesPlaceholder}
              aria-label={`dm notes ${c.name}`}
              style={{ width: "100%", marginTop: "0.3em" }}
            />
          )}
        </details>
      )}
    </div>
  );
}

const ECONOMY_FLAGS = [
  { label: "A", key: "actionUsed" as const },
  { label: "B", key: "bonusUsed" as const },
  { label: "R", key: "reactionUsed" as const },
];

/**
 * Action / bonus / reaction reminders. Overrideable: the DM toggles a flag by
 * clicking. They nudge but never enforce.
 */
function EconomyFlags({
  combatant: c,
  editable,
  onPatch,
}: {
  combatant: CombatantView;
  editable: boolean;
  onPatch?: (patch: CombatantPatch) => void;
}) {
  const t = useT();
  return (
    <span title={t.combat.economyTitle}>
      {ECONOMY_FLAGS.map(({ label, key }) => (
        <span
          key={label}
          style={{
            marginRight: "0.5em",
            textDecoration: c[key] ? "line-through" : "none",
            cursor: editable ? "pointer" : "default",
          }}
          onClick={
            editable ? () => onPatch?.({ [key]: !c[key] }) : undefined
          }
        >
          {label}
        </span>
      ))}
    </span>
  );
}

/**
 * Visual Color override: a swatch of the current Color that opens a grid of all
 * 25 palette swatches (click to pick). A native color well offers any custom
 * hex without typing a color code. Either role may override (ADR-0002).
 */
function ColorSelect({
  color,
  onChange,
}: {
  color: string;
  onChange: (color: string) => void;
}) {
  const t = useT();
  return (
    <details aria-label="color picker">
      <summary style={{ cursor: "pointer", whiteSpace: "nowrap" }}>
        <ColorSwatch color={color} />
        {t.combat.changeColor}
      </summary>
      <div
        role="group"
        aria-label="palette"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1.2em)",
          gap: "0.2em",
          marginTop: "0.3em",
        }}
      >
        {PALETTE.map((p) => (
          <button
            key={p}
            onClick={() => onChange(p)}
            aria-label={`color ${p}`}
            aria-pressed={p === color}
            title={p}
            style={{
              width: "1.2em",
              height: "1.2em",
              padding: 0,
              // `background` shorthand, not backgroundColor: the War Table
              // theme paints buttons with a background-image gradient, which
              // would cover a bare background-color (the swatches showed
              // leather instead of their colors).
              background: p,
              border: p === color ? "2px solid #fff" : "1px solid #000",
              cursor: "pointer",
            }}
          />
        ))}
      </div>
      <label style={{ display: "block", marginTop: "0.3em" }}>
        custom{" "}
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          aria-label="custom color"
        />
      </label>
    </details>
  );
}

/** A number input bound to a string draft value (committed on row Save). */
function DraftInput({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
}) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      style={{ width: "4em" }}
    />
  );
}
