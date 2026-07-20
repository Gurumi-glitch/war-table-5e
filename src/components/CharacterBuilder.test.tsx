import { expect, test, vi, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CharacterBuilder, type BuilderPayload } from "./CharacterBuilder";
import { LocaleProvider } from "../i18n";

afterEach(() => {
  try {
    localStorage.removeItem("dnd-locale");
  } catch {
    /* jsdom always has localStorage; guard is belt-and-braces */
  }
});

/**
 * The guided builder (character-builder). The point of the wizard is that an
 * SRD pick auto-derives the mechanical card, while custom/homebrew is a
 * first-class path that derives nothing and warns nothing. These walk the
 * steps and assert the ASSEMBLED payload — the card the wizard hands to create.
 */

function walkToReview() {
  // race → class → abilities → background → profs → spells → review
  for (let i = 0; i < 6; i++) {
    fireEvent.click(screen.getByLabelText("builder next"));
  }
}

test("a SRD Life Domain cleric auto-derives the whole card", async () => {
  const onCreate = vi.fn((_p: BuilderPayload) => Promise.resolve());
  render(<CharacterBuilder onCreate={onCreate} onCancel={vi.fn()} />);

  // Race: High Elf (DEX+2, INT+1)
  fireEvent.change(screen.getByLabelText("race select"), { target: { value: "high-elf" } });
  fireEvent.click(screen.getByLabelText("builder next"));

  // Class: Cleric + Life Domain (L1 subclass → heavy armor)
  fireEvent.change(screen.getByLabelText("class select 0"), { target: { value: "cleric" } });
  fireEvent.change(screen.getByLabelText("subclass select 0"), { target: { value: "life-domain" } });
  fireEvent.click(screen.getByLabelText("builder next"));

  // Abilities: bump CON to 14 for a determinate HP
  fireEvent.change(screen.getByLabelText("ability 體質"), { target: { value: "14" } });
  fireEvent.click(screen.getByLabelText("builder next")); // → background
  fireEvent.click(screen.getByLabelText("builder next")); // → profs (seeds here)
  fireEvent.click(screen.getByLabelText("builder next")); // → spells
  fireEvent.click(screen.getByLabelText("builder next")); // → review

  fireEvent.click(screen.getByLabelText("builder finish"));
  expect(onCreate).toHaveBeenCalledTimes(1);

  const { fields, resources } = onCreate.mock.calls[0][0] as BuilderPayload;
  // Structured class + subclass recorded
  expect(fields.classes).toHaveLength(1);
  expect(fields.classes![0].classId).toBe("cleric");
  expect(fields.classes![0].subclassId).toBe("life-domain");
  // High Elf ASI applied on top of the base-8 starting score: DEX 10 (+2), INT 9 (+1)
  expect(fields.abilities.find((a) => a.key === "敏捷")!.score).toBe(10);
  expect(fields.abilities.find((a) => a.key === "智力")!.score).toBe(9);
  // Life Domain grants heavy armor (bonus proficiency)
  expect(fields.armorProfs).toContain("重甲");
  // Cleric spellcasting → WIS, save proficiencies WIS/CHA
  expect(fields.spellcastingAbility).toBe("感知");
  expect(fields.saves!.find((s) => s.key === "感知")!.prof).toBe(true);
  // HP = d8 + CON(+2) = 10; full caster → 2 L1 slots
  expect(fields.hp).toBe(10);
  expect(fields.maxHp).toBe(10);
  expect(resources).toEqual([{ label: "L1 法術位", current: 2, max: 2 }]);
  // classesText derived for legacy display
  expect(fields.classesText).toContain("牧師");
});

test("custom/homebrew race derives nothing and is recorded verbatim", () => {
  const onCreate = vi.fn((_p: BuilderPayload) => Promise.resolve());
  render(<CharacterBuilder onCreate={onCreate} onCancel={vi.fn()} />);

  fireEvent.change(screen.getByLabelText("race select"), { target: { value: "" } }); // custom
  fireEvent.change(screen.getByLabelText("race custom"), { target: { value: "蓮花半身人" } });
  walkToReview();
  fireEvent.click(screen.getByLabelText("builder finish"));

  const { fields } = onCreate.mock.calls[0][0] as BuilderPayload;
  expect(fields.race).toBe("蓮花半身人");
  // No racial ASI applied for a custom race: base 8 stays 8 (+0)
  expect(fields.abilities.find((a) => a.key === "敏捷")!.score).toBe(8);
  // No warning UI exists in the builder for filling homebrew — assert the flow
  // completed and produced a card (the absence of a gate IS the contract).
  expect(onCreate).toHaveBeenCalledTimes(1);
});

