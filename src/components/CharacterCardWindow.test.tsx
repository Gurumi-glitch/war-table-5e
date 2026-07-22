import { test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  CharacterCardWindow,
  type CharacterCardWindowProps,
} from "./CharacterCardWindow";
import type { CharacterView } from "../../convex/characters";
import type { CombatantView } from "../../convex/games";

// A later test overrides window.innerWidth to exercise the clamp (issue
// #25) — restore it so that mutation can't leak into whichever test
// happens to run next in this file.
const ORIGINAL_INNER_WIDTH = window.innerWidth;
afterEach(() => {
  Object.defineProperty(window, "innerWidth", {
    value: ORIGINAL_INNER_WIDTH,
    configurable: true,
  });
});

/**
 * Issue #9 step 4: the floating character-card window. Covers the three
 * behaviors the build plan calls out — card opens/folds, dirty-fields-only
 * Save payload, and Join-battle disabled while in battle.
 */

const character: CharacterView = {
  _id: "char1",
  _creationTime: 0,
  seedKey: "lia",
  portraitUrl: null,
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
  resources: [
    { _id: "res1", _creationTime: 0, combatantId: "char1", label: "聖療池", current: 5, max: 5 },
  ],
  recipes: [
    {
      _id: "rec1",
      _creationTime: 0,
      combatantId: "char1",
      name: "戰斧",
      hitType: "attack",
      attackMod: 5,
      damageDice: [{ type: "d8", count: 1 }],
      damageMod: 3,
      damageType: "slashing",
      dc: 0,
      saveAbility: "",
      critImmune: false,
      resourceId: null,
      resourceCost: 0,
      multiTarget: "none",
      appliesMods: [],
      extraRolls: [],
    },
  ],
  effects: [],
};

const combatant: CombatantView = {
  _id: "cb1",
  _creationTime: 0,
  gameId: "g1",
  characterId: "char1",
  name: "測試角色",
  kind: "pc",
  color: "#c9a227",
  hp: 7,
  maxHp: 12,
  ac: 18,
  initiative: 14,
  notes: "",
  alive: true,
  actionUsed: false,
  bonusUsed: false,
  reactionUsed: false,
  order: 0,
  effects: [],
  effectiveAc: { base: 18, bonus: 0, override: null, value: 18 },
  saves: null,
  resist: ["fire"],
  vuln: [],
  immune: [],
  conditionImmune: [],
  recipes: [],
  resources: [],
};

function baseProps(overrides: Partial<CharacterCardWindowProps> = {}): CharacterCardWindowProps {
  return {
    character,
    combatant,
    win: { x: 0, y: 0, z: 1, folded: false },
    inBattle: true,
    onDrag: () => {},
    onFocus: () => {},
    onFold: () => {},
    onClose: () => {},
    onUpdateCharacter: () => {},
    onJoinBattle: () => {},
    onDeleteCard: () => {},
    onAddResource: () => {},
    onUpdateResource: () => {},
    onRemoveResource: () => {},
    onAddRecipe: () => {},
    onUpdateRecipe: () => {},
    onRemoveRecipe: () => {},
    onPatchCombatant: () => {},
    ...overrides,
  };
}

test("the sheet is paged: only the active page's fields are visible, all stay mounted", () => {
  render(<CharacterCardWindow {...baseProps()} />);
  // Page 0 (核心) is shown by default; page 3 (故事) is mounted but hidden.
  expect(screen.getByLabelText("name zh")).toBeVisible();
  expect(screen.getByLabelText("story")).not.toBeVisible();
  // Resources/recipes/attack fields live on page 0 (combat page merged back
  // into core) — visible without switching pages.
  expect(screen.getByLabelText("ac")).toBeInTheDocument();
  expect(screen.getByLabelText("attack")).toBeVisible();
  expect(screen.getByLabelText("attack")).toBeInTheDocument();

  // Jump to 故事 (page index 3): story becomes visible, core (right page)
  // hides. name zh lives on the LEFT bookplate page (codex-folio-card-ui
  // §3.2) — it never changes with the right-page tabs, so it stays visible.
  fireEvent.click(screen.getByLabelText("page 3"));
  expect(screen.getByLabelText("story")).toBeVisible();
  expect(screen.getByLabelText("name zh")).toBeVisible();

  // The ← / → arrows walk pages too (3 → back to 2, 法術·特性).
  fireEvent.click(screen.getByLabelText("prev page"));
  expect(screen.getByLabelText("ref 0 title")).toBeVisible();
  expect(screen.getByLabelText("story")).not.toBeVisible();
});

