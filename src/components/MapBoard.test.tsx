import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { useQuery, useMutation } from "convex/react";
import { MapBoard } from "./MapBoard";
import { api } from "../api";
import { PALETTE } from "../../convex/colors";
import type { PieceView } from "../../convex/pieces";
import type { MapView } from "../../convex/maps";
import type { EnemyView } from "../../convex/enemies";

/**
 * Issue #16 — the map board's piece drag (`beginDrag`) adds window-level
 * pointermove/pointerup listeners with no pointercancel or unmount cleanup.
 * A touch gesture interrupted by the browser (pointercancel), or the board
 * unmounting mid-drag (switching maps, window closed by another connected
 * client), left those listeners live — the next unrelated pointer press
 * anywhere on screen would resume the stale drag and drop the piece at a
 * random location.
 *
 * The real generated `api` object is a Proxy that mints a fresh, unequal
 * object on every property access (`api.pieces.list !== api.pieces.list`),
 * so it can't be used as a switch key in a useQuery mock. `../api` is mocked
 * with plain string sentinels instead — both this file and MapBoard.tsx
 * import the same mocked module, so the sentinels compare equal.
 */

vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
  ConvexReactClient: class {},
}));

vi.mock("../api", () => ({
  convex: null,
  api: {
    maps: {
      list: "maps.list",
      generateUploadUrl: "maps.generateUploadUrl",
      create: "maps.create",
      setActive: "maps.setActive",
      remove: "maps.remove",
      updateGrid: "maps.updateGrid",
    },
    pieces: {
      list: "pieces.list",
      move: "pieces.move",
      create: "pieces.create",
      generateUploadUrl: "pieces.generateUploadUrl",
      updatePortrait: "pieces.updatePortrait",
      updateLabel: "pieces.updateLabel",
      remove: "pieces.remove",
    },
    flavorDice: { list: "flavorDice.list", roll: "flavorDice.roll" },
    characters: { list: "characters.list" },
    enemies: { list: "enemies.list" },
  },
}));

const piece: PieceView = {
  _id: "pc1",
  _creationTime: 0,
  gameId: "g1",
  label: "Test Piece",
  color: "#b8355c",
  portraitStorageId: null,
  portraitUrl: null,
  sourceType: "none",
  location: { kind: "backstage", x: 50, y: 50 },
};

// Cast to `unknown` first: the mocked `../api` module hands out plain string
// sentinels where the real generated api hands out FunctionReference Proxies,
// so the precise convex/react overloads don't line up — these mocks only need
// to satisfy the test double's own shape.
const mockedUseQuery = vi.mocked(useQuery) as unknown as {
  mockImplementation: (fn: (ref: unknown) => unknown) => void;
};
const mockedUseMutation = vi.mocked(useMutation) as unknown as {
  mockImplementation: (fn: (ref: unknown) => unknown) => void;
};
let movePiece: ReturnType<typeof vi.fn>;
type UpdateLabel = (args: {
  playerToken: string;
  pieceId: string;
  label?: string;
  color?: string;
}) => Promise<void>;
let updateLabel: ReturnType<typeof vi.fn<UpdateLabel>>;
type CreatePiece = (args: { color: string; [k: string]: unknown }) => Promise<void>;
let createPiece: ReturnType<typeof vi.fn<CreatePiece>>;
let currentPieces: PieceView[];
let currentMaps: { activeMapId: string | null; maps: MapView[] };
let currentEnemies: EnemyView[] | undefined;

/** Minimal EnemyView for the enemy-picker filter test. */
function enemy(over: Partial<EnemyView> & { _id: string }): EnemyView {
  return {
    nameZh: "",
    nameEn: "",
    creatureType: "",
    themeTags: "",
    role: "",
    ...over,
  } as unknown as EnemyView;
}