test("the builder shows English names under the English locale (原文 on switch)", () => {
  localStorage.setItem("dnd-locale", "en");
  render(
    <LocaleProvider>
      <CharacterBuilder onCreate={vi.fn((_p: BuilderPayload) => Promise.resolve())} onCancel={vi.fn()} />
    </LocaleProvider>,
  );
  // Race dropdown lists the English name, not only 高等精靈.
  expect(screen.getByRole("option", { name: /High Elf/ })).toBeInTheDocument();
  // Step chrome is English too.
  expect(screen.getByLabelText("builder next")).toHaveTextContent(/Next/);
});

test("multiclass is recorded as rows (paladin 1 / cleric 0 inactive)", () => {
  const onCreate = vi.fn((_p: BuilderPayload) => Promise.resolve());
  render(<CharacterBuilder onCreate={onCreate} onCancel={vi.fn()} />);

  fireEvent.click(screen.getByLabelText("builder next")); // → class
  fireEvent.change(screen.getByLabelText("class select 0"), { target: { value: "paladin" } });
  fireEvent.click(screen.getByLabelText("add class"));
  fireEvent.change(screen.getByLabelText("class select 1"), { target: { value: "cleric" } });
  fireEvent.change(screen.getByLabelText("class level 1"), { target: { value: "0" } });
  // row 1's active checkbox defaults false (added inactive)
  for (let i = 0; i < 5; i++) fireEvent.click(screen.getByLabelText("builder next"));
  fireEvent.click(screen.getByLabelText("builder finish"));

  const { fields } = onCreate.mock.calls[0][0] as BuilderPayload;
  expect(fields.classes).toHaveLength(2);
  expect(fields.classes![0]).toMatchObject({ classId: "paladin", active: true, level: 1 });
  expect(fields.classes![1]).toMatchObject({ classId: "cleric", active: false, level: 0 });
});

test("half-elf ASI choice: two free +1s, separate from the 27-point budget", () => {
  render(<CharacterBuilder onCreate={vi.fn()} onCancel={vi.fn()} />);

  fireEvent.change(screen.getByLabelText("race select"), { target: { value: "half-elf" } });
  fireEvent.click(screen.getByLabelText("builder next")); // → class
  fireEvent.click(screen.getByLabelText("builder next")); // → abilities

  // Switch to point buy so the remaining-points hint is visible.
  fireEvent.click(screen.getByLabelText("method pointbuy"));
  const pointsBefore = screen.getByText(/剩餘點數/).textContent;

  const choice0 = screen.getByLabelText("asi choice 0") as HTMLSelectElement;
  const choice1 = screen.getByLabelText("asi choice 1") as HTMLSelectElement;
  // Charisma is half-elf's fixed +2 — not offered as a free-choice option.
  expect(Array.from(choice0.options).map((o) => o.value)).not.toContain("魅力");

  fireEvent.change(choice0, { target: { value: "力量" } });
  // Once 力量 is picked in slot 0, slot 1 can't also pick it.
  expect(Array.from(choice1.options).map((o) => o.value)).not.toContain("力量");
  fireEvent.change(choice1, { target: { value: "敏捷" } });

  expect(screen.getByLabelText("final 力量")).toHaveTextContent("9");
  expect(screen.getByLabelText("final 敏捷")).toHaveTextContent("9");
  // The 27-point budget only tracks baseScores — the racial pick doesn't touch it.
  expect(screen.getByText(/剩餘點數/).textContent).toBe(pointsBefore);
});

test("racial ASI badge: a fixed racial bonus shows inline on its ability row", () => {
  render(<CharacterBuilder onCreate={vi.fn()} onCancel={vi.fn()} />);

  // Dragonborn: 力量+2, 魅力+1 (fixed, no choice).
  fireEvent.change(screen.getByLabelText("race select"), { target: { value: "dragonborn" } });
  fireEvent.click(screen.getByLabelText("builder next")); // → class
  fireEvent.click(screen.getByLabelText("builder next")); // → abilities

  expect(screen.getByLabelText("racial 力量")).toHaveTextContent("+2");
  expect(screen.getByLabelText("racial 魅力")).toHaveTextContent("+1");
  // No bonus on an ability the race doesn't touch — no badge rendered.
  expect(screen.queryByLabelText("racial 敏捷")).toBeNull();
});

