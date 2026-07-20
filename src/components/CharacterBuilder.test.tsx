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
  // High Elf ASI applied: DEX 12 (+1), INT 11
  expect(fields.abilities.find((a) => a.key === "敏捷")!.score).toBe(12);
  expect(fields.abilities.find((a) => a.key === "智力")!.score).toBe(11);
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
  // No racial ASI applied for a custom race: base 10 stays 10 (+0)
  expect(fields.abilities.find((a) => a.key === "敏捷")!.score).toBe(10);
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

  expect(screen.getByLabelText("final 力量")).toHaveTextContent("11");
  expect(screen.getByLabelText("final 敏捷")).toHaveTextContent("11");
  // The 27-point budget only tracks baseScores — the racial pick doesn't touch it.
  expect(screen.getByText(/剩餘點數/).textContent).toBe(pointsBefore);
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

  expect((screen.getByLabelText("profs armor") as HTMLInputElement).value).toContain("Light armor");
});
