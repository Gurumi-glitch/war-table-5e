import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { CharacterView } from "../../convex/characters";
import type { GameState } from "../../convex/games";
import { GameShell } from "./GameShell";
import type { GameBoardProps } from "./GameBoard";

vi.mock("./MapBoard", () => ({
  MapBoard: ({
    fullPage,
    characters,
    onOpenCharacter,
  }: {
    fullPage?: boolean;
    characters?: CharacterView[];
    onOpenCharacter?: (characterId: string) => void;
  }) => (
    <section aria-label="mock scene">
      <h2>Mock Scene</h2>
      {fullPage &&
        characters?.map((c) => (
          <button key={c._id} onClick={() => onOpenCharacter?.(c._id)}>
            Scene card {c.nameZh}
          </button>
        ))}
    </section>
  ),
}));

const character: CharacterView = {
  _id: "char1",
  _creationTime: 0,
  seedKey: "lia",
  player: "測試玩家",
  nameZh: "測試角色",
  nameEn: "TestHero",
  race: "蓮花半身人",
  classesText: "聖騎士 (1)",
  level: 1,
  alignment: "混亂善良",
  statusText: "正常",
  hp: 7,
  maxHp: 12,
  tempHp: 0,
  ac: 18,
  acFormula: "鎖子甲 16 + 盾牌 2",
  speedText: "25呎",
  initBonus: 0,
  pb: 2,
  abilities: [
    { key: "力量", score: 16, mod: 3 },
    { key: "敏捷", score: 10, mod: 0 },
    { key: "體質", score: 14, mod: 2 },
    { key: "智力", score: 8, mod: -1 },
    { key: "感知", score: 16, mod: 3 },
    { key: "魅力", score: 10, mod: 0 },
  ],
  spellcastingAbility: "",
  spellAttack: 0,
  spellDc: 0,
  passivePerception: 10,
  attackText: "命中 +5",
  saves: [],
  skills: [],
  toolsText: "皮匠工具",
  goldText: "15 金幣",
  refs: [{ title: "神聖感知", body: "直到下回合結束…" }],
  classRules: ["這個角色的職業規則與標準 5e 不同…"],
  story: "示範用的角色故事。",
  resources: [],
  recipes: [],
  effects: [],
};

const state: GameState = {
  role: "player",
  playerToken: "ptok",
  note: "hello world",
  counter: 3,
  dmNote: "",
  round: 1,
  playgroundMode: false,
  currentTurnId: null,
  batchRun: null,
  combatants: [],
  dice: [],
};

function props(overrides: Partial<GameBoardProps> = {}): GameBoardProps {
  const noop = () => {};
  return {
    state,
    log: [],
    characters: [character],
    onSeedCharacters: noop,
    onJoinBattle: noop,
    onUpdateCharacter: noop,
    onDeleteCharacter: async () => {},
    onAddCharacterResource: noop,
    onUpdateCharacterResource: noop,
    onRemoveCharacterResource: noop,
    onAddCharacterRecipe: noop,
    onUpdateCharacterRecipe: noop,
    onRemoveCharacterRecipe: noop,
    onSetNote: noop,
    onIncrement: noop,
    onAdvance: noop,
    onResetEconomy: noop,
    onRollInitiative: noop,
    onAddCombatant: noop,
    onPatch: noop,
    onKill: noop,
    onRemove: noop,
    onBatchRoll: noop,
    onSetClaim: noop,
    onReroll: noop,
    onSetValue: noop,
    onConfirm: noop,
    onConfirmRecipe: noop,
    onApplyCondition: noop,
    onAddCustom: noop,
    onToggleEffect: noop,
    onRemoveEffect: noop,
    onAddResource: noop,
    onUpdateResource: noop,
    onRemoveResource: noop,
    onAddRecipe: noop,
    onUpdateRecipe: noop,
    onRemoveRecipe: noop,
    onStartBatchRun: noop,
    onAdvanceBatchTurn: noop,
    onEndBatchRun: noop,
    ...overrides,
  };
}

function setSearch(search: string) {
  window.history.pushState({}, "", `/${search}`);
}

test("global header keeps sibling workspace tabs and role-authorized utilities", () => {
  setSearch("");
  render(<GameShell {...props()} />);

  expect(screen.getByRole("button", { name: /戰爭桌/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByRole("button", { name: /場景/ })).toBeInTheDocument();
  expect(screen.getByText("PLAYER")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /共用板/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /DM/ })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /場景/ }));

  expect(screen.getByRole("button", { name: /場景/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByLabelText("mock scene")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /地圖/ })).not.toBeInTheDocument();
});

test("client-mode gates hide Scene in Tablet and keep it with desktop override", () => {
  setSearch("?Tablet");
  const { unmount } = render(<GameShell {...props()} />);
  expect(screen.queryByRole("button", { name: /場景/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /地圖/ })).not.toBeInTheDocument();
  expect(screen.queryByText("骰盤")).not.toBeInTheDocument();
  expect(screen.queryByText("批次戰鬥")).not.toBeInTheDocument();
  unmount();

  setSearch("?desktop");
  render(<GameShell {...props()} />);
  expect(screen.getByRole("button", { name: /戰爭桌/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /場景/ })).toBeInTheDocument();
  expect(screen.getByText("骰盤")).toBeInTheDocument();
  expect(screen.getByText("批次戰鬥")).toBeInTheDocument();
});

test("character windows survive workspace switches and repeated opens focus one instance", () => {
  setSearch("");
  render(<GameShell {...props()} />);

  fireEvent.click(screen.getByRole("button", { name: /測試角色/ }));
  expect(screen.getByLabelText("story")).toHaveValue("示範用的角色故事。");

  fireEvent.click(screen.getByLabelText("fold card"));
  expect(screen.queryByLabelText("story")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /場景/ }));
  expect(screen.queryByLabelText("story")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /Scene card 測試角色/ }));
  expect(screen.getByLabelText("story")).toHaveValue("示範用的角色故事。");
  expect(screen.getAllByLabelText("save 測試角色")).toHaveLength(1);
});

test("issue #15: .wt-hosted windows render as siblings of the fixed .wt grid, not descendants", () => {
  setSearch("");
  const { container } = render(<GameShell {...props()} />);

  fireEvent.click(screen.getByRole("button", { name: /共用板/ }));
  const noteWindow = screen.getByLabelText("window 📋 共用板");

  const gridContainer = container.querySelector(".wt:not(.wt-float-layer)");
  const floatLayer = container.querySelector(".wt.wt-float-layer");
  expect(gridContainer).not.toBeNull();
  expect(floatLayer).not.toBeNull();
  expect(gridContainer?.contains(noteWindow)).toBe(false);
  expect(floatLayer?.contains(noteWindow)).toBe(true);
});

test("Scene character open is side-effect free; explicit Join invokes mutation once", () => {
  setSearch("");
  const onJoinBattle = vi.fn();
  render(<GameShell {...props({ onJoinBattle })} />);

  fireEvent.click(screen.getByRole("button", { name: /場景/ }));
  fireEvent.click(screen.getByRole("button", { name: /Scene card 測試角色/ }));

  expect(onJoinBattle).not.toHaveBeenCalled();
  expect(screen.queryByText("Damage mods")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /加入戰鬥/ }));
  expect(onJoinBattle).toHaveBeenCalledOnce();
  expect(onJoinBattle).toHaveBeenCalledWith("char1");
});