test("point buy starts at the base-8 score: full 27 points unspent", () => {
  render(<CharacterBuilder onCreate={vi.fn()} onCancel={vi.fn()} />);
  fireEvent.click(screen.getByLabelText("builder next")); // → class
  fireEvent.click(screen.getByLabelText("builder next")); // → abilities
  fireEvent.click(screen.getByLabelText("method pointbuy"));

  expect(screen.getByText(/剩餘點數/).textContent).toContain("27");
});

test("point buy: a score outside 8-15 shows a soft warning without blocking input", () => {
  render(<CharacterBuilder onCreate={vi.fn()} onCancel={vi.fn()} />);
  fireEvent.click(screen.getByLabelText("builder next")); // → class
  fireEvent.click(screen.getByLabelText("builder next")); // → abilities
  fireEvent.click(screen.getByLabelText("method pointbuy"));

  fireEvent.change(screen.getByLabelText("ability 力量"), { target: { value: "16" } });
  expect(screen.getByText(/剩餘點數/).textContent).toContain("超出點購範圍");
  expect(screen.getByText(/剩餘點數/).textContent).toContain("力量");
  // Not clamped — the raw value the player typed stays in the input.
  expect((screen.getByLabelText("ability 力量") as HTMLInputElement).value).toBe("16");

  fireEvent.change(screen.getByLabelText("ability 力量"), { target: { value: "15" } });
  expect(screen.getByText(/剩餘點數/).textContent).not.toContain("超出點購範圍");
});

test("acolyte background (default dragonborn, no racial language choice): lang hint shows background-only count", () => {
  render(<CharacterBuilder onCreate={vi.fn()} onCancel={vi.fn()} />);
  fireEvent.click(screen.getByLabelText("builder next")); // → class
  fireEvent.click(screen.getByLabelText("builder next")); // → abilities
  fireEvent.click(screen.getByLabelText("builder next")); // → background (acolyte is the default)
  fireEvent.click(screen.getByLabelText("builder next")); // → profs

  // Dragonborn has no languageChoice → total is background's 2 alone.
  expect(screen.getByLabelText("lang hint")).toHaveTextContent("可自選語言 2 種（背景 2）");
});

