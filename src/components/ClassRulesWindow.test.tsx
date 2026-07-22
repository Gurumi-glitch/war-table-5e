import { test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ClassRulesWindow } from "./ClassRulesWindow";
import type { CharacterView } from "../../convex/characters";

/**
 * The read-only 職業特殊規則 pop-out (❓ on a linked PC's frame): renders the
 * class-rules Markdown with no editing surface, folds, and closes.
 */

const character: CharacterView = {
  _id: "char1",
  _creationTime: 0,
  portraitUrl: null,
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
  acFormula: "",
  speedText: "25呎",
  initBonus: 0,
  pb: 2,
  abilities: [],
  spellcastingAbility: "",
  spellAttack: 0,
  spellDc: 0,
  passivePerception: 10,
  attackText: "",
  saves: [],
  skills: [],
  toolsText: "",
  goldText: "",
  refs: [],
  classRules: ["**神聖打擊**：命中時額外 2d8 光耀傷害。", ""],
  story: "",
  resources: [],
  recipes: [],
  effects: [],
};

const win = { x: 0, y: 0, z: 1, folded: false };
const noop = () => {};

test("renders the class rules as Markdown, read-only (no textarea)", () => {
  render(
    <ClassRulesWindow
      character={character}
      win={win}
      onDrag={noop}
      onFocus={noop}
      onFold={noop}
      onClose={noop}
    />,
  );
  expect(screen.getByText("職業特殊規則", { exact: false })).toBeInTheDocument();
  // Bold Markdown renders to <strong>; empty entries are dropped.
  expect(screen.getByText("神聖打擊")).toBeInTheDocument();
  expect(document.querySelector("textarea")).toBeNull();
});

test("empty class rules show a placeholder", () => {
  render(
    <ClassRulesWindow
      character={{ ...character, classRules: ["", "   "] }}
      win={win}
      onDrag={noop}
      onFocus={noop}
      onFold={noop}
      onClose={noop}
    />,
  );
  expect(screen.getByText("（無職業特殊規則）")).toBeInTheDocument();
});

test("fold and close fire their handlers", () => {
  const onFold = vi.fn();
  const onClose = vi.fn();
  render(
    <ClassRulesWindow
      character={character}
      win={win}
      onDrag={noop}
      onFocus={noop}
      onFold={onFold}
      onClose={onClose}
    />,
  );
  fireEvent.click(screen.getByLabelText("fold class rules"));
  fireEvent.click(screen.getByLabelText("close class rules"));
  expect(onFold).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledOnce();
});

test("folded collapses the body", () => {
  render(
    <ClassRulesWindow
      character={character}
      win={{ ...win, folded: true }}
      onDrag={noop}
      onFocus={noop}
      onFold={noop}
      onClose={noop}
    />,
  );
  // Body stays in the DOM inside a zero-height fold wrapper so it can animate.
  const fold = document.querySelector(".wt-window-fold") as HTMLElement;
  expect(fold).not.toBeNull();
  expect(fold.classList.contains("is-open")).toBe(false);
});