beforeEach(() => {
  // jsdom has no layout engine and does not implement elementFromPoint; the
  // component's browser hit-testing contract is modeled per test below.
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: vi.fn(() => null),
  });
  movePiece = vi.fn();
  updateLabel = vi.fn<UpdateLabel>().mockResolvedValue(undefined);
  // Default create appends a same-color piece to the live subscription so
  // consecutive spawns see the previous one as "used" (mirrors Convex reactivity).
  createPiece = vi.fn<CreatePiece>((args) => {
    currentPieces = [
      ...currentPieces,
      {
        ...piece,
        _id: `sp${currentPieces.length}`,
        color: args.color,
        location: { kind: "backstage", x: 50, y: 50 },
      },
    ];
    return Promise.resolve();
  });
  currentPieces = [piece];
  currentMaps = { activeMapId: null, maps: [] };
  currentEnemies = undefined;
  mockedUseQuery.mockImplementation((ref: unknown) => {
    if (ref === api.maps.list) return currentMaps;
    if (ref === api.pieces.list) return currentPieces;
    if (ref === api.flavorDice.list) return [];
    if (ref === api.enemies.list) return currentEnemies;
    return undefined;
  });
  mockedUseMutation.mockImplementation((ref: unknown) => {
    if (ref === api.pieces.move) return movePiece;
    if (ref === api.pieces.updateLabel) return updateLabel;
    if (ref === api.pieces.create) return createPiece;
    return vi.fn();
  });
});

afterEach(() => vi.restoreAllMocks());

function renderBoard() {
  const view = render(<MapBoard playerToken="p1" characters={[]} />);
  // jsdom never lays anything out, so give the backstage drop zone a
  // plausible rect for `dropLocation`'s containment check to hit — otherwise
  // every drop is a no-op regardless of whether the drag listeners leaked,
  // and the pointercancel/unmount tests below would pass for the wrong reason.
  const backstage = view.container.querySelector(".mb-backstage") as HTMLElement;
  backstage.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200 }) as DOMRect;
  vi.mocked(document.elementFromPoint).mockReturnValue(backstage);
  return view;
}

function rect(left: number, top: number, width: number, height: number) {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  } as DOMRect;
}

function renderActiveBoard() {
  const map = {
    _id: "m1",
    name: "Test map",
    cols: 4,
    rows: 4,
    imageUrl: null,
    imageWidth: null,
    imageHeight: null,
  } as unknown as MapView;
  currentMaps = { activeMapId: "m1", maps: [map] };
  const view = render(<MapBoard playerToken="p1" characters={[]} />);
  const board = view.container.querySelector(".mb-grid") as HTMLElement;
  const backstage = view.container.querySelector(".mb-backstage") as HTMLElement;
  const stage = view.container.querySelector(".mb-boardcol-stage") as HTMLElement;
  board.getBoundingClientRect = () => rect(0, 0, 400, 400);
  backstage.getBoundingClientRect = () => rect(300, 0, 200, 200);
  return { ...view, board, backstage, stage };
}

