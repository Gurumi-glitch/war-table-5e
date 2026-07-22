import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../api";
import type { Id } from "../../convex/_generated/dataModel";
import { useT } from "../i18n";
import type { MapView } from "../../convex/maps";
import type { PieceView } from "../../convex/pieces";
import type { FlavorDieView } from "../../convex/flavorDice";
import type { CharacterView } from "../../convex/characters";
import type { GameState } from "../../convex/games";
import type { EnemyView } from "../../convex/enemies";
import { DICE_SIDES, type DieType } from "../../convex/diceHelpers";
import { pickNextColor } from "../../convex/colors";
import { FEET_PER_SQUARE, gridSteps } from "../lib/mapGrid";
import { enemyMatchesQuery } from "../lib/enemySearch";
import { TumbleNumber } from "./DieFace";
import "./MapBoard.css";

/**
 * The shared 地圖 (Map) board — image + derived grid + draggable chess pieces +
 * a global backstage holding pen + a shared non-combat mini dice board
 * (add-map-system / ADR-0011).
 *
 * DELIBERATE ARCHITECTURE NOTE: `MapBoard` still owns map/piece/flavor-dice
 * Convex hooks because it is mounted in two places: full Scene content and the
 * floating map window. Character-card windows are different: GameShell owns
 * those globally, so the full Scene picker receives character/combatant data
 * and calls `onOpenCharacter` instead of duplicating character mutations here.
 *
 * ADR-0011 boundary: a piece's position is display data only — nothing here is
 * ever read by the Confirm engine / combat resolution.
 */
export type MapBoardProps = {
  playerToken: string;
  /** Present only for the DM (Backstage). Gates map management + enemy pieces. */
  dmToken?: string;
  /** Full Scene mount: shows the character picker. Floating map omits it. */
  fullPage?: boolean;
  characters?: CharacterView[];
  combatants?: GameState["combatants"];
  onOpenCharacter?: (characterId: string) => void;
};

/** Convex file-storage upload: POST the blob to a one-shot URL, get its id. */
async function uploadFile(
  generateUploadUrl: () => Promise<string>,
  file: File,
): Promise<Id<"_storage">> {
  const url = await generateUploadUrl();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
  });
  const json = (await res.json()) as { storageId: string };
  return json.storageId as Id<"_storage">;
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

// Map zoom (improve-scene-ux D4): display-only magnification. 1.0 = fit the
// available space (current behavior); >1 grows the frame past the viewport and
// scrolls. Sizing is done in layout (CSS var → frame width), NOT transform, so
// drag-drop coordinate math (getBoundingClientRect ÷ cols) stays correct.
const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.5;

