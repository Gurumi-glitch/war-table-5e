import { useEffect, useRef, useState } from "react";
import type { CombatantView } from "../../convex/games";
import {
  parseRviText,
  parseConditionImmunities,
  type EnemyFields,
} from "../../convex/enemyFields";
import type { CombatantPatch } from "./CombatantRow";
import { useT } from "../i18n";
import type { RecipeHandlers, ResourceHandlers } from "./CombatantSheet";
import {
  ResourcesSection,
  RVISection,
  RecipesSection,
} from "./CombatantSheet";
import { EnemyForm, Field, blankEnemy } from "./EnemyDbPanel";
import { buildCombatantScalarChanges } from "./combatantScalarDraft";

export type EnemyEditorWindowProps = ResourceHandlers &
  RecipeHandlers & {
    combatant: CombatantView;
    showDmNotes?: boolean;
    onPatch?: (patch: CombatantPatch) => void;
  };

type ScalarField = "hp" | "maxHp" | "ac" | "initiative" | "notes" | "dmNotes";
type Draft = Record<ScalarField, string>;

const BASE_FIELDS: readonly ScalarField[] = [
  "hp",
  "maxHp",
  "ac",
  "initiative",
  "notes",
];
const DM_FIELDS: readonly ScalarField[] = [...BASE_FIELDS, "dmNotes"];

/**
 * The stat-block form's initial fields: the instance's snapshot (or a blank
 * custom template for hand-added / pre-statBlock enemies) with the LIVE
 * name/AC/maxHp overlaid (they may have been quick-edited). The R/V/I and
 * 狀態免疫 text fields stay the snapshot's own text — qualifiers like
 * 「（非魔法）」 must survive round-trips; saving re-derives the working
 * chip lists from the text (one-way text → chips).
 */
function statBlockInitial(c: CombatantView): EnemyFields {
  const sb = c.statBlock ?? blankEnemy();
  return {
    ...sb,
    nameZh: c.name,
    ac: c.ac ?? sb.ac,
    hpMax: c.maxHp ?? sb.hpMax,
  };
}

function snapshot(c: CombatantView, withDm: boolean): Draft {
  return {
    hp: c.hp !== null ? String(c.hp) : "",
    maxHp: c.maxHp !== null ? String(c.maxHp) : "",
    ac: c.ac !== null ? String(c.ac) : "",
    initiative: String(c.initiative),
    notes: c.notes,
    dmNotes: withDm ? (c.dmNotes ?? "") : "",
  };
}

/**
 * The enemy editor window content (👹 pop-out on 敵影 row). Reuses the
 * ResourcesSection / RVISection / RecipesSection components from
 * CombatantSheet (also used inside CharacterCardWindow) to avoid duplication.
 * Scalars (HP/maxHp/AC/initiative/notes/dmNotes) are held in a local draft
 * and committed by Save button, matching the CombatantRow pattern.
 *
 * Fields withheld by projectCombatants for non-DM viewers (HP/AC/dmNotes/
 * resist/vuln/immune/resources/recipes) simply don't render — no new role
 * gating needed.
 *
 * The full 敵人庫 attribute set (名稱/威脅T/骰/速度/體型/六屬性/感官/語言/
 * 動作 JSON/戰術/…) is editable via the same EnemyForm as the 敵人庫 editor,
 * backed by the instance's `statBlock` snapshot (DM-only; spawn deep copy,
 * ADR-0002). Saving it also writes the derived live fields (name/AC/maxHp/
 * R/V/I) with the same derivation spawn uses.
 */