test("soft warning marks an overridden derived value on engine-backed cards only", () => {
  // STR mod +3, PB 2, non-proficient → the engine expects a STR save of 3.
  // Save 0's total is set to 99 (overridden); the rest match the engine.
  const saves = [
    { key: "力量", prof: false, total: 99 },
    { key: "敏捷", prof: false, total: 0 },
    { key: "體質", prof: false, total: 2 },
    { key: "智力", prof: false, total: -1 },
    { key: "感知", prof: false, total: 3 },
    { key: "魅力", prof: false, total: 0 },
  ];
  // Legacy card (no `classes`): nothing to diverge from — no marker.
  const { unmount } = render(
    <CharacterCardWindow {...baseProps({ character: { ...character, saves } })} />,
  );
  expect(screen.getByLabelText("save 0 total")).not.toHaveClass("ccw-diverged");
  unmount();

  // Engine-backed card (built by the wizard → has `classes`): the override
  // away from the engine result IS marked.
  render(
    <CharacterCardWindow
      {...baseProps({
        character: {
          ...character,
          classes: [{ classId: "cleric", level: 1, active: true }],
          saves,
        },
      })}
    />,
  );
  expect(screen.getByLabelText("save 0 total")).toHaveClass("ccw-diverged");
  // A field left at the engine value is NOT marked.
  expect(screen.getByLabelText("save 1 total")).not.toHaveClass("ccw-diverged");
});

test("proficiencies: the four pickers always render; the legacy toolsText note only shows when non-empty", () => {
  // Legacy card — toolsText carries old data, structured arrays are empty:
  // BOTH the four pickers AND the legacy note render (no more either/or).
  const { unmount } = render(
    <CharacterCardWindow {...baseProps({ character: { ...character, toolsText: "護甲：輕甲" } })} />,
  );
  expect(screen.getByLabelText("tools")).toBeInTheDocument();
  expect(screen.getByLabelText("profs armor add")).toBeInTheDocument();
  unmount();

  // Structured card — each category's seeded values render as chips; empty
  // toolsText means no legacy note block.
  render(
    <CharacterCardWindow
      {...baseProps({
        character: { ...character, toolsText: "", armorProfs: ["輕甲", "盾牌"], weaponProfs: ["簡易武器"] },
      })}
    />,
  );
  expect(screen.getByText("輕甲")).toBeInTheDocument();
  expect(screen.getByText("盾牌")).toBeInTheDocument();
  expect(screen.getByText("簡易武器")).toBeInTheDocument();
  expect(screen.queryByLabelText("tools")).toBeNull();
});

test("adding a proficiency via the picker's dropdown saves it in the dirty patch", () => {
  const onUpdateCharacter = vi.fn();
  render(
    <CharacterCardWindow
      {...baseProps({ onUpdateCharacter, character: { ...character, armorProfs: ["輕甲"] } })}
    />,
  );
  fireEvent.change(screen.getByLabelText("profs armor add"), { target: { value: "中甲" } });
  fireEvent.click(screen.getByLabelText(`save ${character.nameZh}`));
  expect(onUpdateCharacter).toHaveBeenCalledWith(
    character._id,
    expect.objectContaining({ armorProfs: ["輕甲", "中甲"] }),
  );
});

test("picking armor writes AC via SRD rules (heavy = base, no DEX)", () => {
  render(<CharacterCardWindow {...baseProps()} />);
  // Chain mail (heavy, base 16) ignores DEX regardless of the card's DEX mod.
  fireEvent.change(screen.getByLabelText("ac armor"), { target: { value: "chain-mail" } });
  expect((screen.getByLabelText("ac") as HTMLInputElement).value).toBe("16");
  expect((screen.getByLabelText("ac formula") as HTMLInputElement).value).toContain("16");
  // Adding a shield stacks +2 → 18, and the result stays hand-editable.
  fireEvent.click(screen.getByLabelText("ac shield"));
  expect((screen.getByLabelText("ac") as HTMLInputElement).value).toBe("18");
});

