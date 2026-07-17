import { useRef, useState } from "react";
import type { CombatantView } from "../../convex/games";
import { normalizeCombatant } from "../lib/normalize";
import { CharacterCardWindow } from "./CharacterCardWindow";
import { ClassRulesWindow } from "./ClassRulesWindow";
import { EnemyEditorWindow } from "./EnemyEditorWindow";
import { useT } from "../i18n";
import { LanguageSwitch } from "./LanguageSwitch";
import { GameBoard, desktopOverride, type GameBoardProps } from "./GameBoard";
import { MapBoard } from "./MapBoard";
import { MapWindow } from "./MapWindow";
import { SharedNote } from "./SharedNote";
import { ShellWindow } from "./ShellWindow";
import { TurnRibbon } from "./TurnRibbon";
import { useWindowSet } from "./windowState";

type Workspace = "war" | "scene";
type ShellKey = "note" | "dm" | "enemydb";
type CharacterKey = `character:${string}`;
type RulesKey = `rules:${string}`;
type EnemyKey = `enemy:${string}`;
type MapKey = "map";

const characterKey = (id: string): CharacterKey => `character:${id}`;
const rulesKey = (id: string): RulesKey => `rules:${id}`;
const enemyKey = (id: string): EnemyKey => `enemy:${id}`;
const unkey = (key: string) => key.slice(key.indexOf(":") + 1);

/**
 * Persistent game workspace owner. It keeps the global header and floating
 * windows alive while only the War Table / Scene content below it switches.
 */
