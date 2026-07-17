import type { CombatantView } from "../../convex/games";
import { CombatantRow, type CombatantPatch } from "./CombatantRow";
import type { EffectHandlers } from "./EffectsCell";
import type { RecipeHandlers, ResourceHandlers } from "./CombatantSheet";
import { useT } from "../i18n";

type Props = EffectHandlers & RecipeHandlers & ResourceHandlers & {
  combatants: CombatantView[];
  currentTurnId: string | null;
  /** Panel heading (e.g. 冒險者 / 敵影) and section landmark name. */
  title: string;
  ariaLabel: string;
  editable?: boolean;
  showDmNotes?: boolean;
  onPatch?: (id: string, patch: CombatantPatch) => void;
  onKill?: (id: string) => void;
  onRemove?: (id: string) => void;
  onRollInitiative?: () => void;
  /** Open/focus a linked PC's floating card window (issue #9 step 4). */
  onOpenCard?: (characterId: string) => void;
  /** Open/focus a linked PC's read-only 職業特殊規則 pop-out. */
  onOpenClassRules?: (characterId: string) => void;
  /** Open/focus an enemy's floating editor window. */
  onOpenEnemyEditor?: (combatantId: string) => void;
};

/**
 * One column of combatant frames — the War Table renders this twice (party
 * left, enemies right; issue #9 step 5). Still the source of truth for the
 * encounter: every frame is editable by either role (open-buttons ethos), and
 * the DM-only `dmNotes` field renders only for the DM (`showDmNotes`). The
 * column scrolls; ~20 enemies must stay comfortable.
 */
export function CombatantList({
  combatants,
  currentTurnId,
  title,
  ariaLabel,
  editable = false,
  showDmNotes = false,
  onPatch,
  onKill,
  onRemove,
  onRollInitiative,
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
  const t = useT();
  return (
    <section aria-label={ariaLabel} className="wt-panel wt-fill">
      <h2 className="wt-panel-title">
        {title} ({combatants.length})
        {editable && onRollInitiative && (
          <button
            onClick={onRollInitiative}
            title={t.combat.rollInitiativeTitle}
          >
            {t.combat.rollInitiative}
          </button>
        )}
      </h2>
      <div className="wt-frames wt-scroll">
        {combatants.length === 0 && (
          <span style={{ color: "var(--dim)", fontSize: "0.85em" }}>{t.combat.emptyList}</span>
        )}
        {combatants.map((c) => (
          <CombatantRow
            key={c._id}
            combatant={c}
            isCurrentTurn={c._id === currentTurnId}
            editable={editable}
            showDmNotes={showDmNotes}
            onPatch={(patch) => onPatch?.(c._id, patch)}
            onKill={() => onKill?.(c._id)}
            onRemove={() => onRemove?.(c._id)}
            onOpenCard={onOpenCard}
            onOpenClassRules={onOpenClassRules}
            onOpenEnemyEditor={onOpenEnemyEditor ? () => onOpenEnemyEditor(c._id) : undefined}
            onApplyCondition={
              onApplyCondition
                ? (_id, conditionKey) => onApplyCondition(c._id, conditionKey)
                : undefined
            }
            onAddCustom={
              onAddCustom
                ? (_id, label, specs) => onAddCustom(c._id, label, specs)
                : undefined
            }
            onToggleEffect={onToggleEffect}
            onRemoveEffect={onRemoveEffect}
            onAddResource={
              onAddResource ? (_id, label, max, current) => onAddResource(c._id, label, max, current) : undefined
            }
            onUpdateResource={onUpdateResource}
            onRemoveResource={onRemoveResource}
            onAddRecipe={onAddRecipe ? (_id, recipe) => onAddRecipe(c._id, recipe) : undefined}
            onUpdateRecipe={onUpdateRecipe}
            onRemoveRecipe={onRemoveRecipe}
          />
        ))}
      </div>
    </section>
  );
}
