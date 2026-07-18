import { expect, test, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { CharacterView } from "../../convex/characters";
import { zhTW } from "../i18n/locales/zh-TW";
import { CharactersPanel } from "./CharactersPanel";

/**
 * The card strip's create/import entry points (prep-public-release). Import is
 * where a hand-edited file meets the app, so the interesting cases are the
 * unhappy ones: a wrong file must produce a sentence, never a dead button.
 */

function card(overrides: Partial<CharacterView> = {}): CharacterView {
  return {
    _id: "ch1",
    _creationTime: 1,
    seedKey: null,
    player: "測試玩家",
    nameZh: "測試角色",
    nameEn: "TestHero",
    race: "半身人",
    classesText: "聖騎士 1",
    level: 1,
    alignment: "混亂善良",
    statusText: "正常",
    hp: 12,
    maxHp: 12,
    tempHp: 0,
    ac: 15,
    acFormula: "",
    speedText: "",
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
    classRules: [],
    story: "",
    resources: [],
    recipes: [],
    effects: [],
    ...overrides,
  };
}

/** A File whose `.text()` resolves to `content` (jsdom's File lacks it). */
function jsonFile(content: string): File {
  const file = new File([content], "card.dndcard.json", {
    type: "application/json",
  });
  Object.defineProperty(file, "text", { value: () => Promise.resolve(content) });
  return file;
}

const fileInputOf = () =>
  screen.getByLabelText("import character card file") as HTMLInputElement;

async function pickFile(file: File) {
  const input = fileInputOf();
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    fireEvent.change(input);
  });
}

test("New card creates a card and the strip offers Import alongside it", () => {
  const onNewCard = vi.fn();
  render(
    <CharactersPanel
      characters={[card()]}
      onSeedCharacters={vi.fn()}
      onNewCard={onNewCard}
      onImportCards={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: zhTW.card.newCard }));
  expect(onNewCard).toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: zhTW.card.importCard }),
  ).toBeInTheDocument();
});

test("the sample-cards button survives importing a card of your own", () => {
  // The bug: the button keyed off "table is empty", so one imported card hid
  // it forever and the samples could never be loaded. Having cards and having
  // the SAMPLE cards are different things.
  render(
    <CharactersPanel
      characters={[card({ seedKey: null, nameZh: "我自己的卡" })]}
      onSeedCharacters={vi.fn()}
      onNewCard={vi.fn()}
      onImportCards={vi.fn()}
    />,
  );
  expect(
    screen.getByRole("button", { name: zhTW.card.seedButton }),
  ).toBeInTheDocument();
});

test("the sample-cards button disappears once the sample cards are loaded", () => {
  render(
    <CharactersPanel
      characters={[
        card({ seedKey: null, nameZh: "我自己的卡" }),
        card({ _id: "ch2", seedKey: "demo_fighter", nameZh: "示範戰士" }),
      ]}
      onSeedCharacters={vi.fn()}
      onNewCard={vi.fn()}
      onImportCards={vi.fn()}
    />,
  );
  expect(
    screen.queryByRole("button", { name: zhTW.card.seedButton }),
  ).not.toBeInTheDocument();
});

test("no seed button while the card list is still loading", () => {
  // Undefined = we don't know yet; offering to seed would flash on every open.
  render(
    <CharactersPanel
      characters={undefined}
      onSeedCharacters={vi.fn()}
      onNewCard={vi.fn()}
      onImportCards={vi.fn()}
    />,
  );
  expect(
    screen.queryByRole("button", { name: zhTW.card.seedButton }),
  ).not.toBeInTheDocument();
});

test("both entry points are offered on an empty table, next to Seed", () => {
  // An empty table used to offer only the friend-group seed — a self-hoster
  // with no CSV of their own had no way to make a card at all.
  render(
    <CharactersPanel
      characters={[]}
      onSeedCharacters={vi.fn()}
      onNewCard={vi.fn()}
      onImportCards={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: zhTW.card.newCard })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: zhTW.card.importCard })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: zhTW.card.seedButton })).toBeInTheDocument();
});

test("picking a card file hands the parsed envelope to the import mutation", async () => {
  const onImportCards = vi.fn().mockResolvedValue(undefined);
  render(
    <CharactersPanel
      characters={[card()]}
      onSeedCharacters={vi.fn()}
      onImportCards={onImportCards}
    />,
  );
  const envelope = {
    format: "dnd-combat-toolkit-character",
    version: 1,
    cards: [{ nameZh: "匯入來的" }],
  };
  await pickFile(jsonFile(JSON.stringify(envelope)));
  expect(onImportCards).toHaveBeenCalledWith(envelope);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("a file that isn't JSON at all is reported as the wrong file, not a crash", async () => {
  const onImportCards = vi.fn();
  render(
    <CharactersPanel
      characters={[card()]}
      onSeedCharacters={vi.fn()}
      onImportCards={onImportCards}
    />,
  );
  await pickFile(jsonFile("this is a screenshot, not a card"));
  expect(onImportCards).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent(zhTW.cardErrors.badEnvelope);
});

test("a server rejection is shown to the user in their language", async () => {
  const onImportCards = vi
    .fn()
    .mockRejectedValue({ data: { code: "card.cardTooLarge" } });
  render(
    <CharactersPanel
      characters={[card()]}
      onSeedCharacters={vi.fn()}
      onImportCards={onImportCards}
    />,
  );
  await pickFile(jsonFile(JSON.stringify({ format: "x", cards: [] })));
  expect(screen.getByRole("alert")).toHaveTextContent(zhTW.cardErrors.cardTooLarge);
});

test("a successful retry clears the previous error", async () => {
  const onImportCards = vi
    .fn()
    .mockRejectedValueOnce({ data: { code: "card.badEnvelope" } })
    .mockResolvedValueOnce(undefined);
  render(
    <CharactersPanel
      characters={[card()]}
      onSeedCharacters={vi.fn()}
      onImportCards={onImportCards}
    />,
  );
  await pickFile(jsonFile("{}"));
  expect(screen.getByRole("alert")).toBeInTheDocument();
  await pickFile(jsonFile("{}"));
  // A stale error next to a card that DID import reads as a failure.
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("the file input resets so re-picking the same file retries", async () => {
  // Without the reset, a user who fixes their file and picks it again gets no
  // change event — the button looks broken.
  render(
    <CharactersPanel
      characters={[card()]}
      onSeedCharacters={vi.fn()}
      onImportCards={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  await pickFile(jsonFile("{}"));
  expect(fileInputOf().value).toBe("");
});
