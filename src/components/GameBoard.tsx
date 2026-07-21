import { useState, type ReactNode } from "react";
import type { GameState } from "../../convex/games";
import type { BattleDraftView } from "../../convex/battleDrafts";
import type { CombatLogEntry } from "../../convex/combatLog";
import type { DieType } from "../../convex/diceHelpers";
import type { CharacterCardPatch, CharacterFields } from "../../convex/characters";
import type { RecipeDraft } from "../../convex/recipeLibrary";
import { normalizeCombatant } from "../lib/normalize";
import { CombatantList } from "./CombatantList";
import "../warTable.css";
import { DiceBoard } from "./DiceBoard";
import { BatchBattlePanel, type BatchHandlers } from "./BatchBattlePanel";
import { CharactersPanel, type CharactersPanelProps } from "./CharactersPanel";
import { ConfirmPanel, type BattleDraftPatch, type ConfirmEffect } from "./ConfirmPanel";
import { CombatLog, logLine } from "./CombatLog";
import { useT } from "../i18n";
import type { CombatantPatch } from "./CombatantRow";
import type { EffectHandlers } from "./EffectsCell";
import type { RecipeHandlers, ResourceHandlers } from "./CombatantSheet";
import type { RecipeConfirm } from "./ConfirmPanel";

/**
 * Character-card handlers (issue #9 step 4). Resources/Recipes are owned by the
 * character (campaign state); the card window edits them via `characterId`.
 * `onUpdateCharacter` is the draft Save (dirty-fields-only PATCH). These are
 * role-open like every gameplay button.
 */
export type CharacterHandlers = {
  onUpdateCharacter: (characterId: string, patch: CharacterCardPatch) => void;
  /** Permanently delete a card (convex/characters.ts remove — freezes any
   *  in-battle combatant's stats and unlinks it, never breaks a running battle). */
  onDeleteCharacter: (characterId: string) => Promise<void>;
  /**
   * Create a card from the builder's assembled fields (or a blank card when
   * `fields` is omitted — legacy callers), resolving to its id. The id is what
   * lets GameShell open the editor on the new card — creating a card you then
   * have to hunt for in the strip is a worse button than none.
   */
  onCreateCharacter?: (fields?: CharacterFields) => Promise<string>;
  onAddCharacterResource: (
    characterId: string,
    label: string,
    max: number,
    current?: number,
  ) => void;
  onUpdateCharacterResource: (
    resourceId: string,
    patch: { label?: string; current?: number; max?: number },
  ) => void;
  onRemoveCharacterResource: (resourceId: string) => void;
  onAddCharacterRecipe: (characterId: string, recipe: RecipeDraft) => void;
  onUpdateCharacterRecipe: (recipeId: string, recipe: RecipeDraft) => void;
  onRemoveCharacterRecipe: (recipeId: string) => void;
  /** Portrait medallion upload (codex-folio-card-ui): generateUploadUrl → PUT
   *  → setCharacterPortrait, bound with playerToken at the page level (same
   *  pattern as every other handler above) — role-open like the rest. */
  onUploadPortrait?: (characterId: string, file: File) => void;
};

export type NewCombatant = {
  name: string;
  kind: "pc" | "npc" | "enemy";
  maxHp: number;
  ac: number;
  initiative: number;
  notes: string;
  dmNotes: string;
};