export function EnemyEditorWindow({
  combatant: c,
  showDmNotes = false,
  onPatch,
  onAddResource,
  onUpdateResource,
  onRemoveResource,
  onAddRecipe,
  onUpdateRecipe,
  onRemoveRecipe,
}: EnemyEditorWindowProps) {
  const t = useT();
  const fields = showDmNotes ? DM_FIELDS : BASE_FIELDS;
  const [draft, setDraft] = useState<Draft>(() => snapshot(c, showDmNotes));
  const baseRef = useRef<Draft>(snapshot(c, showDmNotes));
  // Bumped on Cancel to remount the stat-block form (discard its draft).
  const [formKey, setFormKey] = useState(0);

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
  }, [c.hp, c.maxHp, c.ac, c.initiative, c.notes, c.dmNotes, showDmNotes, fields]);

  const isDirty = fields.some((f) => draft[f] !== baseRef.current[f]);

  const setField = (f: ScalarField, v: string) =>
    setDraft((prev) => ({ ...prev, [f]: v }));

  const save = () => {
    const changes = buildCombatantScalarChanges(
      fields,
      draft,
      baseRef.current,
    );
    if (Object.keys(changes).length > 0) {
      onPatch?.(changes as CombatantPatch);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.35em" }}>
      {/* Scalars: HP/maxHp, AC, 先攻, 筆記 (+ DM筆記 if DM) — inline labeled
       * rows matching the 敵人庫 editor's Field layout. */}
      <div style={{ display: "flex", gap: "0.5em", flexWrap: "wrap" }}>
        {c.hp !== null && (
          <Field label="HP">
            <input
              value={draft.hp}
              onChange={(e) => setField("hp", e.target.value)}
              size={3}
              aria-label="hp"
            />
            <span style={{ opacity: 0.8 }}>/</span>
            <input
              value={draft.maxHp}
              onChange={(e) => setField("maxHp", e.target.value)}
              size={3}
              aria-label="max hp"
            />
          </Field>
        )}
        {c.ac !== null && (
          <Field label="AC">
            <input
              value={draft.ac}
              onChange={(e) => setField("ac", e.target.value)}
              size={2}
              aria-label="ac"
            />
          </Field>
        )}
        <Field label={t.combat.init}>
          <input
            value={draft.initiative}
            onChange={(e) => setField("initiative", e.target.value)}
            size={2}
            aria-label="initiative"
          />
        </Field>
      </div>
      <Field label={t.enemy.notes}>
        <input
          value={draft.notes}
          onChange={(e) => setField("notes", e.target.value)}
          style={{ flex: 1 }}
          aria-label="notes"
        />
      </Field>
      {showDmNotes && (
        <Field label={t.enemy.dmNotes}>
          <textarea
            value={draft.dmNotes}
            onChange={(e) => setField("dmNotes", e.target.value)}
            rows={3}
            style={{ flex: 1 }}
            aria-label="dm notes"
          />
        </Field>
      )}
      <div>
        <button onClick={save} disabled={!isDirty} aria-label="save">
          Save {isDirty ? "●" : ""}
        </button>
      </div>

      {/* Resources, RVI, Recipes — only if the combatant has the fields */}
      {c.hp !== null && (
        <ResourcesSection
          resources={c.resources ?? []}
          onAdd={
            onAddResource ? (label, max) => onAddResource(c._id, label, max) : undefined
          }
          onUpdate={onUpdateResource}
          onRemove={onRemoveResource}
          defaultColor={c.color}
        />
      )}

      {c.ac !== null && (
        <RVISection
          combatant={c}
          onPatch={onPatch}
        />
      )}

      {c.hp !== null && (
        <RecipesSection
          recipes={c.recipes ?? []}
          resources={c.resources ?? []}
          onAdd={onAddRecipe ? (recipe) => onAddRecipe(c._id, recipe) : undefined}
          onUpdate={onUpdateRecipe}
          onRemove={onRemoveRecipe}
        />
      )}

      {/* Full 敵人庫 stat block — DM only (projectCombatants withholds the
       * key from players entirely). The identical EnemyForm edits the
       * instance's snapshot; 儲存 also writes the derived live fields, 取消
       * remounts the form to discard the draft. Editing the 動作 JSON does
       * NOT regenerate recipes — those stay hand-managed above. */}
      {c.statBlock !== undefined && (
        <details>
          <summary>{t.enemy.fullStats}</summary>
          <EnemyForm
            key={formKey}
            initial={statBlockInitial(c)}
            onSave={(sb) =>
              onPatch?.({
                statBlock: sb,
                name: t.terms.displayName(sb.nameZh, sb.nameEn),
                ac: sb.ac,
                maxHp: sb.hpMax,
                resist: parseRviText(sb.damageResistances),
                vuln: parseRviText(sb.damageVulnerabilities),
                immune: parseRviText(sb.damageImmunities),
                conditionImmune: parseConditionImmunities(sb.conditionImmunities),
              })
            }
            onCancel={() => setFormKey((k) => k + 1)}
          />
        </details>
      )}
    </div>
  );
}
