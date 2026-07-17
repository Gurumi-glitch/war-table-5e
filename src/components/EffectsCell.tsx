import { useState } from "react";
import type { CombatantView } from "../../convex/games";
import { useT, type Messages } from "../i18n";
import { abilityAbbr, conditionLabel, modeLabel, statLabel } from "../i18n/terms";
import {
  ABILITY_KEYS,
  CONDITIONS,
  CUSTOM_PRESETS,
  MODE_LABELS,
  STAT_LABELS,
  type Mode,
  type ModifierSpec,
  type Stat,
} from "../../convex/modifiers";

export type EffectHandlers = {
  onApplyCondition?: (combatantId: string, conditionKey: string) => void;
  onAddCustom?: (combatantId: string, label: string, specs: ModifierSpec[]) => void;
  onToggleEffect?: (effectId: string, active: boolean) => void;
  onRemoveEffect?: (effectId: string) => void;
};

type Props = EffectHandlers & {
  combatant: CombatantView;
  editable?: boolean;
};

const VALUE_MODES: ReadonlySet<Mode> = new Set(["bonus", "override"]);

/**
 * One editable spec row in the custom-modifier form. `abilities` is the per-
 * ability scope selector shown only when `isAbilityScoped(row.stat, row.mode)`
 * (saves, and ability checks except auto-fail). Empty = the legacy generic
 * "applies to ALL saves/checks" meaning.
 */
type SpecRow = { stat: Stat; mode: Mode; value: number; abilities: string[] };

/**
 * One combatant's Conditions & custom Modifiers (issue #5). Active effects show
 * as toggleable chips — click to toggle off (reverts the Effective stat without
 * mutating the base), × to remove. An "add" panel offers curated 5e Conditions,
 * quick presets, and a custom Modifier form. Effective AC is shown when active
 * modifiers change it. Open to either role.
 *
 * Visual (War Table restyle): chips share one compact pill shape, distinguished
 * by a thin left-edge accent — blood red for a curated Condition, ember gold
 * for a custom Modifier (`.wt-chip.condition` / `.wt-chip.custom` in
 * warTable.css). A toggled-off chip is "snuffed out" (`.inactive`):
 * desaturated, dimmed, struck through — still readable, clearly not
 * contributing.
 */
export function EffectsCell({
  combatant: c,
  editable = false,
  onApplyCondition,
  onAddCustom,
  onToggleEffect,
  onRemoveEffect,
}: Props) {
  const t = useT();
  const { effectiveAc: eff } = c;
  const acChanged = eff && (eff.bonus !== 0 || eff.override !== null);

  return (
    <div aria-label={`effects ${c.name}`} className="wt-effects">
      {acChanged && eff && (
        <span
          title={`AC ${eff.base} → ${eff.value}${
            eff.override !== null ? " (override)" : ` (+${eff.bonus})`
          }`}
          className="wt-effect-ac"
        >
          AC {eff.value}
        </span>
      )}
      {c.effects.map((e) => {
        // Non-blocking immunity warn (狀態免疫): the condition still applies —
        // DM authority — but the chip flags the knowing override.
        const isImmune =
          e.conditionKey !== null &&
          (c.conditionImmune ?? []).includes(e.conditionKey);
        return (
        <span
          key={e._id}
          title={isImmune ? `${conditionLabel(t, e.label)}${t.effects.immuneTitleSuffix}` : conditionLabel(t, e.label)}
          className={`wt-chip ${e.type}${e.active ? "" : " inactive"}${
            editable ? " wt-chip-editable" : ""
          }`}
          onClick={
            editable
              ? () => onToggleEffect?.(e._id, !e.active)
              : undefined
          }
        >
          {isImmune && "⚠"}
          {conditionLabel(t, e.label)}
          {editable && (
            <button
              onClick={(ev) => {
                ev.stopPropagation();
                onRemoveEffect?.(e._id);
              }}
              aria-label={`remove ${e.label}`}
              className="wt-chip-remove"
            >
              ×
            </button>
          )}
        </span>
        );
      })}
      {editable && (
        <AddEffects
          combatantId={c._id}
          conditionImmune={c.conditionImmune ?? []}
          onApplyCondition={onApplyCondition}
          onAddCustom={onAddCustom}
        />
      )}
    </div>
  );
}