export function GameShell(props: GameBoardProps) {
  const {
    state,
    characters,
    dmPanel,
    enemyDbPanel,
    dmToken,
    onSetNote,
    onIncrement,
    onAdvance,
    onResetEconomy,
    onPatch,
    onAddResource,
    onUpdateResource,
    onRemoveResource,
    onAddRecipe,
    onUpdateRecipe,
    onRemoveRecipe,
    onUpdateCharacter,
    onCreateCharacter,
    onJoinBattle,
    onAddCharacterResource,
    onUpdateCharacterResource,
    onRemoveCharacterResource,
    onAddCharacterRecipe,
    onUpdateCharacterRecipe,
    onRemoveCharacterRecipe,
  } = props;

  const t = useT();
  const [workspace, setWorkspace] = useState<Workspace>("war");
  const zTop = useRef(20);
  const cards = useWindowSet<CharacterKey>(zTop, { x: 80, y: 70 });
  const rules = useWindowSet<RulesKey>(zTop, { x: 140, y: 130 });
  const shell = useWindowSet<ShellKey>(zTop, { x: 420, y: 110 });
  const enemies = useWindowSet<EnemyKey>(zTop, { x: 700, y: 90 });
  const map = useWindowSet<MapKey>(zTop, { x: 260, y: 90 });

  const combatants = state.combatants.map(normalizeCombatant);
  const isDm = state.role === "dm";
  const isTablet =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("Tablet");
  const desktop =
    typeof window === "undefined"
      ? { force: false }
      : desktopOverride(window.location.search);
  const activeWorkspace: Workspace = isTablet ? "war" : workspace;

  const openCharacter = (characterId: string) => cards.open(characterKey(characterId));
  /** Make a blank card and land the user in its editor (not in the strip). */
  const newCard = async () => {
    const id = await onCreateCharacter?.();
    if (id !== undefined) openCharacter(id);
  };
  const openRules = (characterId: string) => rules.open(rulesKey(characterId));
  const openEnemy = (combatantId: string) => enemies.open(enemyKey(combatantId));

  return (
    <>
      <div
        className={desktop.force ? "wt wt-desktop" : "wt"}
        style={desktop.zoom !== undefined ? { zoom: desktop.zoom } : undefined}
      >
        <GlobalHeader
          activeWorkspace={activeWorkspace}
          canUseScene={!isTablet}
          role={isDm ? "DM" : "PLAYER"}
          combatants={combatants}
          currentTurnId={state.currentTurnId}
          round={state.round}
          canAdvance={combatants.length > 0}
          hasDmPanel={dmPanel !== undefined}
          hasEnemyDbPanel={enemyDbPanel !== undefined}
          canUseFloatingMap={!isTablet && activeWorkspace === "war"}
          onSelectWorkspace={setWorkspace}
          onAdvance={onAdvance}
          onResetEconomy={onResetEconomy}
          onOpenNote={() => shell.open("note")}
          onOpenDm={() => shell.open("dm")}
          onOpenEnemyDb={() => shell.open("enemydb")}
          onOpenMap={() => map.open("map")}
        />

        {activeWorkspace === "war" ? (
          <GameBoard
            {...props}
            onOpenCard={openCharacter}
            onNewCard={newCard}
            onOpenClassRules={openRules}
            onOpenEnemyEditor={openEnemy}
          />
        ) : (
          <div className="wt-scene">
            <MapBoard
              playerToken={state.playerToken}
              dmToken={dmToken}
              fullPage
              characters={characters}
              combatants={combatants}
              onOpenCharacter={openCharacter}
            />
          </div>
        )}
      </div>

      <div className="wt wt-float-layer">
        {shell.wins.note !== undefined && (
          <ShellWindow
            title={`📋 ${t.shell.sharedBoard}`}
            win={shell.wins.note}
            onDrag={(x, y) => shell.drag("note", x, y)}
            onFocus={() => shell.focus("note")}
            onFold={() => shell.fold("note")}
            onClose={() => shell.close("note")}
          >
            <SharedNote
              note={state.note}
              counter={state.counter}
              onSetNote={onSetNote}
              onIncrement={onIncrement}
            />
          </ShellWindow>
        )}

        {dmPanel && shell.wins.dm !== undefined && (
          <ShellWindow
            title="🗝 DM"
            win={shell.wins.dm}
            onDrag={(x, y) => shell.drag("dm", x, y)}
            onFocus={() => shell.focus("dm")}
            onFold={() => shell.fold("dm")}
            onClose={() => shell.close("dm")}
          >
            {dmPanel}
          </ShellWindow>
        )}

        {enemyDbPanel && shell.wins.enemydb !== undefined && (
          <ShellWindow
            title={`👹 ${t.shell.enemyDb}`}
            win={shell.wins.enemydb}
            onDrag={(x, y) => shell.drag("enemydb", x, y)}
            onFocus={() => shell.focus("enemydb")}
            onFold={() => shell.fold("enemydb")}
            onClose={() => shell.close("enemydb")}
          >
            {enemyDbPanel}
          </ShellWindow>
        )}

        {Object.entries(enemies.wins).map(([key, win]) => {
          if (win === undefined) return null;
          const id = unkey(key);
          const combatant = combatants.find((c) => c._id === id);
          if (combatant === undefined) return null;
          const typedKey = key as EnemyKey;
          return (
            <ShellWindow
              key={key}
              title={`👹 ${combatant.name}`}
              win={win}
              onDrag={(x, y) => enemies.drag(typedKey, x, y)}
              onFocus={() => enemies.focus(typedKey)}
              onFold={() => enemies.fold(typedKey)}
              onClose={() => enemies.close(typedKey)}
            >
              <EnemyEditorWindow
                combatant={combatant}
                showDmNotes={isDm}
                onPatch={(patch) => onPatch(combatant._id, patch)}
                onAddResource={onAddResource}
                onUpdateResource={onUpdateResource}
                onRemoveResource={onRemoveResource}
                onAddRecipe={onAddRecipe}
                onUpdateRecipe={onUpdateRecipe}
                onRemoveRecipe={onRemoveRecipe}
              />
            </ShellWindow>
          );
        })}

        {!isTablet && activeWorkspace === "war" && map.wins.map !== undefined && (
          <MapWindow
            playerToken={state.playerToken}
            dmToken={dmToken}
            win={map.wins.map}
            onDrag={(x, y) => map.drag("map", x, y)}
            onFocus={() => map.focus("map")}
            onFold={() => map.fold("map")}
            onClose={() => map.close("map")}
          />
        )}
      </div>

      {characters !== undefined &&
        Object.entries(cards.wins).map(([key, win]) => {
          if (win === undefined) return null;
          const id = unkey(key);
          const character = characters.find((c) => c._id === id);
          if (character === undefined) return null;
          const combatant = combatants.find((c) => c.characterId === id) ?? null;
          const typedKey = key as CharacterKey;
          return (
            <CharacterCardWindow
              key={key}
              character={character}
              combatant={combatant}
              win={win}
              inBattle={combatant !== null}
              readOnly={state.playgroundMode && character.seedKey !== null}
              onDrag={(x, y) => cards.drag(typedKey, x, y)}
              onFocus={() => cards.focus(typedKey)}
              onFold={() => cards.fold(typedKey)}
              onClose={() => cards.close(typedKey)}
              onUpdateCharacter={onUpdateCharacter}
              onJoinBattle={(characterId) => onJoinBattle?.(characterId)}
              onAddResource={(label, max) => onAddCharacterResource(id, label, max)}
              onUpdateResource={onUpdateCharacterResource}
              onRemoveResource={onRemoveCharacterResource}
              onAddRecipe={(recipe) => onAddCharacterRecipe(id, recipe)}
              onUpdateRecipe={onUpdateCharacterRecipe}
              onRemoveRecipe={onRemoveCharacterRecipe}
              onPatchCombatant={
                combatant ? (patch) => onPatch(combatant._id, patch) : undefined
              }
            />
          );
        })}

      {characters !== undefined &&
        Object.entries(rules.wins).map(([key, win]) => {
          if (win === undefined) return null;
          const id = unkey(key);
          const character = characters.find((c) => c._id === id);
          if (character === undefined) return null;
          const typedKey = key as RulesKey;
          return (
            <ClassRulesWindow
              key={key}
              character={character}
              win={win}
              onDrag={(x, y) => rules.drag(typedKey, x, y)}
              onFocus={() => rules.focus(typedKey)}
              onFold={() => rules.fold(typedKey)}
              onClose={() => rules.close(typedKey)}
            />
          );
        })}
    </>
  );
}