test("dragging the head calls onDrag with the pointer-relative position", () => {
  const onDrag = vi.fn();
  render(<CharacterCardWindow {...baseProps({ onDrag, win: { x: 10, y: 20, z: 1, folded: false } })} />);
  const head = screen.getByText(/測試角色/).parentElement as HTMLElement;
  fireEvent.pointerDown(head, { clientX: 100, clientY: 100, pointerId: 1 });
  fireEvent.pointerMove(head, { clientX: 130, clientY: 150, pointerId: 1 });
  expect(onDrag).toHaveBeenCalledWith(40, 70);
});

test("pointercancel on the head clears the drag state (issue #16)", () => {
  const onDrag = vi.fn();
  render(<CharacterCardWindow {...baseProps({ onDrag, win: { x: 10, y: 20, z: 1, folded: false } })} />);
  const head = screen.getByText(/測試角色/).parentElement as HTMLElement;
  fireEvent.pointerDown(head, { clientX: 100, clientY: 100, pointerId: 1 });
  fireEvent.pointerCancel(head, { pointerId: 1 });
  fireEvent.pointerMove(head, { clientX: 130, clientY: 150, pointerId: 1 });
  expect(onDrag).not.toHaveBeenCalled();
});

test("pointerdown on the fold button does not arm a head drag (issue #16)", () => {
  const onDrag = vi.fn();
  render(<CharacterCardWindow {...baseProps({ onDrag, win: { x: 10, y: 20, z: 1, folded: false } })} />);
  const foldBtn = screen.getByLabelText("fold card");
  fireEvent.pointerDown(foldBtn, { clientX: 100, clientY: 100, pointerId: 1 });
  const head = screen.getByText(/測試角色/).parentElement as HTMLElement;
  fireEvent.pointerMove(head, { clientX: 130, clientY: 150, pointerId: 1 });
  expect(onDrag).not.toHaveBeenCalled();
});

// Issue #25 — dragging a character card's title bar past the viewport edge
// must clamp using its live measured size, not strand it off-screen.
test("dragging past the top clamps the title bar to the viewport top", () => {
  const onDrag = vi.fn();
  render(<CharacterCardWindow {...baseProps({ onDrag, win: { x: 10, y: 20, z: 1, folded: false } })} />);
  const head = screen.getByText(/測試角色/).parentElement as HTMLElement;
  const outer = head.parentElement as HTMLElement;
  outer.getBoundingClientRect = () =>
    ({ width: 900, height: 600, left: 0, top: 0, right: 900, bottom: 600 }) as DOMRect;
  head.getBoundingClientRect = () =>
    ({ width: 900, height: 30, left: 0, top: 0, right: 900, bottom: 30 }) as DOMRect;
  fireEvent.pointerDown(head, { clientX: 100, clientY: 100, pointerId: 1 });
  fireEvent.pointerMove(head, { clientX: 100, clientY: -500, pointerId: 1 });
  expect(onDrag).toHaveBeenCalledWith(10, 0);
});

test("dragging sideways stops once half the card width hangs off the edge", () => {
  const onDrag = vi.fn();
  Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });
  render(<CharacterCardWindow {...baseProps({ onDrag, win: { x: 10, y: 20, z: 1, folded: false } })} />);
  const head = screen.getByText(/測試角色/).parentElement as HTMLElement;
  const outer = head.parentElement as HTMLElement;
  outer.getBoundingClientRect = () =>
    ({ width: 900, height: 600, left: 0, top: 0, right: 900, bottom: 600 }) as DOMRect;
  head.getBoundingClientRect = () =>
    ({ width: 900, height: 30, left: 0, top: 0, right: 900, bottom: 30 }) as DOMRect;
  fireEvent.pointerDown(head, { clientX: 100, clientY: 100, pointerId: 1 });
  fireEvent.pointerMove(head, { clientX: 5000, clientY: 100, pointerId: 1 });
  expect(onDrag).toHaveBeenCalledWith(1200 - 450, 20);
});