test("high elf + acolyte: racial fixed languages seed as chips, hint totals race + background choices", () => {
  render(<CharacterBuilder onCreate={vi.fn()} onCancel={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("race select"), { target: { value: "high-elf" } });
  fireEvent.click(screen.getByLabelText("builder next")); // → class
  fireEvent.click(screen.getByLabelText("builder next")); // → abilities
  fireEvent.click(screen.getByLabelText("builder next")); // → background (acolyte is the default)
  fireEvent.click(screen.getByLabelText("builder next")); // → profs (seeds here)

  // High Elf's fixed languages (通用語/精靈語) show up as chips.
  expect(screen.getByText("通用語")).toBeInTheDocument();
  expect(screen.getByText("精靈語")).toBeInTheDocument();
  // High Elf languageChoice: 1 + acolyte's 2 = 3.
  expect(screen.getByLabelText("lang hint")).toHaveTextContent("可自選語言 3 種（種族 1＋背景 2）");
});

test("switching race after profs were already seeded re-seeds languages (regression)", () => {
  render(<CharacterBuilder onCreate={vi.fn()} onCancel={vi.fn()} />);
  fireEvent.click(screen.getByLabelText("builder next")); // → class
  fireEvent.click(screen.getByLabelText("builder next")); // → abilities
  fireEvent.click(screen.getByLabelText("builder next")); // → background
  fireEvent.click(screen.getByLabelText("builder next")); // → profs (seeds dragonborn: 通用語/龍語)
  expect(screen.getByText("龍語")).toBeInTheDocument();

  // Back to race, switch to Human (通用語 only — no fixed second language).
  for (let i = 0; i < 4; i++) fireEvent.click(screen.getByLabelText("builder back"));
  fireEvent.change(screen.getByLabelText("race select"), { target: { value: "human" } });
  for (let i = 0; i < 4; i++) fireEvent.click(screen.getByLabelText("builder next")); // → profs again

  // Dragonborn seeded 2 language chips (通用語/龍語); Human seeds only 1 (通用語).
  expect(screen.getAllByRole("button", { name: /remove lang/ })).toHaveLength(1);
});

test("acolyte background: granted skills (洞悉/宗教) show pre-checked and disabled", () => {
  render(<CharacterBuilder onCreate={vi.fn()} onCancel={vi.fn()} />);
  fireEvent.click(screen.getByLabelText("builder next")); // → class
  fireEvent.click(screen.getByLabelText("builder next")); // → abilities
  fireEvent.click(screen.getByLabelText("builder next")); // → background (acolyte is the default)

  const insight = screen.getByLabelText("skill 洞悉") as HTMLInputElement;
  const religion = screen.getByLabelText("skill 宗教") as HTMLInputElement;
  expect(insight.checked).toBe(true);
  expect(insight.disabled).toBe(true);
  expect(religion.checked).toBe(true);
  expect(religion.disabled).toBe(true);
});

test("class step: barbarian's first `skillChoose` skills are pre-checked, and reseed on class switch", () => {
  render(<CharacterBuilder onCreate={vi.fn()} onCancel={vi.fn()} />);
  fireEvent.click(screen.getByLabelText("builder next")); // → class (default: barbarian)

  // Barbarian: skillChoose 2, skillFrom starts with 馴獸, 運動.
  const beastHandling = screen.getByLabelText("skill 馴獸") as HTMLInputElement;
  const athletics = screen.getByLabelText("skill 運動") as HTMLInputElement;
  expect(beastHandling.checked).toBe(true);
  expect(athletics.checked).toBe(true);
  const intimidation = screen.getByLabelText("skill 威嚇") as HTMLInputElement;
  expect(intimidation.checked).toBe(false);

  // Player unchecks a default — manual pick must survive a re-render of this step.
  fireEvent.click(athletics);
  expect((screen.getByLabelText("skill 運動") as HTMLInputElement).checked).toBe(false);

  // Switching class reseeds: Cleric's first 2 skillFrom (歷史, 洞悉) get pre-checked.
  fireEvent.change(screen.getByLabelText("class select 0"), { target: { value: "cleric" } });
  const history = screen.getByLabelText("skill 歷史") as HTMLInputElement;
  const insight = screen.getByLabelText("skill 洞悉") as HTMLInputElement;
  expect(history.checked).toBe(true);
  expect(insight.checked).toBe(true);
});

test("bard's empty skillFrom means 'choose any' — background step lists every skill, not zero", () => {
  render(<CharacterBuilder onCreate={vi.fn()} onCancel={vi.fn()} />);
  fireEvent.click(screen.getByLabelText("builder next")); // → class
  fireEvent.change(screen.getByLabelText("class select 0"), { target: { value: "bard" } });
  fireEvent.click(screen.getByLabelText("builder next")); // → abilities
  fireEvent.click(screen.getByLabelText("builder next")); // → background

  const skillCheckboxes = screen
    .getAllByRole("checkbox")
    .filter((el) => el.getAttribute("aria-label")?.startsWith("skill "));
  expect(skillCheckboxes.length).toBeGreaterThan(0);
});

test("English locale: seeded proficiencies translate srdContent's zh terms", () => {
  localStorage.setItem("dnd-locale", "en");
  render(
    <LocaleProvider>
      <CharacterBuilder onCreate={vi.fn((_p: BuilderPayload) => Promise.resolve())} onCancel={vi.fn()} />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByLabelText("builder next")); // → class (default: barbarian)
  fireEvent.click(screen.getByLabelText("builder next")); // → abilities
  fireEvent.click(screen.getByLabelText("builder next")); // → background
  fireEvent.click(screen.getByLabelText("builder next")); // → profs (seeds here)

  // Seeded proficiencies render as chips now (dropdown-add UI), not a free-text input.
  expect(screen.getByText("Light armor")).toBeInTheDocument();
});

test("profs step: dropdown-add appends a chip, then resets and drops the picked option", () => {
  render(<CharacterBuilder onCreate={vi.fn()} onCancel={vi.fn()} />);
  fireEvent.click(screen.getByLabelText("builder next")); // → class
  fireEvent.click(screen.getByLabelText("builder next")); // → abilities
  fireEvent.click(screen.getByLabelText("builder next")); // → background
  fireEvent.click(screen.getByLabelText("builder next")); // → profs

  const langAdd = screen.getByLabelText("profs lang add") as HTMLSelectElement;
  fireEvent.change(langAdd, { target: { value: "龍語" } });

  expect(screen.getByText("龍語")).toBeInTheDocument();
  // Controlled dropdown resets to blank after adding.
  expect(langAdd.value).toBe("");
  // Already-picked options drop out of the list (no dupes offered).
  expect(screen.queryByRole("option", { name: "龍語" })).toBeNull();
});

test("profs step: homebrew — picking custom opens a text slot, Add appends a chip", () => {
  render(<CharacterBuilder onCreate={vi.fn()} onCancel={vi.fn()} />);
  fireEvent.click(screen.getByLabelText("builder next")); // → class
  fireEvent.click(screen.getByLabelText("builder next")); // → abilities
  fireEvent.click(screen.getByLabelText("builder next")); // → background
  fireEvent.click(screen.getByLabelText("builder next")); // → profs

  expect(screen.queryByLabelText("profs tool custom")).toBeNull();
  fireEvent.change(screen.getByLabelText("profs tool add"), { target: { value: "__custom" } });
  expect(screen.getByLabelText("profs tool custom")).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("profs tool custom"), { target: { value: "占卜用具" } });
  fireEvent.click(screen.getByLabelText("profs tool custom add"));

  expect(screen.getByText("占卜用具")).toBeInTheDocument();
  // The text slot closes again after adding.
  expect(screen.queryByLabelText("profs tool custom")).toBeNull();
});