type GlobalHeaderProps = {
  activeWorkspace: Workspace;
  canUseScene: boolean;
  role: "DM" | "PLAYER";
  combatants: CombatantView[];
  currentTurnId: string | null;
  round: number;
  canAdvance: boolean;
  hasDmPanel: boolean;
  hasEnemyDbPanel: boolean;
  canUseFloatingMap: boolean;
  onSelectWorkspace: (workspace: Workspace) => void;
  onAdvance: () => void;
  onResetEconomy: () => void;
  onOpenNote: () => void;
  onOpenDm: () => void;
  onOpenEnemyDb: () => void;
  onOpenMap: () => void;
};

export function GlobalHeader({
  activeWorkspace,
  canUseScene,
  role,
  combatants,
  currentTurnId,
  round,
  canAdvance,
  hasDmPanel,
  hasEnemyDbPanel,
  canUseFloatingMap,
  onSelectWorkspace,
  onAdvance,
  onResetEconomy,
  onOpenNote,
  onOpenDm,
  onOpenEnemyDb,
  onOpenMap,
}: GlobalHeaderProps) {
  const t = useT();
  const tab = (workspace: Workspace, label: string) => {
    const active = activeWorkspace === workspace;
    return (
      <button
        type="button"
        className={active ? "wt-topnav wt-topnav-active" : "wt-topnav"}
        aria-current={active ? "page" : undefined}
        onClick={() => {
          if (!active) onSelectWorkspace(workspace);
        }}
      >
        ⚜ {label}
      </button>
    );
  };

  return (
    <header className="wt-panel wt-top" aria-label="global game header">
      <div className="wt-workspace-tabs" role="navigation" aria-label="workspaces">
        {tab("war", t.shell.warTable)}
        {canUseScene && tab("scene", t.shell.scene)}
      </div>
      <span className="wt-role">{role}</span>
      <TurnRibbon combatants={combatants} currentTurnId={currentTurnId} round={round} />
      <button onClick={onAdvance} disabled={!canAdvance}>
        {t.shell.nextTurn}
      </button>
      <button onClick={onResetEconomy}>{t.shell.resetEconomy}</button>
      <button onClick={onOpenNote}>📋 {t.shell.sharedBoard}</button>
      {hasDmPanel && <button onClick={onOpenDm}>🗝 DM</button>}
      {hasEnemyDbPanel && <button onClick={onOpenEnemyDb}>👹 {t.shell.enemyDb}</button>}
      {canUseFloatingMap && <button onClick={onOpenMap}>🗺 {t.shell.map}</button>}
      <LanguageSwitch />
    </header>
  );
}