export type GameBoardProps = EffectHandlers &
  RecipeHandlers &
  ResourceHandlers &
  BatchHandlers &
  CharactersPanelProps &
  CharacterHandlers & {
  state: GameState;
  log: CombatLogEntry[];
  onSetNote: (note: string) => void;
  onIncrement: () => void;
  onAdvance: () => void;
  onResetEconomy: () => void;
  onRollInitiative: () => void;
  onAddCombatant: (c: NewCombatant) => void;
  onPatch: (id: string, patch: CombatantPatch) => void;
  onKill: (id: string) => void;
  onRemove: (id: string) => void;
  onBatchRoll: (types?: DieType[]) => void;
  onSetClaim: (dieId: string, claimedBy: string | null) => void;
  onReroll: (dieId: string) => void;
  onSetValue: (dieId: string, value: number) => void;
  onConfirm: (
    actingCombatantId: string | null,
    effectText: string,
    effects: ConfirmEffect[],
  ) => void;
  onConfirmRecipe: (payload: RecipeConfirm) => void;
  drafts?: BattleDraftView[];
  onSelectNormalBattleActor?: (actorId: string) => void;
  onPatchBattleDraft?: (
    scope: "normal" | "batch",
    actorId: string,
    runId: string | undefined,
    patch: BattleDraftPatch,
  ) => void;
  /**
   * DM-only surface (game links + secret DM note), supplied by BackstageView
   * and rendered as a 🗝 drawer in the top bar. Absent on Frontstage.
   */
  dmPanel?: ReactNode;
  /**
   * Enemy database window content (issue #6), supplied wired-up by Backstage
   * only — enemy templates are DM secrets, so Frontstage never receives it
   * (and the backend gates every enemies.* call by dmToken regardless).
   */
  enemyDbPanel?: ReactNode;
  /**
   * Map system (add-map-system): the DM token, forwarded to the floating map
   * window's `MapBoard` so map management + enemy-piece creation work from
   * inside 戰爭桌. Absent on Frontstage (players); the backend gates regardless.
   */
  dmToken?: string;
};

export type GameBoardContentProps = Omit<
  GameBoardProps,
  keyof CharacterHandlers | "dmPanel" | "enemyDbPanel" | "dmToken"
> & {
  onOpenCard: (characterId: string) => void;
  onOpenClassRules: (characterId: string) => void;
  onOpenEnemyEditor: (combatantId: string) => void;
};

/**
 * Parse the `?desktop` URL override (for the TTS in-game tablet, whose narrow
 * viewport trips the stacked mobile layout): present → force the full grid;
 * a numeric value in [0.5, 1] (e.g. `?desktop=0.8`) additionally zooms out so
 * the wide grid fits. Absent → responsive behavior unchanged.
 */
export function desktopOverride(search: string): {
  force: boolean;
  zoom?: number;
} {
  const raw = new URLSearchParams(search).get("desktop");
  if (raw === null) return { force: false };
  const z = Number(raw);
  return Number.isFinite(z) && z >= 0.5 && z <= 1
    ? { force: true, zoom: z }
    : { force: true };
}

/**
 * The shared control surface rendered by both Backstage and Frontstage (the
 * only role-based difference is the DM-notes surface, which lives in
 * BackstageView). All gameplay buttons are open to either role — the backend
 * withholds DM-only fields, it does not gate gameplay (ADR-0002, open-buttons
 * ethos). Carries: shared board, turn order, combatant table + add form, dice
 * board, confirm, and the combat log.
 */