test("profs step: clicking a chip's × removes it", () => {
  render(<CharacterBuilder onCreate={vi.fn()} onCancel={vi.fn()} />);
  fireEvent.click(screen.getByLabelText("builder next")); // → class
  fireEvent.click(screen.getByLabelText("builder next")); // → abilities
  fireEvent.click(screen.getByLabelText("builder next")); // → background
  fireEvent.click(screen.getByLabelText("builder next")); // → profs (seeds armor chips here)

  // Barbarian seeds 3 armor chips (輕甲/中甲/盾牌) — indices 0..2.
  expect(screen.getByLabelText("remove armor 2")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("remove armor 0"));
  // Down to 2 chips — index 2 no longer exists.
  expect(screen.queryByLabelText("remove armor 2")).toBeNull();
});

test("armor-for-AC dropdown shows zh names in Chinese mode", () => {
  render(<CharacterBuilder onCreate={vi.fn()} onCancel={vi.fn()} />);
  fireEvent.click(screen.getByLabelText("builder next")); // → class
  fireEvent.click(screen.getByLabelText("builder next")); // → abilities
  fireEvent.click(screen.getByLabelText("builder next")); // → background
  fireEvent.click(screen.getByLabelText("builder next")); // → profs

  expect(screen.getByRole("option", { name: /^皮甲/ })).toBeInTheDocument();
});

test("racial grants: high-elf shows a race-step info block and pre-checks 察覺", () => {
  render(<CharacterBuilder onCreate={vi.fn()} onCancel={vi.fn()} />);

  fireEvent.change(screen.getByLabelText("race select"), { target: { value: "high-elf" } });
  // Fixed-skill grant shows up right on the race step (no "next" needed).
  expect(screen.getByText(/固定技能/)).toBeInTheDocument();
  expect(screen.getByText(/察覺/)).toBeInTheDocument();

  fireEvent.click(screen.getByLabelText("builder next")); // → class (default class: barbarian, 察覺 is in its skill list)
  expect(screen.getByLabelText("skill 察覺")).toBeChecked();
});

test("racial grants: hill-dwarf's weapon training seeds into the profs step", () => {
  render(<CharacterBuilder onCreate={vi.fn()} onCancel={vi.fn()} />);

  fireEvent.change(screen.getByLabelText("race select"), { target: { value: "hill-dwarf" } });
  fireEvent.click(screen.getByLabelText("builder next")); // → class
  fireEvent.click(screen.getByLabelText("builder next")); // → abilities
  fireEvent.click(screen.getByLabelText("builder next")); // → background
  fireEvent.click(screen.getByLabelText("builder next")); // → profs (seeds here)

  for (const weapon of ["戰斧", "手斧", "輕錘", "戰錘"]) {
    expect(screen.getByText(weapon)).toBeInTheDocument();
  }
});