test("card opens with the field body visible", () => {
  render(<CharacterCardWindow {...baseProps()} />);
  // A draft field only rendered when the body is open.
  expect(screen.getByLabelText("player")).toHaveValue("測試玩家");
  expect(screen.getByLabelText("story")).toHaveValue("示範用的角色故事。");
});

test("fold hides the body, unfold restores it", () => {
  const onFold = vi.fn();
  render(<CharacterCardWindow {...baseProps({ onFold })} />);
  expect(screen.getByLabelText("story")).toBeInTheDocument();
  // Fold button drives window state via onFold; parent re-renders folded.
  fireEvent.click(screen.getByLabelText("fold card"));
  expect(onFold).toHaveBeenCalled();
});

test("folded card collapses the body", () => {
  render(<CharacterCardWindow {...baseProps({ win: { x: 0, y: 0, z: 1, folded: true } })} />);
  // Body stays in the DOM inside a zero-height fold wrapper so it can animate.
  const fold = document.querySelector(".wt-window-fold") as HTMLElement;
  expect(fold).not.toBeNull();
  expect(fold.classList.contains("is-open")).toBe(false);
  // Title still visible so the user can re-open.
  expect(screen.getByText(/測試角色/)).toBeInTheDocument();
});

test("Save sends only the field the user touched (dirty-only)", () => {
  const onUpdateCharacter = vi.fn();
  render(<CharacterCardWindow {...baseProps({ onUpdateCharacter })} />);
  const player = screen.getByLabelText("player") as HTMLInputElement;
  fireEvent.change(player, { target: { value: "銀弦" } });
  fireEvent.click(screen.getByLabelText("save 測試角色"));
  expect(onUpdateCharacter).toHaveBeenCalledOnce();
  expect(onUpdateCharacter).toHaveBeenCalledWith("char1", { player: "銀弦" });
});

test("職業特殊規則 renders existing entries and Save sends dirty classRules", () => {
  const onUpdateCharacter = vi.fn();
  render(<CharacterCardWindow {...baseProps({ onUpdateCharacter })} />);
  expect(screen.getByText("職業特殊規則")).toBeInTheDocument();
  // A non-empty class rule defaults to preview (rendered Markdown); switch to
  // 編輯 to reveal the textarea.
  expect(screen.getByTestId("class rule 0 body")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("toggle class rule 0 preview"));
  const body = screen.getByLabelText("class rule 0 body") as HTMLTextAreaElement;
  expect(body).toHaveValue("這個角色的職業規則與標準 5e 不同…");
  fireEvent.change(body, { target: { value: "改寫過的職業規則" } });
  fireEvent.click(screen.getByLabelText("save 測試角色"));
  expect(onUpdateCharacter).toHaveBeenCalledWith("char1", {
    classRules: ["改寫過的職業規則"],
  });
});

test("職業特殊規則 +section adds a new blank entry", () => {
  render(<CharacterCardWindow {...baseProps()} />);
  const sectionButtons = screen.getAllByText("+ section");
  // Second "+ section" button belongs to 職業特殊規則 (法術與特性 is first).
  fireEvent.click(sectionButtons[1]);
  expect(screen.getByLabelText("class rule 1 body")).toHaveValue("");
});

test("預覽 toggle switches a class rule between Markdown and edit without touching the draft", () => {
  const onUpdateCharacter = vi.fn();
  render(<CharacterCardWindow {...baseProps({ onUpdateCharacter })} />);
  // A non-empty class rule defaults to PREVIEW: Markdown rendered, no textarea.
  expect(screen.queryByLabelText("class rule 0 body")).toBeNull();
  expect(screen.getByTestId("class rule 0 body")).toBeInTheDocument();
  // Toggle to 編輯: the textarea appears with the same value.
  fireEvent.click(screen.getByLabelText("toggle class rule 0 preview"));
  expect(screen.getByLabelText("class rule 0 body")).toHaveValue(
    "這個角色的職業規則與標準 5e 不同…",
  );
  // Toggling a field the user hasn't edited must not dirty the Save button.
  expect(screen.getByLabelText("save 測試角色")).toBeDisabled();
  expect(onUpdateCharacter).not.toHaveBeenCalled();
  // Toggle back to 預覽: Markdown is rendered again.
  fireEvent.click(screen.getByLabelText("toggle class rule 0 preview"));
  expect(screen.queryByLabelText("class rule 0 body")).toBeNull();
  expect(screen.getByTestId("class rule 0 body")).toBeInTheDocument();
});