/** Collapsible add panel: curated Conditions, presets, and a custom Modifier form. */
function AddEffects({
  combatantId,
  conditionImmune,
  onApplyCondition,
  onAddCustom,
}: {
  combatantId: string;
  /** Curated-condition immunity keys — flagged ⚠免疫 in the picker, never blocked. */
  conditionImmune: string[];
  onApplyCondition?: EffectHandlers["onApplyCondition"];
  onAddCustom?: EffectHandlers["onAddCustom"];
}) {
  const t = useT();
  const [condKey, setCondKey] = useState<string>(CONDITIONS[0]?.key ?? "");
  const [label, setLabel] = useState<string>("");
  const [specRows, setSpecRows] = useState<SpecRow[]>([
    { stat: "ac", mode: "bonus", value: 1, abilities: [] },
  ]);

  const addRow = () =>
    setSpecRows((r) => [...r, { stat: "ac", mode: "bonus", value: 1, abilities: [] }]);
  const removeRow = (i: number) =>
    setSpecRows((r) => r.filter((_, idx) => idx !== i));
  const updateRow = (i: number, patch: Partial<SpecRow>) =>
    setSpecRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  return (
    <details aria-label="add effect" className="wt-effects-add">
      <summary>{t.effects.add}</summary>
      <div className="wt-effects-form">
        <div className="wt-effects-row">
          <label>
            {t.effects.condition}{" "}
            <select
              value={condKey}
              onChange={(e) => setCondKey(e.target.value)}
              aria-label="condition"
            >
              {CONDITIONS.map((c) => (
                <option key={c.key} value={c.key}>
                  {conditionLabel(t, c.label)}
                  {conditionImmune.includes(c.key) ? t.effects.immuneSuffix : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => condKey && onApplyCondition?.(combatantId, condKey)}
          >
            {t.effects.apply}
          </button>
        </div>

        <div className="wt-effects-row wt-effects-presets">
          {t.effects.quick}
          {CUSTOM_PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => onAddCustom?.(combatantId, p.label, [p.spec])}
            >
              {p.label}
            </button>
          ))}
        </div>

        <fieldset>
          <legend>{t.effects.customModifier}</legend>
          <div className="wt-effects-row">
            <label>
              {t.effects.labelField}{" "}
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                size={12}
                placeholder={t.effects.labelPlaceholder}
                aria-label="custom effect label"
              />
            </label>
          </div>
          {specRows.map((row, i) => (
            <div key={i} className="wt-effects-row">
              <label>
                {t.effects.stat}{" "}
                <select
                  value={row.stat}
                  onChange={(e) => {
                    const stat = e.target.value as Stat;
                    // Drop a stale ability scope if the new stat can't carry one.
                    updateRow(i, {
                      stat,
                      abilities: isAbilityScoped(stat, row.mode) ? row.abilities : [],
                    });
                  }}
                  aria-label="row stat"
                >
                  {(Object.keys(STAT_LABELS) as Stat[]).map((s) => (
                    <option key={s} value={s}>
                      {statLabel(t, s)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t.effects.mode}{" "}
                <select
                  value={row.mode}
                  onChange={(e) => {
                    const mode = e.target.value as Mode;
                    // Drop a stale ability scope if the new mode can't carry one.
                    updateRow(i, {
                      mode,
                      abilities: isAbilityScoped(row.stat, mode) ? row.abilities : [],
                    });
                  }}
                  aria-label="row mode"
                >
                  {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
                    <option key={m} value={m}>
                      {modeLabel(t, m)}
                    </option>
                  ))}
                </select>
              </label>
              {VALUE_MODES.has(row.mode) && (
                <label>
                  {t.effects.value}{" "}
                  <input
                    type="number"
                    value={row.value}
                    onChange={(e) => updateRow(i, { value: Number(e.target.value) })}
                    style={{ width: "4em" }}
                    aria-label="row value"
                  />
                </label>
              )}
              {isAbilityScoped(row.stat, row.mode) && (
                <span className="wt-effects-abilities" aria-label="row abilities">
                  {t.effects.abilities}
                  {ABILITY_KEYS.map((a) => (
                    <label key={a}>
                      <input
                        type="checkbox"
                        checked={row.abilities.includes(a)}
                        onChange={(e) =>
                          updateRow(i, {
                            abilities: e.target.checked
                              ? [...row.abilities, a]
                              : row.abilities.filter((x) => x !== a),
                          })
                        }
                      />
                      {abilityAbbr(t, a)}
                    </label>
                  ))}
                  <span className="wt-effects-abilities-hint">{t.effects.abilitiesAllHint}</span>
                </span>
              )}
              <button onClick={() => removeRow(i)} aria-label="remove row">×</button>
            </div>
          ))}
          <div className="wt-effects-row">
            <button onClick={addRow}>{t.effects.addRow}</button>
            <button
              onClick={() => {
                if (specRows.length === 0) return;
                // An ability-scoped row with abilities checked expands to one
                // ModifierSpec per ability (the curated Stunned/Restrained shape).
                // With none checked it stays a single generic spec — the legacy
                // "applies to ALL saves/checks" meaning (backward compatible).
                const specs: ModifierSpec[] = specRows.flatMap((r) => {
                  if (isAbilityScoped(r.stat, r.mode) && r.abilities.length > 0) {
                    return r.abilities.map((ability) => ({
                      stat: r.stat,
                      mode: r.mode,
                      value: VALUE_MODES.has(r.mode) ? r.value : 0,
                      ability,
                    }));
                  }
                  return [{
                    stat: r.stat,
                    mode: r.mode,
                    value: VALUE_MODES.has(r.mode) ? r.value : 0,
                  }];
                });
                onAddCustom?.(
                  combatantId,
                  label.trim() || defaultLabel(t, specRows[0]),
                  specs,
                );
                setLabel("");
                setSpecRows([{ stat: "ac", mode: "bonus", value: 1, abilities: [] }]);
              }}
            >
              {t.effects.addEffect}
            </button>
          </div>
        </fieldset>
      </div>
    </details>
  );
}

/**
 * Whether a (stat, mode) combo can carry a per-ability scope — saves in every
 * mode, ability checks in every mode but auto-fail (5e auto-fail is a save-only
 * mechanic; `autoFailFor` is only ever called with "save").
 *
 * Attack / attackAgainst are deliberately excluded: the Confirm path calls
 * `advantageSignalsFor(specs, "attack")` with no ability argument, so a scoped
 * attack spec would be silently applied to EVERY attack — and no attack roll
 * carries an ability identity anyway (`Recipe` has `saveAbility`, never an
 * attack ability), because no 5e rule scopes attack adv/disadv by ability.
 *
 * Scope is honored end-to-end for saves: adv/disadv via `advantageSignalsFor`,
 * auto-fail via `autoFailFor`, and bonus/override via the `saveSpecsForAbility`
 * filter in combatLog.ts (mirrored in ConfirmPanel.tsx for the preview).
 * `abilityCheck` specs are chip-text only — nothing rolls an ability check yet.
 */
function isAbilityScoped(stat: Stat, mode: Mode): boolean {
  if (stat === "save") return true;
  if (stat === "abilityCheck") return mode !== "autoFail";
  return false;
}

/** Default label for a custom modifier when the DM leaves the label blank. */
function defaultLabel(t: Messages, row: SpecRow): string {
  const s = statLabel(t, row.stat);
  const scope =
    row.abilities.length > 0
      ? `${row.abilities.map((a) => abilityAbbr(t, a)).join("/")} `
      : "";
  if (row.mode === "autoFail") return `${t.effects.autoFailPrefix}: ${scope}${s}`;
  if (row.mode === "advantage") return `${t.effects.advPrefix}: ${scope}${s}`;
  if (row.mode === "disadvantage") return `${t.effects.disadvPrefix}: ${scope}${s}`;
  if (row.mode === "override") return `${scope}${s} = ${row.value}`;
  return `${row.value >= 0 ? "+" : ""}${row.value} ${scope}${s}`;
}