export function GameBoard({
  state,
  log,
  onRollInitiative,
  onAddCombatant,
  onPatch,
  onKill,
  onRemove,
  onBatchRoll,
  onSetClaim,
  onReroll,
  onSetValue,
  onConfirm,
  onConfirmRecipe,
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
  onStartBatchRun,
  onAdvanceBatchTurn,
  onEndBatchRun,
  drafts,
  onSelectNormalBattleActor,
  onPatchBattleDraft,
  characters,
  onSeedCharacters,
  onJoinBattle,
  onOpenCard,
  onNewCard,
  onImportCards,
  onOpenClassRules,
  onOpenEnemyEditor,
}: GameBoardContentProps) {
  // The DM-only `dmNotes` column renders only for the DM. Other gameplay
  // controls are open to either role.
  const isDm = state.role === "dm";

  // Normalize once: default any fields a stale/older backend might omit so a
  // backend/frontend skew can't white-screen the table (recipes/resources/RVI/
  // effects/effectiveAc). Passed to every child that reads combatants.
  const combatants = state.combatants.map(normalizeCombatant);
  // Skew-safe: an older backend omits `batchRun` → treat as no run.
  const batchRun = state.batchRun ?? null;
  const sharedDrafts = drafts ?? [];

  const inBattleCharacterIds = new Set(
    combatants
      .map((c) => c.characterId)
      .filter((id): id is string => id !== null),
  );

  // The War Table split: adventurers (pc + npc allies) man the left column,
  // enemies the right. Both keep full frame controls (open-buttons ethos).
  const party = combatants.filter((c) => c.kind !== "enemy");
  const enemies = combatants.filter((c) => c.kind === "enemy");
  const latest = log[0];

  // Dice board folded state: when expanded (not folded), the Battle block
  // (ConfirmPanel) grows to 1.4× its folded height — most players use the
  // expanded dice board, so the taller Battle block is the default.
  const t = useT();
  const [diceFolded, setDiceFolded] = useState(false);

  // The TTS tablet is a reference/roster surface: batch battle, Battle and the
  // dice board live on the desktop clients only (same gate as Scene/map in
  // GameShell), so the whole center column is dropped there.
  const isTablet =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("Tablet");

  return (
    <>
        {/* Left: the party column + characters bar + compact log. */}
        <div className="wt-col">
          <CombatantList
            title={t.board.party}
            ariaLabel="party"
            combatants={party}
            currentTurnId={state.currentTurnId}
            editable
            showDmNotes={isDm}
            onPatch={onPatch}
            onKill={onKill}
            onRemove={onRemove}
            onRollInitiative={onRollInitiative}
            onOpenCard={onOpenCard}
            onOpenClassRules={onOpenClassRules}
            onApplyCondition={onApplyCondition}
            onAddCustom={onAddCustom}
            onToggleEffect={onToggleEffect}
            onRemoveEffect={onRemoveEffect}
            onAddResource={onAddResource}
            onUpdateResource={onUpdateResource}
            onRemoveResource={onRemoveResource}
            onAddRecipe={onAddRecipe}
            onUpdateRecipe={onUpdateRecipe}
            onRemoveRecipe={onRemoveRecipe}
          />
          <CharactersPanel
            characters={characters}
            onSeedCharacters={onSeedCharacters}
            onJoinBattle={onJoinBattle}
            inBattleCharacterIds={inBattleCharacterIds}
            onOpenCard={onOpenCard}
            onNewCard={onNewCard}
            onImportCards={onImportCards}
          />
          <CombatLog entries={log} />
        </div>

        {/* Center: batch window (expandable), the free 戰鬥 Battle panel, then
         * the dice board at the bottom (the first rows get the most use, so
         * the board sits closest to the Battle controls). All three fold. */}
        {!isTablet && (
        <div className="wt-col" data-dice-folded={diceFolded ? "true" : undefined}>
          <BatchBattlePanel
            batchRun={batchRun}
            combatants={combatants}
            dice={state.dice}
            onConfirm={onConfirm}
            onConfirmRecipe={onConfirmRecipe}
            onSetClaim={onSetClaim}
            onStartBatchRun={onStartBatchRun}
            onAdvanceBatchTurn={onAdvanceBatchTurn}
            onEndBatchRun={onEndBatchRun}
            onUpdateResource={onUpdateResource}
            drafts={sharedDrafts}
            onPatchDraft={onPatchBattleDraft}
          />
          <ConfirmPanel
            dice={state.dice}
            combatants={combatants}
            onConfirm={onConfirm}
            onConfirmRecipe={onConfirmRecipe}
            onSetClaim={onSetClaim}
            onUpdateResource={onUpdateResource}
            draft={sharedDrafts.find((draft) => draft.slotKey === "normal")}
            onSelectActor={onSelectNormalBattleActor}
            onPatchDraft={(actorId, patch) =>
              onPatchBattleDraft?.("normal", actorId, undefined, patch)
            }
          />
          <DiceBoard
            dice={state.dice}
            combatants={combatants}
            batchLocked={batchRun !== null}
            onBatchRoll={onBatchRoll}
            onSetClaim={onSetClaim}
            onReroll={onReroll}
            onSetValue={onSetValue}
            resetSignal={log.length}
            folded={diceFolded}
            onFold={setDiceFolded}
          />
        </div>
        )}

        {/* Right: the enemy horde column (~20 must scroll comfortably) + spawn. */}
        <div className="wt-col">
          <CombatantList
            title={t.board.enemies}
            ariaLabel="enemies"
            combatants={enemies}
            currentTurnId={state.currentTurnId}
            editable
            showDmNotes={isDm}
            onPatch={onPatch}
            onKill={onKill}
            onRemove={onRemove}
            onOpenEnemyEditor={onOpenEnemyEditor}
            onApplyCondition={onApplyCondition}
            onAddCustom={onAddCustom}
            onToggleEffect={onToggleEffect}
            onRemoveEffect={onRemoveEffect}
            onAddResource={onAddResource}
            onUpdateResource={onUpdateResource}
            onRemoveResource={onRemoveResource}
            onAddRecipe={onAddRecipe}
            onUpdateRecipe={onUpdateRecipe}
            onRemoveRecipe={onRemoveRecipe}
          />
          <AddCombatantForm onAddCombatant={onAddCombatant} />
        </div>

        {/* Bottom ticker: the latest committed result at a glance. */}
        <div className="wt-ticker">
          <b>{t.board.latest}</b> — {latest ? logLine(latest, t) : t.board.noLog}
        </div>
    </>
  );
}