test("Save is disabled until a field is dirty", () => {
  const onUpdateCharacter = vi.fn();
  render(<CharacterCardWindow {...baseProps({ onUpdateCharacter })} />);
  const save = screen.getByLabelText("save 測試角色") as HTMLButtonElement;
  expect(save).toBeDisabled();
  fireEvent.click(save);
  expect(onUpdateCharacter).not.toHaveBeenCalled();
});

test("Join battle is disabled while in battle", () => {
  const onJoinBattle = vi.fn();
  render(<CharacterCardWindow {...baseProps({ onJoinBattle, inBattle: true })} />);
  const join = screen.getByRole("button", { name: /戰鬥中/ });
  expect(join).toBeDisabled();
  fireEvent.click(join);
  expect(onJoinBattle).not.toHaveBeenCalled();
});

test("Join battle fires when not in battle", () => {
  const onJoinBattle = vi.fn();
  render(
    <CharacterCardWindow
      {...baseProps({ onJoinBattle, inBattle: false, combatant: null })}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /加入戰鬥/ }));
  expect(onJoinBattle).toHaveBeenCalledWith("char1");
});

test("delete card requires a second click to confirm", () => {
  const onDeleteCard = vi.fn();
  render(<CharacterCardWindow {...baseProps({ onDeleteCard })} />);

  fireEvent.click(screen.getByLabelText(`delete card ${character.nameZh}`));
  expect(onDeleteCard).not.toHaveBeenCalled();
  const confirm = screen.getByLabelText(`confirm delete card ${character.nameZh}`);

  fireEvent.click(confirm);
  expect(onDeleteCard).toHaveBeenCalledOnce();
});

test("a read-only (demo) card's delete button is disabled", () => {
  const onDeleteCard = vi.fn();
  render(<CharacterCardWindow {...baseProps({ onDeleteCard, readOnly: true })} />);

  const del = screen.getByLabelText(`delete card ${character.nameZh}`);
  expect(del).toBeDisabled();
  fireEvent.click(del);
  expect(onDeleteCard).not.toHaveBeenCalled();
});

test("R/V/I section renders only when linked to a combatant", () => {
  const { rerender } = render(<CharacterCardWindow {...baseProps({ combatant: null })} />);
  // No combatant → no resist chip / RVI fieldset legend present.
  expect(screen.queryByText("Damage mods")).toBeNull();
  rerender(<CharacterCardWindow {...baseProps()} />);
  expect(screen.getByText("傷害調整")).toBeInTheDocument();
});

// --- Auto-calc (issue #9 pre-step-5 toolkit) -------------------------------

test("ability mod auto-syncs from score (WIS 8 → -1) and ripples to WIS save/skills", () => {
  render(<CharacterCardWindow {...baseProps()} />);
  // WIS is ability index 4 (score 16, mod 3). Set score to 8.
  const wisScore = screen.getByLabelText("ability 4 score") as HTMLInputElement;
  fireEvent.change(wisScore, { target: { value: "8" } });
  expect((screen.getByLabelText("ability 4 mod") as HTMLInputElement).value).toBe("-1");
  // 感知 save (index 4) is not proficient → total = mod -1.
  expect((screen.getByLabelText("save 4 total") as HTMLInputElement).value).toBe("-1");
  // A WIS skill (察覺, index 12) also reflects -1.
  expect((screen.getByLabelText("skill 12 total") as HTMLInputElement).value).toBe("-1");
});

test("toggling a save proficiency adds PB to the total", () => {
  render(<CharacterCardWindow {...baseProps()} />);
  // 感知 save (index 4): WIS mod 3, not proficient → total 3.
  expect((screen.getByLabelText("save 4 total") as HTMLInputElement).value).toBe("3");
  fireEvent.click(screen.getByLabelText("save 4 prof"));
  // proficient → 3 + PB 2 = 5
  expect((screen.getByLabelText("save 4 total") as HTMLInputElement).value).toBe("5");
});

