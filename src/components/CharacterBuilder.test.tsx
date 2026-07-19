import { expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CharacterBuilder, type BuilderPayload } from "./CharacterBuilder";

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