export function MapBoard({
  playerToken,
  dmToken,
  fullPage,
  characters,
  combatants,
  onOpenCharacter,
}: MapBoardProps) {
  const t = useT();
  const isDm = dmToken !== undefined && dmToken !== "";

  const mapsData = useQuery(api.maps.list, { playerToken, dmToken });
  const pieces = useQuery(api.pieces.list, { playerToken, dmToken }) as
    | PieceView[]
    | undefined;
  const flavor = useQuery(api.flavorDice.list, { playerToken }) as
    | FlavorDieView[]
    | undefined;
  const queriedCharacters = useQuery(
    api.characters.list,
    characters === undefined ? { playerToken } : "skip",
  ) as CharacterView[] | undefined;
  // Enemy templates are DM-gated on the backend; only subscribe as the DM.
  const enemies = useQuery(
    api.enemies.list,
    isDm ? { playerToken, dmToken } : "skip",
  ) as EnemyView[] | undefined;

  const movePiece = useMutation(api.pieces.move);

  const boardRef = useRef<HTMLDivElement | null>(null);
  const backstageRef = useRef<HTMLDivElement | null>(null);
  const [ghost, setGhost] = useState<{
    piece: PieceView;
    x: number;
    y: number;
  } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const zoomBy = (delta: number) =>
    setZoom((z) => clamp(Math.round((z + delta) * 10) / 10, ZOOM_MIN, ZOOM_MAX));

  // TTS tablet strips the map (ADR-0006 / ADR-0011), so the picker + floating
  // card manager never mount there.
  const isTablet =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("Tablet");

  const activeMapId = mapsData?.activeMapId ?? null;
  const maps: MapView[] = mapsData?.maps ?? [];
  const activeMap = maps.find((m) => m._id === activeMapId) ?? null;
  const displayCharacters = characters ?? queriedCharacters;

  const boardPieces = (pieces ?? []).filter(
    (p) => p.location.kind === "board" && p.location.mapId === activeMapId,
  );
  const backstagePieces = (pieces ?? []).filter(
    (p) => p.location.kind === "backstage",
  );

  // Which characters are already linked to a combatant in this Game.
  const inBattleCharacterIds = new Set(
    (combatants ?? [])
      .map((c) => c.characterId)
      .filter((id): id is string => id !== null),
  );

  // Resolve where a drop landed based on the surface actually visible under
  // the pointer. A zoomed grid's layout rect can extend below the side panel,
  // but clipped/covered pixels must never steal drops from the backstage.
  // One move mutation fires on drop — never per move.
  const dropLocation = (
    clientX: number,
    clientY: number,
  ): PieceView["location"] | null => {
    const hit = document.elementFromPoint(clientX, clientY);
    if (hit === null) return null;

    if (backstageRef.current?.contains(hit)) {
      const r = backstageRef.current.getBoundingClientRect();
      const x = clamp(((clientX - r.left) / r.width) * 100, 0, 100);
      const y = clamp(((clientY - r.top) / r.height) * 100, 0, 100);
      return { kind: "backstage", x, y };
    }

    if (activeMap && boardRef.current?.contains(hit)) {
      const r = boardRef.current.getBoundingClientRect();
      const col = clamp(
        Math.floor(((clientX - r.left) / r.width) * activeMap.cols),
        0,
        activeMap.cols - 1,
      );
      const row = clamp(
        Math.floor(((clientY - r.top) / r.height) * activeMap.rows),
        0,
        activeMap.rows - 1,
      );
      return { kind: "board", mapId: activeMap._id as string, row, col };
    }

    return null;
  };

  // Cleanup for whichever piece drag is currently in flight (if any), so an
  // unmount mid-drag (map switch, window closed by another connected client)
  // can't leave window-level listeners dangling to hijack the next unrelated
  // pointer interaction.
  const dragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanupRef.current?.(), []);

  const beginDrag = (piece: PieceView, e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // A second piece grabbed before the first drag ended would otherwise
    // overwrite the ref and leak the first drag's window listeners forever
    // (never torn down by the unmount effect, which only runs the LAST
    // assigned cleanup) — tear down any drag still in flight first.
    dragCleanupRef.current?.();
    setDraggingId(piece._id as string);
    setGhost({ piece, x: e.clientX, y: e.clientY });
    const move = (ev: PointerEvent) =>
      setGhost({ piece, x: ev.clientX, y: ev.clientY });
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      dragCleanupRef.current = null;
      setDraggingId(null);
      setGhost(null);
    };
    const up = (ev: PointerEvent) => {
      cleanup();
      const loc = dropLocation(ev.clientX, ev.clientY);
      if (loc !== null) {
        void movePiece({
          playerToken,
          pieceId: piece._id as Id<"pieces">,
          location: loc as any,
        });
      }
    };
    const cancel = () => cleanup(); // aborted drag: no move committed
    dragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  return (
    <div className="mb-root">
      <div className="mb-main">
        <div className="mb-boardcol">
          {/* Zoom toolbar (improve-scene-ux D4) — display-only; − / reset / ＋. */}
          {activeMap && (
            <div className="mb-zoombar">
              <button
                className="mb-btn"
                onClick={() => zoomBy(-ZOOM_STEP)}
                disabled={zoom <= ZOOM_MIN}
                aria-label="zoom out"
              >
                −
              </button>
              <button
                className="mb-btn"
                onClick={() => setZoom(1)}
                aria-label="reset zoom"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                className="mb-btn"
                onClick={() => zoomBy(ZOOM_STEP)}
                disabled={zoom >= ZOOM_MAX}
                aria-label="zoom in"
              >
                ＋
              </button>
            </div>
          )}
          {/* Active map board — aspect-ratio-locked frame + grid + pieces. */}
          {activeMap ? (
            <div className="mb-boardcol-stage">
              <div
                className="mb-frame"
                style={
                  {
                    ["--mb-ar" as string]:
                      `${activeMap.cols} / ${activeMap.rows}`,
                    ["--mb-zoom" as string]: zoom,
                  } as CSSProperties
                }
              >
              {activeMap.imageUrl && (
                <img
                  className="mb-img"
                  src={activeMap.imageUrl}
                  alt={activeMap.name}
                  draggable={false}
                />
              )}
              <div
                ref={boardRef}
                className="mb-grid"
                style={{
                  gridTemplateColumns: `repeat(${activeMap.cols}, 1fr)`,
                  gridTemplateRows: `repeat(${activeMap.rows}, 1fr)`,
                } as CSSProperties}
              >
                <svg
                  className="mb-grid-lines"
                  viewBox={`0 0 ${activeMap.cols} ${activeMap.rows}`}
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  {Array.from({ length: activeMap.cols + 1 }, (_, col) => (
                    <line
                      key={`col-${col}`}
                      x1={col}
                      x2={col}
                      y1={0}
                      y2={activeMap.rows}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                  {Array.from({ length: activeMap.rows + 1 }, (_, row) => (
                    <line
                      key={`row-${row}`}
                      x1={0}
                      x2={activeMap.cols}
                      y1={row}
                      y2={row}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                </svg>
                {boardPieces.map((p) => {
                  const loc = p.location as {
                    kind: "board";
                    row: number;
                    col: number;
                  };
                  // Offset overlapping pieces in the same cell so a stack stays
                  // distinguishable + independently draggable.
                  const stackIdx = boardPieces
                    .filter(
                      (q) =>
                        q.location.kind === "board" &&
                        q.location.row === loc.row &&
                        q.location.col === loc.col,
                    )
                    .findIndex((q) => q._id === p._id);
                  return (
                    <div
                      key={p._id}
                      className="mb-cell-piece"
                      style={{
                        gridColumn: loc.col + 1,
                        gridRow: loc.row + 1,
                        transform: `translate(${stackIdx * 18}%, ${stackIdx * 18}%)`,
                        zIndex: 2 + stackIdx,
                      }}
                    >
                      <PieceToken
                        piece={p}
                        onPointerDown={(e) => beginDrag(p, e)}
                        isDragging={draggingId === (p._id as string)}
                      />
                    </div>
                  );
                })}
              </div>
              </div>
            </div>
          ) : (
            <div className="mb-empty">
              {isDm
                ? t.map.noActiveMapDm
                : t.map.noActiveMapPlayer}
            </div>
          )}

          <FlavorDiceBar
            flavor={flavor ?? []}
            playerToken={playerToken}
          />
        </div>

        <div className="mb-side">
          {/* Character-card picker (only on the full-page map, not the floating
           * MapWindow inside the war table, and not on the TTS tablet per
           * ADR-0006/ADR-0011). Click a name to open the full editable card
           * as a global floating pop-up. Opening is side-effect free; explicit
           * Join battle remains inside the card. */}
          {fullPage && !isTablet && displayCharacters !== undefined && (
            <CharacterCardPicker
              characters={displayCharacters}
              inBattleCharacterIds={inBattleCharacterIds}
              onOpenCard={(id) => onOpenCharacter?.(id)}
            />
          )}

          {/* Global backstage: free x/y holding pen, no grid snapping. */}
          <div className="mb-panel">
            <div className="mb-panel-title">{t.map.backstagePanel}</div>
            <div ref={backstageRef} className="mb-backstage">
              {backstagePieces.map((p) => {
                const loc = p.location as {
                  kind: "backstage";
                  x: number;
                  y: number;
                };
                // Fan out pieces sharing the exact same backstage position (all
                // new pieces default to 50/50) so each stays individually
                // visible + draggable — mirrors the board's same-cell offset.
                const stackIdx = backstagePieces
                  .filter(
                    (q) =>
                      q.location.kind === "backstage" &&
                      q.location.x === loc.x &&
                      q.location.y === loc.y,
                  )
                  .findIndex((q) => q._id === p._id);
                return (
                  <div
                    key={p._id}
                    className="mb-bs-piece"
                    style={{
                      left: `${loc.x}%`,
                      top: `${loc.y}%`,
                      transform: `translate(calc(-50% + ${stackIdx * 18}%), calc(-50% + ${stackIdx * 18}%))`,
                      zIndex: 2 + stackIdx,
                    }}
                  >
                    <PieceToken
                      piece={p}
                      onPointerDown={(e) => beginDrag(p, e)}
                      isDragging={draggingId === (p._id as string)}
                    />
                  </div>
                );
              })}
              {backstagePieces.length === 0 && (
                <div className="mb-backstage-hint">
                  {t.map.backstageHint}
                </div>
              )}
            </div>
          </div>

          <AddPieceForm
            playerToken={playerToken}
            dmToken={dmToken}
            isDm={isDm}
            characters={displayCharacters ?? []}
            enemies={enemies ?? []}
            pieces={pieces ?? []}
          />

          <PieceManager playerToken={playerToken} pieces={pieces ?? []} />

          {isDm && (
            <MapLibraryPanel
              playerToken={playerToken}
              dmToken={dmToken as string}
              maps={maps}
              activeMapId={activeMapId}
            />
          )}
        </div>
      </div>

      {/* Floating drag ghost — follows the pointer during a drag. */}
      {ghost && (
        <div
          className="mb-ghost"
          style={{ left: ghost.x, top: ghost.y }}
          aria-hidden
        >
          <PieceToken piece={ghost.piece} />
        </div>
      )}
    </div>
  );
}

/** A single piece token: portrait if set, otherwise the label's first glyph. */
function PieceToken({
  piece,
  onPointerDown,
  isDragging,
}: {
  piece: PieceView;
  onPointerDown?: (e: ReactPointerEvent) => void;
  isDragging?: boolean;
}) {
  return (
    <div
      className={`mb-token${isDragging ? " mb-token-dragging" : ""}`}
      style={{ borderColor: piece.color, background: piece.color }}
      title={piece.label}
      onPointerDown={onPointerDown}
    >
      {piece.portraitUrl ? (
        <img className="mb-token-img" src={piece.portraitUrl} alt={piece.label} draggable={false} />
      ) : (
        <span className="mb-token-initial">
          {[...piece.label][0] ?? "?"}
        </span>
      )}
    </div>
  );
}

/**
 * A panel title that doubles as a fold/unfold toggle (improve-scene-ux D3).
 * ▾ = expanded, ▸ = collapsed. `aria-expanded` drives both a11y and tests.
 */
function PanelHeader({
  label,
  open,
  onToggle,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="mb-panel-toggle"
      aria-expanded={open}
      onClick={onToggle}
    >
      <span className="mb-panel-caret" aria-hidden>
        ▸
      </span>
      {label}
    </button>
  );
}

/** The shared non-combat mini dice board (add-map-system / map-flavor-dice). */
function FlavorDiceBar({
  flavor,
  playerToken,
}: {
  flavor: FlavorDieView[];
  playerToken: string;
}) {
  const msg = useT();
  const roll = useMutation(api.flavorDice.roll);
  const types: DieType[] = ["d20", "d12", "d10", "d8", "d6", "d4", "d100"];
  const valueOf = (t: DieType) =>
    flavor.find((d) => d.type === t)?.value ?? null;
  return (
    <div className="mb-panel mb-dice">
      <div className="mb-panel-title">{msg.map.flavorDice}</div>
      <div className="mb-dice-row">
        {types.map((t) => (
          <button
            key={t}
            className="mb-die"
            onClick={() => void roll({ playerToken, type: t })}
            title={msg.map.rollDie(t)}
          >
            <span className="mb-die-type">{t === "d100" ? "d%" : t}</span>
            <TumbleNumber
              value={valueOf(t)}
              sides={DICE_SIDES[t]}
              className="mb-die-val"
              fallback="—"
            />
          </button>
        ))}
      </div>
    </div>
  );
}

/** Create a piece: linked (Character / Enemy [DM-only]) or ad-hoc. */
function AddPieceForm({
  playerToken,
  dmToken,
  isDm,
  characters,
  enemies,
  pieces,
}: {
  playerToken: string;
  dmToken?: string;
  isDm: boolean;
  characters: CharacterView[];
  enemies: EnemyView[];
  pieces: PieceView[];
}) {
  const t = useT();
  const createPiece = useMutation(api.pieces.create);
  const [source, setSource] = useState<"character" | "enemy" | "none">("none");
  const [characterId, setCharacterId] = useState("");
  const [enemyId, setEnemyId] = useState("");
  const [enemyQuery, setEnemyQuery] = useState("");
  const [label, setLabel] = useState("");

  // Spawn color auto-rotates (improve-scene-ux D1): the pre-selected color is
  // the next palette color not already used by a piece in play, recomputed as
  // pieces come and go — UNLESS the DM manually picked one, which always wins
  // (`colorTouched`) until the next spawn resets the rotation (ADR-0002).
  const usedColors = pieces.map((p) => p.color);
  const usedKey = usedColors.join(",");
  const [color, setColor] = useState(() => pickNextColor(usedColors));
  const [colorTouched, setColorTouched] = useState(false);
  useEffect(() => {
    if (!colorTouched) setColor(pickNextColor(usedKey === "" ? [] : usedKey.split(",")));
    // usedKey is the stable projection of usedColors; re-run when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usedKey, colorTouched]);

  const submit = () => {
    if (source === "character") {
      if (characterId === "") return;
      void createPiece({
        playerToken,
        sourceType: "character",
        characterId: characterId as Id<"characters">,
        color,
      });
    } else if (source === "enemy") {
      if (enemyId === "" || !isDm) return;
      void createPiece({
        playerToken,
        dmToken,
        sourceType: "enemy",
        enemyId: enemyId as Id<"enemies">,
        color,
      });
    } else {
      if (label.trim() === "") return;
      void createPiece({
        playerToken,
        sourceType: "none",
        label: label.trim(),
        color,
      });
    }
    // Clear the specific subject so a second click can't silently spawn a
    // duplicate; keep the source tab (deliberate "spawn several of the same
    // kind" affordance). Release the manual color hold so the next piece
    // rotates to a fresh unused color — counting the one just spawned.
    setLabel("");
    setCharacterId("");
    setEnemyId("");
    setColor(pickNextColor([...usedColors, color]));
    setColorTouched(false);
  };

  return (
    <div className="mb-panel">
      <div className="mb-panel-title">{t.map.addPiece}</div>
      <div className="mb-form">
        <div className="mb-source-tabs">
          <button
            className={source === "character" ? "mb-tab mb-tab-on" : "mb-tab"}
            onClick={() => setSource("character")}
          >
            {t.map.srcCharacter}
          </button>
          {isDm && (
            <button
              className={source === "enemy" ? "mb-tab mb-tab-on" : "mb-tab"}
              onClick={() => setSource("enemy")}
            >
              {t.map.srcEnemy}
            </button>
          )}
          <button
            className={source === "none" ? "mb-tab mb-tab-on" : "mb-tab"}
            onClick={() => setSource("none")}
          >
            {t.map.srcCustom}
          </button>
        </div>

        {source === "character" && (
          <select
            className="mb-input"
            value={characterId}
            onChange={(e) => setCharacterId(e.target.value)}
            aria-label="pick character"
          >
            <option value="">{t.map.pickCharacter}</option>
            {characters.map((c) => (
              <option key={c._id} value={c._id}>
                {t.terms.displayName(c.nameZh, c.nameEn)}
              </option>
            ))}
          </select>
        )}
        {source === "enemy" && (
          <>
            <input
              className="mb-input"
              value={enemyQuery}
              onChange={(e) => setEnemyQuery(e.target.value)}
              placeholder={t.map.searchEnemy}
              aria-label="search enemy"
            />
            <select
              className="mb-input"
              value={enemyId}
              onChange={(e) => setEnemyId(e.target.value)}
              aria-label="pick enemy"
            >
              <option value="">{t.map.pickEnemy}</option>
              {enemies
                .filter((e) => enemyMatchesQuery(e, enemyQuery))
                .map((e) => (
                  <option key={e._id} value={e._id}>
                    {t.terms.displayName(e.nameZh, e.nameEn)}
                  </option>
                ))}
            </select>
          </>
        )}
        {source === "none" && (
          <input
            className="mb-input"
            placeholder={t.map.pieceName}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            aria-label="piece label"
          />
        )}

        <label className="mb-color-row">
          {t.map.color}
          <input
            type="color"
            value={color}
            onChange={(e) => {
              setColor(e.target.value);
              setColorTouched(true);
            }}
            aria-label="piece color"
          />
        </label>
        <button className="mb-btn mb-btn-primary" onClick={submit}>
          {t.map.addToBackstage}
        </button>
      </div>
    </div>
  );
}

/**
 * Per-piece management (task 7.2/7.3): set a custom portrait (override,
 * independent of source), rename/recolor, and delete. Open to any caller — a
 * list avoids stealing pointer events from the tokens' drag handler.
 */
function PieceDraftInput({
  type = "text",
  value,
  ariaLabel,
  onCommit,
  className,
  style,
}: {
  type?: "text" | "color";
  value: string;
  ariaLabel: string;
  onCommit: (value: string) => void;
  className?: string;
  style?: CSSProperties;
}) {
  // Keep live subscription echoes out of the active edit: a mutation on every
  // keystroke can replace a controlled value mid-composition and corrupt CJK
  // IME input. Re-adopt the shared value only when that value actually changes.
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <input
      type={type}
      className={className}
      style={style}
      value={draft}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function PieceManager({
  playerToken,
  pieces,
}: {
  playerToken: string;
  pieces: PieceView[];
}) {
  const t = useT();
  const generateUploadUrl = useMutation(api.pieces.generateUploadUrl);
  const updatePortrait = useMutation(api.pieces.updatePortrait);
  const updateLabel = useMutation(api.pieces.updateLabel);
  const removePiece = useMutation(api.pieces.remove);
  const [open, setOpen] = useState(true);

  const onPortrait = async (pieceId: string, file: File | null) => {
    if (file === null) return;
    const portraitStorageId = await uploadFile(
      () => generateUploadUrl({ playerToken }),
      file,
    );
    await updatePortrait({
      playerToken,
      pieceId: pieceId as Id<"pieces">,
      portraitStorageId,
    });
  };

  if (pieces.length === 0) return null;

  return (
    <div className="mb-panel">
      <PanelHeader
        label={t.map.pieceManager}
        open={open}
        onToggle={() => setOpen((v) => !v)}
      />
      <div className={`mb-fold-body${open ? " mb-fold-open" : ""}`}>
        <div className="mb-fold-inner">
          <ul className="mb-maplist">
            {pieces.map((p) => (
              <li key={p._id} className="mb-maprow">
                <div className="mb-maprow-head">
                  <PieceDraftInput
                    value={p.label}
                    ariaLabel={`rename ${p.label}`}
                    className="mb-input"
                    style={{ flex: 1 }}
                    onCommit={(label) =>
                      void updateLabel({
                        playerToken,
                        pieceId: p._id as Id<"pieces">,
                        label,
                      })
                    }
                  />
                  <PieceDraftInput
                    type="color"
                    value={p.color}
                    ariaLabel={`recolor ${p.label}`}
                    onCommit={(color) =>
                      void updateLabel({
                        playerToken,
                        pieceId: p._id as Id<"pieces">,
                        color,
                      })
                    }
                  />
                </div>
                <div className="mb-maprow-actions">
                  <label className="mb-btn">
                    {t.map.changeAvatar}
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      aria-label={`portrait ${p.label}`}
                      onChange={(e) =>
                        void onPortrait(p._id, e.target.files?.[0] ?? null)
                      }
                    />
                  </label>
                  {p.portraitUrl && (
                    <button
                      className="mb-btn"
                      onClick={() =>
                        void updatePortrait({
                          playerToken,
                          pieceId: p._id as Id<"pieces">,
                        })
                      }
                    >
                      {t.map.clearAvatar}
                    </button>
                  )}
                  <button
                    className="mb-btn mb-btn-danger"
                    onClick={() =>
                      void removePiece({
                        playerToken,
                        pieceId: p._id as Id<"pieces">,
                      })
                    }
                  >
                    {t.common.delete}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/**
 * Character-card picker for the full-page map (issue #9 step 4 parity). Click
 * a name to open the full editable parchment card as a floating pop-up; same
 * behavior as the war table's CharactersPanel → floating card. The "in battle"
 * ⚔ marker matches `CharactersPanel` (Frontstage/Backstage) so a player can
 * tell at a glance which cards are already linked to combatants.
 */
function CharacterCardPicker({
  characters,
  inBattleCharacterIds,
  onOpenCard,
}: {
  characters: CharacterView[];
  inBattleCharacterIds: Set<string>;
  onOpenCard: (characterId: string) => void;
}) {
  const t = useT();
  if (characters.length === 0) return null;
  return (
    <div className="mb-panel">
      <div className="mb-panel-title">{t.map.characterCards}</div>
      <ul className="mb-charpick">
        {characters.map((c) => {
          const inBattle = inBattleCharacterIds.has(c._id);
          return (
            <li key={c._id}>
              <button
                type="button"
                className={
                  inBattle
                    ? "mb-charpick-btn mb-charpick-btn-on"
                    : "mb-charpick-btn"
                }
                onClick={() => onOpenCard(c._id)}
                title={`${c.player} · ${c.classesText.split("\n")[0]} · HP ${c.hp}/${c.maxHp} · AC ${c.ac}`}
              >
                📜 {t.terms.displayName(c.nameZh, c.nameEn)}
                {inBattle && <small className="mb-charpick-sword"> ⚔</small>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** DM-only: upload maps, pick the active map, delete, re-grid. */
function MapLibraryPanel({
  playerToken,
  dmToken,
  maps,
  activeMapId,
}: {
  playerToken: string;
  dmToken: string;
  maps: MapView[];
  activeMapId: string | null;
}) {
  const t = useT();
  const generateUploadUrl = useMutation(api.maps.generateUploadUrl);
  const createMap = useMutation(api.maps.create);
  const setActive = useMutation(api.maps.setActive);
  const removeMap = useMutation(api.maps.remove);
  const updateGrid = useMutation(api.maps.updateGrid);

  const [file, setFile] = useState<File | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [name, setName] = useState("");
  const [stepIdx, setStepIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);

  const steps = dims ? gridSteps(dims.w, dims.h) : [];
  const step = steps[Math.min(stepIdx, steps.length - 1)];

  const onPick = (f: File | null) => {
    setFile(f);
    setDims(null);
    if (f === null) return;
    if (name === "") setName(f.name.replace(/\.[^.]+$/, ""));
    const img = new Image();
    img.onload = () => {
      setDims({ w: img.naturalWidth, h: img.naturalHeight });
      setStepIdx(0);
    };
    img.src = URL.createObjectURL(f);
  };

  const create = async () => {
    if (file === null || dims === null || step === undefined) return;
    setBusy(true);
    try {
      const imageStorageId = await uploadFile(
        () => generateUploadUrl({ playerToken, dmToken }),
        file,
      );
      await createMap({
        playerToken,
        dmToken,
        name: name.trim() === "" ? t.map.defaultMapName : name.trim(),
        imageStorageId,
        cols: step.cols,
        rows: step.rows,
        imageWidth: dims.w,
        imageHeight: dims.h,
      });
      setFile(null);
      setDims(null);
      setName("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-panel">
      <PanelHeader
        label={t.map.mapLibrary}
        open={open}
        onToggle={() => setOpen((v) => !v)}
      />
      <div className={`mb-fold-body${open ? " mb-fold-open" : ""}`}>
        <div className="mb-fold-inner">
          <div className="mb-form">
            <label className="mb-btn mb-file-input">
              <span>{t.map.chooseImage}</span>
              <input
                className="mb-file-input-native"
                type="file"
                accept="image/*"
                aria-label="map image"
                onChange={(e) => onPick(e.target.files?.[0] ?? null)}
              />
            </label>
            <span className="mb-file-name">{file?.name ?? t.map.noFile}</span>
            {file && (
              <>
                <input
                  className="mb-input"
                  placeholder={t.map.mapName}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  aria-label="map name"
                />
                {dims && steps.length > 0 && (
                  <>
                    <input
                      type="range"
                      min={0}
                      max={steps.length - 1}
                      value={Math.min(stepIdx, steps.length - 1)}
                      onChange={(e) => setStepIdx(Number(e.target.value))}
                      aria-label="grid density"
                    />
                    <div className="mb-step-label">{step?.label}</div>
                  </>
                )}
                <button
                  className="mb-btn mb-btn-primary"
                  onClick={() => void create()}
                  disabled={busy || dims === null}
                >
                  {busy ? t.map.uploading : t.map.createMap}
                </button>
              </>
            )}
          </div>

          <ul className="mb-maplist">
            {maps.map((m) => (
              <MapRow
                key={m._id}
                map={m}
                active={m._id === activeMapId}
                onSetActive={() =>
                  void setActive({
                    playerToken,
                    dmToken,
                    mapId: m._id as Id<"maps">,
                  })
                }
                onRemove={() =>
                  void removeMap({
                    playerToken,
                    dmToken,
                    mapId: m._id as Id<"maps">,
                  })
                }
                onRegrid={(cols, rows) =>
                  void updateGrid({
                    playerToken,
                    dmToken,
                    mapId: m._id as Id<"maps">,
                    cols,
                    rows,
                  })
                }
              />
            ))}
            {maps.length === 0 && <li className="mb-list-empty">{t.map.noMaps}</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}

function MapRow({
  map,
  active,
  onSetActive,
  onRemove,
  onRegrid,
}: {
  map: MapView;
  active: boolean;
  onSetActive: () => void;
  onRemove: () => void;
  onRegrid: (cols: number, rows: number) => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);

  return (
    <li className={active ? "mb-maprow mb-maprow-on" : "mb-maprow"}>
      <div className="mb-maprow-head">
        <span className="mb-maprow-name">
          {active ? "◆ " : ""}
          {map.name}
        </span>
        <span className="mb-maprow-dim">
          {map.cols}×{map.rows}
        </span>
      </div>
      <div className="mb-maprow-actions">
        {!active && (
          <button className="mb-btn" onClick={onSetActive}>
            {t.map.setActive}
          </button>
        )}
        <button className="mb-btn" onClick={() => setEditing((v) => !v)}>
          {t.map.grid}
        </button>
        <button className="mb-btn mb-btn-danger" onClick={onRemove}>
          {t.common.delete}
        </button>
      </div>
      {editing && (
        // Keyed on the map's stored grid so a realtime re-grid from another
        // client remounts the editor at the fresh step index (design D4) —
        // never applies a stale selection captured at open time.
        <RegridEditor
          key={`${map.cols}x${map.rows}`}
          map={map}
          onApply={(cols, rows) => {
            onRegrid(cols, rows);
            setEditing(false);
          }}
        />
      )}
    </li>
  );
}

/**
 * The 格線 density slider for one map. Derives its step ladder from the image's
 * recorded natural dimensions when present (matching the ladder creation
 * offered), falling back to the stored cols/rows for legacy maps. Remounted (via
 * a key on the map's grid in `MapRow`) whenever the stored grid changes, so its
 * initial index is always derived from current data.
 */
function RegridEditor({
  map,
  onApply,
}: {
  map: MapView;
  onApply: (cols: number, rows: number) => void;
}) {
  const t = useT();
  // Prefer the true image ratio (stored at creation); fall back to the rounded
  // stored grid for maps created before natural dimensions were recorded.
  const steps =
    map.imageWidth !== null && map.imageHeight !== null
      ? gridSteps(map.imageWidth, map.imageHeight)
      : gridSteps(map.cols, map.rows);
  const current = steps.findIndex(
    (s) => s.cols === map.cols && s.rows === map.rows,
  );
  const [idx, setIdx] = useState(current < 0 ? 0 : current);

  if (steps.length === 0) return null;

  return (
    <div className="mb-regrid">
      <input
        type="range"
        min={0}
        max={steps.length - 1}
        value={Math.min(idx, steps.length - 1)}
        onChange={(e) => setIdx(Number(e.target.value))}
        aria-label="re-grid density"
      />
      <div className="mb-step-label">{steps[idx] && t.map.stepLabel(steps[idx].cols, steps[idx].rows, FEET_PER_SQUARE)}</div>
      <button
        className="mb-btn mb-btn-primary"
        onClick={() => {
          const s = steps[idx];
          if (s) onApply(s.cols, s.rows);
        }}
      >
        {t.map.apply}
      </button>
    </div>
  );
}