test("selecting a spellcasting ability computes spell attack + DC", () => {
  render(<CharacterCardWindow {...baseProps()} />);
  // CHA (魅力) score 10 → mod 0; PB 2 → attack 2, DC 10.
  fireEvent.change(screen.getByLabelText("spellcasting ability"), {
    target: { value: "魅力" },
  });
  expect((screen.getByLabelText("spell attack") as HTMLInputElement).value).toBe("2");
  expect((screen.getByLabelText("spell dc") as HTMLInputElement).value).toBe("10");
});

test("DEX change updates initiative automatically", () => {
  render(<CharacterCardWindow {...baseProps()} />);
  // DEX is ability index 1 (score 10, mod 0) → init 0.
  fireEvent.change(screen.getByLabelText("ability 1 score"), { target: { value: "14" } });
  expect((screen.getByLabelText("init bonus") as HTMLInputElement).value).toBe("2");
});

test("a manual mod override propagates to dependent save/skill totals", () => {
  render(<CharacterCardWindow {...baseProps()} />);
  // STR (index 0) mod 3 → 運動 (skill 0) total 3, 力量 save (0) total 3.
  fireEvent.change(screen.getByLabelText("ability 0 mod"), { target: { value: "5" } });
  expect((screen.getByLabelText("save 0 total") as HTMLInputElement).value).toBe("5");
  expect((screen.getByLabelText("skill 0 total") as HTMLInputElement).value).toBe("5");
});

test("level drives PB (5e table) and cascades to proficient saves", () => {
  render(<CharacterCardWindow {...baseProps()} />);
  // Make the 感知 save proficient: WIS mod 3 + PB 2 = 5.
  fireEvent.click(screen.getByLabelText("save 4 prof"));
  expect((screen.getByLabelText("save 4 total") as HTMLInputElement).value).toBe("5");
  // Level 1 → 5: PB becomes 3, proficient save re-derives to 6.
  fireEvent.change(screen.getByLabelText("level"), { target: { value: "5" } });
  expect((screen.getByLabelText("pb") as HTMLInputElement).value).toBe("3");
  expect((screen.getByLabelText("save 4 total") as HTMLInputElement).value).toBe("6");
  // A manual PB override sticks…
  fireEvent.change(screen.getByLabelText("pb"), { target: { value: "5" } });
  expect((screen.getByLabelText("save 4 total") as HTMLInputElement).value).toBe("8");
  // …until level changes again (level 17 → PB 6).
  fireEvent.change(screen.getByLabelText("level"), { target: { value: "17" } });
  expect((screen.getByLabelText("pb") as HTMLInputElement).value).toBe("6");
  expect((screen.getByLabelText("save 4 total") as HTMLInputElement).value).toBe("9");
});

test("重算 recomputes a manually-overridden total back to the formula", () => {
  render(<CharacterCardWindow {...baseProps()} />);
  // Manually override 力量 save (0) total to 99.
  fireEvent.change(screen.getByLabelText("save 0 total"), { target: { value: "99" } });
  expect((screen.getByLabelText("save 0 total") as HTMLInputElement).value).toBe("99");
  // Recalc resets it: STR mod 3, not proficient → 3.
  fireEvent.click(screen.getByLabelText("recalc"));
  expect((screen.getByLabelText("save 0 total") as HTMLInputElement).value).toBe("3");
});

test("a partial seed skill list is overlaid on the template, not replaced (察覺 keeps proficiency)", () => {
  // Seeds store only proficient skill rows; the card must overlay them on the
  // 18-row template instead of replacing it. Otherwise 察覺 shows non-proficient
  // and passive perception downgrades on recalc. (WIS 16 → +3, PB 2.)
  const seedChar: CharacterView = {
    ...character,
    passivePerception: 15, // 10 + WIS 3 + PB 2 (察覺 proficient)
    skills: [{ key: "察覺", ability: "感知", prof: "proficient", total: 5 }],
  };
  render(<CharacterCardWindow {...baseProps({ character: seedChar })} />);
  // 察覺 (skill 12) keeps its overlaid proficient total (5), not the
  // non-proficient default (WIS mod 3).
  expect((screen.getByLabelText("skill 12 total") as HTMLInputElement).value).toBe("5");
  expect((screen.getByLabelText("passive perception") as HTMLInputElement).value).toBe("15");
  // Recalc re-derives from the now-correct overlaid skills → no downgrade.
  fireEvent.click(screen.getByLabelText("recalc"));
  expect((screen.getByLabelText("passive perception") as HTMLInputElement).value).toBe("15");
});