test("dropping a piece on the visible backstage commits a backstage move", () => {
  const { container } = renderBoard();
  const token = container.querySelector(".mb-token") as HTMLElement;
  fireEvent.pointerDown(token, { clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerMove(window, { clientX: 20, clientY: 20, pointerId: 1 });
  fireEvent.pointerUp(window, { clientX: 20, clientY: 20, pointerId: 1 });
  expect(movePiece).toHaveBeenCalledWith({
    playerToken: "p1",
    pieceId: "pc1",
    location: { kind: "backstage", x: 10, y: 10 },
  });
});

test("zoomed grid cannot steal a drop visibly over the backstage", () => {
  const { container, backstage } = renderActiveBoard();
  const token = container.querySelector(".mb-token") as HTMLElement;
  // The grid's raw rect (0–400) overlaps the backstage's visible rect
  // (300–500). Paint-aware hit testing must give the backstage this drop.
  vi.mocked(document.elementFromPoint).mockReturnValue(backstage);

  fireEvent.pointerDown(token, { clientX: 310, clientY: 10, pointerId: 1 });
  fireEvent.pointerUp(window, { clientX: 350, clientY: 100, pointerId: 1 });

  expect(movePiece).toHaveBeenCalledWith({
    playerToken: "p1",
    pieceId: "pc1",
    location: { kind: "backstage", x: 25, y: 50 },
  });
});

test("a visibly hit grid cell still resolves to its board coordinates", () => {
  const { container, board } = renderActiveBoard();
  const token = container.querySelector(".mb-token") as HTMLElement;
  vi.mocked(document.elementFromPoint).mockReturnValue(board);

  fireEvent.pointerDown(token, { clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerUp(window, { clientX: 250, clientY: 125, pointerId: 1 });

  expect(movePiece).toHaveBeenCalledWith({
    playerToken: "p1",
    pieceId: "pc1",
    location: { kind: "board", mapId: "m1", row: 1, col: 2 },
  });
});

test("a clipped grid region does not accept a board drop", () => {
  const { container, stage } = renderActiveBoard();
  const token = container.querySelector(".mb-token") as HTMLElement;
  // This point is geometrically within the full grid but is not painted as a
  // grid pixel, so the browser hit test reaches its clipping stage instead.
  vi.mocked(document.elementFromPoint).mockReturnValue(stage);

  fireEvent.pointerDown(token, { clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerUp(window, { clientX: 350, clientY: 100, pointerId: 1 });

  expect(movePiece).not.toHaveBeenCalled();
});

test("pointercancel mid-drag removes the window listeners (no stray move commits)", () => {
  const { container } = renderBoard();
  const token = container.querySelector(".mb-token") as HTMLElement;
  fireEvent.pointerDown(token, { clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerCancel(window, { pointerId: 1 });
  // Now an unrelated press/move/release anywhere else — still well inside the
  // stubbed backstage rect — must not resume the cancelled drag.
  fireEvent.pointerMove(window, { clientX: 99, clientY: 99, pointerId: 2 });
  fireEvent.pointerUp(window, { clientX: 99, clientY: 99, pointerId: 2 });
  expect(movePiece).not.toHaveBeenCalled();
});

test("starting a second drag before the first ends still cleans up both (no leaked listeners)", () => {
  // A single-slot cleanup ref that's naively overwritten by the second
  // beginDrag call would leak the FIRST drag's window listeners forever (the
  // unmount effect only ever runs the LAST-assigned cleanup). Assert every
  // added pointer listener is eventually removed — under the bug, the first
  // drag's 3 listeners are added but never removed.
  const dragTypes = new Set(["pointermove", "pointerup", "pointercancel"]);
  const addSpy = vi.spyOn(window, "addEventListener");
  const removeSpy = vi.spyOn(window, "removeEventListener");
  const { container, unmount } = renderBoard();
  const token = container.querySelector(".mb-token") as HTMLElement;
  fireEvent.pointerDown(token, { clientX: 10, clientY: 10, pointerId: 1 });
  // A second touch point grabs the same piece before the first drag ends.
  fireEvent.pointerDown(token, { clientX: 15, clientY: 15, pointerId: 2 });
  unmount();
  const added = addSpy.mock.calls.filter(([type]) => dragTypes.has(type as string)).length;
  const removed = removeSpy.mock.calls.filter(([type]) => dragTypes.has(type as string)).length;
  expect(removed).toBe(added);
  addSpy.mockRestore();
  removeSpy.mockRestore();
  cleanup();
});

test("unmounting mid-drag removes the window listeners", () => {
  // React nulls the component's own DOM refs on unmount, which would make
  // `dropLocation` return null and mask a leaked listener via movePiece never
  // firing regardless of cleanup — so assert on the listener bookkeeping
  // directly instead of the mutation side effect.
  const removeSpy = vi.spyOn(window, "removeEventListener");
  const { container, unmount } = renderBoard();
  const token = container.querySelector(".mb-token") as HTMLElement;
  fireEvent.pointerDown(token, { clientX: 10, clientY: 10, pointerId: 1 });
  unmount();
  const removedTypes = removeSpy.mock.calls.map(([type]) => type);
  expect(removedTypes).toEqual(
    expect.arrayContaining(["pointermove", "pointerup", "pointercancel"]),
  );
  removeSpy.mockRestore();
  cleanup();
});

test("renaming a piece keeps the IME draft local until blur", () => {
  renderBoard();
  const input = document.querySelector(
    'input[aria-label="rename Test Piece"]',
  ) as HTMLInputElement;

  fireEvent.change(input, { target: { value: "吸" } });
  fireEvent.change(input, { target: { value: "吸血" } });
  fireEvent.change(input, { target: { value: "吸血鬼" } });

  expect(input.value).toBe("吸血鬼");
  expect(updateLabel).not.toHaveBeenCalled();

  fireEvent.blur(input);
  expect(updateLabel).toHaveBeenCalledTimes(1);
  expect(updateLabel).toHaveBeenCalledWith({
    playerToken: "p1",
    pieceId: "pc1",
    label: "吸血鬼",
  });
});

test("recoloring a piece also commits the local draft only on blur", () => {
  renderBoard();
  const input = document.querySelector(
    'input[aria-label="recolor Test Piece"]',
  ) as HTMLInputElement;

  fireEvent.change(input, { target: { value: "#123456" } });

  expect(input.value).toBe("#123456");
  expect(updateLabel).not.toHaveBeenCalled();

  fireEvent.blur(input);
  expect(updateLabel).toHaveBeenCalledTimes(1);
  expect(updateLabel).toHaveBeenCalledWith({
    playerToken: "p1",
    pieceId: "pc1",
    color: "#123456",
  });
});

test("pressing Enter commits a piece rename once", () => {
  renderBoard();
  const input = document.querySelector(
    'input[aria-label="rename Test Piece"]',
  ) as HTMLInputElement;

  input.focus();
  fireEvent.change(input, { target: { value: "史特拉德" } });
  fireEvent.keyDown(input, { key: "Enter" });

  expect(updateLabel).toHaveBeenCalledTimes(1);
  expect(updateLabel).toHaveBeenCalledWith({
    playerToken: "p1",
    pieceId: "pc1",
    label: "史特拉德",
  });
});

test("IME Enter confirms composition without prematurely committing the rename", () => {
  renderBoard();
  const input = document.querySelector(
    'input[aria-label="rename Test Piece"]',
  ) as HTMLInputElement;

  input.focus();
  fireEvent.change(input, { target: { value: "吸血鬼" } });
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });

  expect(document.activeElement).toBe(input);
  expect(updateLabel).not.toHaveBeenCalled();
});

test("a subscription update refreshes an idle piece draft", () => {
  const view = renderBoard();
  currentPieces = [{ ...piece, label: "Remote Rename", color: "#654321" }];

  view.rerender(<MapBoard playerToken="p1" characters={[]} />);

  expect(
    view.container.querySelector('input[aria-label="rename Remote Rename"]'),
  ).toHaveValue("Remote Rename");
  expect(
    view.container.querySelector('input[aria-label="recolor Remote Rename"]'),
  ).toHaveValue("#654321");
});

// ── improve-scene-ux ──────────────────────────────────────────────────────

const colorInput = () =>
  document.querySelector('input[aria-label="piece color"]') as HTMLInputElement;
const addButton = () =>
  [...document.querySelectorAll("button")].find(
    (b) => b.textContent === "新增到後台",
  ) as HTMLButtonElement;

test("spawn color pre-selects the first palette color not in play (避開已用色)", () => {
  // Board already holds pieces using the first two palette colors.
  currentPieces = [
    { ...piece, _id: "a", color: PALETTE[0] },
    { ...piece, _id: "b", color: PALETTE[1] },
  ];
  renderBoard();
  expect(colorInput().value).toBe(PALETTE[2]);
});

test("manual color pick wins and survives a subscription echo (手選色優先)", () => {
  currentPieces = [];
  const view = renderBoard();
  fireEvent.change(colorInput(), { target: { value: "#123456" } });
  expect(colorInput().value).toBe("#123456");

  // A realtime piece arrives; the manual pick must NOT be auto-rotated away.
  currentPieces = [{ ...piece, _id: "x", color: PALETTE[0] }];
  view.rerender(<MapBoard playerToken="p1" characters={[]} />);
  expect(colorInput().value).toBe("#123456");
});

test("three consecutive spawns rotate through distinct palette colors", () => {
  currentPieces = [];
  const view = renderBoard();
  const label = document.querySelector(
    'input[aria-label="piece label"]',
  ) as HTMLInputElement;

  const spawned: string[] = [];
  for (let i = 0; i < 3; i++) {
    fireEvent.change(label, { target: { value: `mob${i}` } });
    fireEvent.click(addButton());
    // The just-created piece flows back through the live subscription.
    view.rerender(<MapBoard playerToken="p1" characters={[]} />);
  }
  for (const call of createPiece.mock.calls) spawned.push(call[0].color);

  expect(spawned).toEqual([PALETTE[0], PALETTE[1], PALETTE[2]]);
  expect(new Set(spawned).size).toBe(3);
});

test("enemy picker search filters options with the shared matcher", () => {
  currentEnemies = [
    enemy({ _id: "w", nameZh: "恐狼", nameEn: "Dire Wolf" }),
    enemy({ _id: "r", nameZh: "巨鼠", nameEn: "Giant Rat" }),
  ];
  render(<MapBoard playerToken="p1" dmToken="dm1" characters={[]} />);

  // Switch to the DM-only enemy tab.
  const enemyTab = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === "敵人",
  ) as HTMLButtonElement;
  fireEvent.click(enemyTab);

  const optionLabels = () =>
    [...document.querySelectorAll('select[aria-label="pick enemy"] option')].map(
      (o) => o.textContent,
    );
  expect(optionLabels()).toEqual(["— 選擇敵人 —", "恐狼", "巨鼠"]);

  fireEvent.change(document.querySelector('input[aria-label="search enemy"]')!, {
    target: { value: "狼" },
  });
  expect(optionLabels()).toEqual(["— 選擇敵人 —", "恐狼"]);
  cleanup();
});

test("棋子管理 panel folds/unfolds and collapses its body", () => {
  renderBoard(); // one piece present → PieceManager renders
  const header = [...document.querySelectorAll("button.mb-panel-toggle")].find(
    (b) => b.textContent?.includes("棋子管理"),
  ) as HTMLButtonElement;
  const panel = header.closest(".mb-panel") as HTMLElement;
  const body = panel.querySelector(".mb-fold-body") as HTMLElement;
  expect(header.getAttribute("aria-expanded")).toBe("true");
  expect(body.classList.contains("mb-fold-open")).toBe(true);
  expect(
    document.querySelector('input[aria-label="rename Test Piece"]'),
  ).not.toBeNull();

  fireEvent.click(header);
  expect(header.getAttribute("aria-expanded")).toBe("false");
  // Body stays in the DOM but is collapsed to zero height so it can animate.
  expect(body.classList.contains("mb-fold-open")).toBe(false);
});

test("zoom control clamps to 1.0–4.0 and resets to 100%", () => {
  const map = {
    _id: "m1",
    name: "M",
    cols: 16,
    rows: 9,
    imageUrl: null,
    imageWidth: null,
    imageHeight: null,
  } as unknown as MapView;
  currentMaps = { activeMapId: "m1", maps: [map] };
  render(<MapBoard playerToken="p1" characters={[]} />);

  const out = document.querySelector(
    'button[aria-label="zoom out"]',
  ) as HTMLButtonElement;
  const inn = document.querySelector(
    'button[aria-label="zoom in"]',
  ) as HTMLButtonElement;
  const reset = document.querySelector(
    'button[aria-label="reset zoom"]',
  ) as HTMLButtonElement;

  // At the 1.0 floor: reads 100%, cannot zoom out further.
  expect(reset.textContent).toBe("100%");
  expect(out.disabled).toBe(true);
  expect(inn.disabled).toBe(false);

  // Six 0.5 steps reach the 4.0 ceiling; zoom-in then disables.
  for (let i = 0; i < 6; i++) fireEvent.click(inn);
  expect(reset.textContent).toBe("400%");
  expect(inn.disabled).toBe(true);
  expect(out.disabled).toBe(false);

  fireEvent.click(reset);
  expect(reset.textContent).toBe("100%");
  expect(out.disabled).toBe(true);
  cleanup();
});

test("map grid renders one non-scaling SVG line for every board boundary", () => {
  const map = {
    _id: "m1",
    name: "M",
    cols: 16,
    rows: 9,
    imageUrl: null,
    imageHeight: null,
    imageWidth: null,
  } as unknown as MapView;
  currentMaps = { activeMapId: "m1", maps: [map] };
  const { container } = render(<MapBoard playerToken="p1" characters={[]} />);

  const grid = container.querySelector(".mb-grid-lines") as SVGSVGElement;
  expect(grid).toHaveAttribute("viewBox", "0 0 16 9");
  expect(grid.querySelectorAll("line")).toHaveLength(16 + 1 + 9 + 1);
  for (const line of grid.querySelectorAll("line")) {
    expect(line).toHaveAttribute("vector-effect", "non-scaling-stroke");
  }
  cleanup();
});