const EMPTY: NewCombatant = {
  name: "",
  kind: "enemy",
  maxHp: 1,
  ac: 10,
  initiative: 0,
  notes: "",
  dmNotes: "",
};

/**
 * The Add-combatant form, isolated as its own component on purpose: its `draft`
 * state is local, so typing a name (especially via a CJK IME, which fires
 * onChange dozens of times per second during composition) only re-renders THIS
 * small form — not the 175-dice DiceBoard or the combatant table. Keeping the
 * draft in GameBoard re-rendered the whole subtree on every keystroke.
 */
function AddCombatantForm({
  onAddCombatant,
}: {
  onAddCombatant: (c: NewCombatant) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<NewCombatant>(EMPTY);

  const submit = () => {
    if (draft.name.trim() === "") return;
    onAddCombatant(draft);
    setDraft(EMPTY);
  };

  return (
    <section aria-label="add combatant" className="wt-panel wt-add">
      <details>
        <summary>
          <strong>{t.board.addCombatant}</strong>
        </summary>
        <div>
          <label>
            {t.board.name}{" "}
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              style={{ width: "10em" }}
            />
          </label>
          <label>
            {t.board.kind}{" "}
            <select
              value={draft.kind}
              onChange={(e) =>
                setDraft({ ...draft, kind: e.target.value as NewCombatant["kind"] })
              }
            >
              <option value="pc">{t.combat.kinds.pc}</option>
              <option value="npc">{t.combat.kinds.npc}</option>
              <option value="enemy">{t.combat.kinds.enemy}</option>
            </select>
          </label>
          <label>
            {t.board.maxHp}{" "}
            <input
              type="number"
              value={draft.maxHp}
              onChange={(e) => setDraft({ ...draft, maxHp: Number(e.target.value) })}
              style={{ width: "4.5em" }}
            />
          </label>
          <label>
            AC{" "}
            <input
              type="number"
              value={draft.ac}
              onChange={(e) => setDraft({ ...draft, ac: Number(e.target.value) })}
              style={{ width: "4.5em" }}
            />
          </label>
          <label>
            {t.combat.init}{" "}
            <input
              type="number"
              value={draft.initiative}
              onChange={(e) =>
                setDraft({ ...draft, initiative: Number(e.target.value) })
              }
              style={{ width: "4.5em" }}
            />
          </label>
          <button onClick={submit}>{t.common.add}</button>
        </div>
      </details>
    </section>
  );
}