test("a card without a stored passivePerception auto-derives on open (no manual recalc)", () => {
  // Existing cards pre-date the field; the plaque must show the derived value
  // on open, not 10. WIS 16 (+3), 察覺 proficient (total 5) → passive 15.
  // (If toCharacterView defaulted absent → 10, the snapshot's `?? passiveDefault`
  // would never fire and this would show 10 until a manual 重算.)
  const char: CharacterView = {
    ...character,
    passivePerception: undefined,
    skills: [{ key: "察覺", ability: "感知", prof: "proficient", total: 5 }],
  };
  render(<CharacterCardWindow {...baseProps({ character: char })} />);
  expect((screen.getByLabelText("passive perception") as HTMLInputElement).value).toBe("15");
});

/**
 * Export / read-only demo cards (prep-public-release, design D3/D4).
 */

test("Export downloads the card as <name>.dndcard.json", () => {
  // jsdom has no object-URL support and never follows a download; observe the
  // real anchor the code builds rather than replacing document.createElement,
  // which would hand React a fake element for every node it renders.
  const createObjectURL = vi.fn().mockReturnValue("blob:card");
  const revokeObjectURL = vi.fn();
  Object.assign(URL, { createObjectURL, revokeObjectURL });
  const clicked: HTMLAnchorElement[] = [];
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });

  render(<CharacterCardWindow {...baseProps()} />);
  fireEvent.click(screen.getByLabelText("export 測試角色"));

  expect(clicked).toHaveLength(1);
  expect(clicked[0].download).toBe("測試角色.dndcard.json");
  expect(createObjectURL).toHaveBeenCalled();
  // The blob URL is released once the browser has read it — an object URL held
  // open pins the whole card in memory for the life of the tab.
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:card");

  click.mockRestore();
});

test("a demo card on the playground refuses edits and points at Export", () => {
  render(<CharacterCardWindow {...baseProps({ readOnly: true })} />);
  const note = screen.getByRole("note");
  expect(note).toHaveTextContent("匯出");
  // Save is not merely ignored — it never looks available in the first place.
  expect(screen.getByLabelText("save 測試角色")).toBeDisabled();
  // Export is exactly what the hint tells them to press, so it must be live.
  expect(screen.getByLabelText("export 測試角色")).toBeEnabled();
});

test("an ordinary card carries no read-only hint", () => {
  render(<CharacterCardWindow {...baseProps()} />);
  expect(screen.queryByRole("note")).not.toBeInTheDocument();
});

// --- Twin-page book re-layout (codex-folio-card-ui §3.2-§3.4) --------------

test("switching ribbon tabs preserves an unsaved edit on the non-active panel", () => {
  render(<CharacterCardWindow {...baseProps()} />);
  // Type an unsaved draft into 故事 (page 3) without saving.
  fireEvent.click(screen.getByLabelText("page 3"));
  fireEvent.change(screen.getByLabelText("story"), { target: { value: "未存草稿" } });
  // Switch back to 核心 (page 0) — the 故事 panel stays mounted (hidden), so
  // its aria-label is still queryable and the unsaved edit survives.
  fireEvent.click(screen.getByLabelText("page 0"));
  expect(screen.getByLabelText("story")).not.toBeVisible();
  expect(screen.getByLabelText("story")).toHaveValue("未存草稿");
  // The left "bookplate" page (name) never moved — still visible throughout.
  expect(screen.getByLabelText("name zh")).toBeVisible();
});

test("portrait placeholder shows the name initial when portraitUrl is null", () => {
  render(<CharacterCardWindow {...baseProps()} />);
  const slot = screen.getByRole("button", { name: "upload portrait" });
  expect(slot).toHaveTextContent("測");
});
