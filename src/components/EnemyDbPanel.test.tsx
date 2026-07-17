import { test, expect, vi } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { EnemyDbPanel } from "./EnemyDbPanel";
import type { EnemyView } from "../../convex/enemies";

/**
 * The 👹 敵人庫 window content (issue #6): browse/search templates, Spawn,
 * and the custom editor. Backend gating is covered in convex-tests; these
 * cover the panel's own behavior.
 */

function enemy(overrides: Partial<EnemyView> = {}): EnemyView {
  return {
    _id: "e1",
    _creationTime: 0,
    seedKey: "mist_hound",
    source: "seed",
    nameZh: "霧獵犬",
    nameEn: "Mist Hound",
    symbol: "u",
    role: "skirmisher",
    themeTags: "forest|mist",
    size: "中型",
    creatureType: "野獸",
    temperament: "飢餓",
    threatTier: 1,
    ac: 12,
    hpMax: 14,
    hpFormula: "4d8-4",
    speedText: "45呎",
    abilities: [
      { key: "力量", score: 13, mod: 1 },
      { key: "敏捷", score: 15, mod: 2 },
      { key: "體質", score: 9, mod: -1 },
      { key: "智力", score: 3, mod: -4 },
      { key: "感知", score: 13, mod: 1 },
      { key: "魅力", score: 6, mod: -2 },
    ],
    saveBonuses: [{ key: "敏捷", bonus: 2 }],
    skills: [{ key: "stealth", bonus: 4 }],
    senses: "黑暗視覺60呎",
    passivePerception: 13,
    languages: "—",
    damageResistances: "",
    damageVulnerabilities: "",
    damageImmunities: "",
    conditionImmunities: "",
    traits: [{ name: "霧步", effect: "無視困難地形。" }],
    actions: [
      { name: "咬擊", kind: "melee_attack", to_hit: 4, damage: "2d4+2 穿刺" },
    ],
    bonusActions: [],
    reactions: [],
    legendaryActions: [],
    tactics: "",
    encounterNotes: "",
    ...overrides,
  };
}

const handlers = () => ({
  onSeed: vi.fn(),
  onBackfill: vi.fn(),
  onSpawn: vi.fn(),
  onCreate: vi.fn(),
  onUpdate: vi.fn(),
  onRemove: vi.fn(),
});

test("lists templates and spawns via the ⚔ button", () => {
  const h = handlers();
  render(<EnemyDbPanel enemies={[enemy()]} {...h} />);
  expect(screen.getByText("霧獵犬")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "spawn 霧獵犬" }));
  // Spawn carries the locale-resolved display name (default zh-TW → zh name).
  expect(h.onSpawn).toHaveBeenCalledWith("e1", "霧獵犬");
});

test("deleting requires a second in-place confirmation and cancels on blur", async () => {
  const h = handlers();
  render(<EnemyDbPanel enemies={[enemy()]} {...h} />);

  fireEvent.click(screen.getByRole("button", { name: "delete 霧獵犬" }));
  expect(h.onRemove).not.toHaveBeenCalled();

  const confirm = screen.getByRole("button", { name: "confirm delete 霧獵犬" });
  expect(confirm).toHaveTextContent("確定刪除？");
  await act(async () => {
    confirm.focus();
  });
  expect(confirm).toHaveFocus();
  // Native focus transfer dispatches the confirm button's blur handler, as
  // happens when the DM Tabs to a neighboring action instead of confirming.
  const edit = screen.getByRole("button", { name: "edit 霧獵犬" });
  await act(async () => {
    edit.focus();
  });
  expect(edit).toHaveFocus();
  expect(screen.getByRole("button", { name: "delete 霧獵犬" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "delete 霧獵犬" }));
  fireEvent.click(screen.getByRole("button", { name: "confirm delete 霧獵犬" }));
  expect(h.onRemove).toHaveBeenCalledWith("e1");
});

test("delete confirmation expires after five seconds", async () => {
  vi.useFakeTimers();
  try {
    const h = handlers();
    render(<EnemyDbPanel enemies={[enemy()]} {...h} />);
    fireEvent.click(screen.getByRole("button", { name: "delete 霧獵犬" }));
    expect(screen.getByRole("button", { name: "confirm delete 霧獵犬" })).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByRole("button", { name: "delete 霧獵犬" })).toBeInTheDocument();
    expect(h.onRemove).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

test("search narrows by name; source filter narrows by origin", () => {
  const h = handlers();
  render(
    <EnemyDbPanel
      enemies={[
        enemy(),
        enemy({ _id: "e2", seedKey: "srd_wolf", source: "srd", nameZh: "", nameEn: "Wolf" }),
      ]}
      {...h}
    />,
  );
  fireEvent.change(screen.getByLabelText("enemy search"), {
    target: { value: "wolf" },
  });
  expect(screen.queryByText("霧獵犬")).not.toBeInTheDocument();
  expect(screen.getByText("Wolf")).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("enemy search"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("enemy source filter"), {
    target: { value: "seed" },
  });
  expect(screen.getByText("霧獵犬")).toBeInTheDocument();
  expect(screen.queryByText("Wolf")).not.toBeInTheDocument();
});

test("seed button shows only when the DB is empty", () => {
  const h = handlers();
  const { rerender } = render(<EnemyDbPanel enemies={[]} {...h} />);
  fireEvent.click(screen.getByRole("button", { name: "seed enemy database" }));
  expect(h.onSeed).toHaveBeenCalled();
  rerender(<EnemyDbPanel enemies={[enemy()]} {...h} />);
  expect(
    screen.queryByRole("button", { name: "seed enemy database" }),
  ).not.toBeInTheDocument();
});

test("補中文名 button shows only while some template lacks a zh name", () => {
  const h = handlers();
  const { rerender } = render(
    <EnemyDbPanel
      enemies={[enemy(), enemy({ _id: "e2", seedKey: "srd_wolf", source: "srd", nameZh: "", nameEn: "Wolf" })]}
      {...h}
    />,
  );
  const btn = screen.getByRole("button", { name: "fill chinese names" });
  expect(btn).toHaveTextContent("補中文名（1）");
  fireEvent.click(btn);
  expect(h.onBackfill).toHaveBeenCalledTimes(1);
  // Once every row has a zh name the button self-hides.
  rerender(<EnemyDbPanel enemies={[enemy()]} {...h} />);
  expect(screen.queryByRole("button", { name: "fill chinese names" })).not.toBeInTheDocument();
});

test("editing a template round-trips unedited fields and parsed action JSON", async () => {
  const h = handlers();
  render(<EnemyDbPanel enemies={[enemy()]} {...h} />);
  fireEvent.click(screen.getByRole("button", { name: "edit 霧獵犬" }));
  fireEvent.change(screen.getByLabelText("enemy ac"), { target: { value: "15" } });
  fireEvent.click(screen.getByRole("button", { name: "save enemy" }));
  // The save resolves async and closes the form back to the browse list.
  await screen.findByRole("button", { name: "edit 霧獵犬" });
  expect(h.onUpdate).toHaveBeenCalledTimes(1);
  const [id, fields] = h.onUpdate.mock.calls[0];
  expect(id).toBe("e1");
  expect(fields.ac).toBe(15);
  // Fields the form doesn't surface survive the round-trip…
  expect(fields.saveBonuses).toEqual([{ key: "敏捷", bonus: 2 }]);
  expect(fields.symbol).toBe("u");
  // …and the action JSON re-parses to the original block.
  expect(fields.actions).toEqual([
    { name: "咬擊", kind: "melee_attack", to_hit: 4, damage: "2d4+2 穿刺" },
  ]);
  // Convex system fields must be stripped — update's validator rejects extras.
  expect("_id" in fields).toBe(false);
  expect("_creationTime" in fields).toBe(false);
  // The bilingual names survive so the DM's zh/en edits actually persist.
  expect(fields.nameZh).toBe("霧獵犬");
  expect(fields.nameEn).toBe("Mist Hound");
});

test("a rejected save keeps the form open and shows the error", async () => {
  const h = handlers();
  h.onUpdate.mockRejectedValue(new Error("boom"));
  render(<EnemyDbPanel enemies={[enemy()]} {...h} />);
  fireEvent.click(screen.getByRole("button", { name: "edit 霧獵犬" }));
  fireEvent.change(screen.getByLabelText("enemy ac"), { target: { value: "15" } });
  fireEvent.click(screen.getByRole("button", { name: "save enemy" }));
  // The mutation rejected — the form stays mounted and the DM's input is intact.
  expect(await screen.findByText("boom", { exact: false })).toBeInTheDocument();
  expect(screen.getByLabelText("enemy name zh")).toBeInTheDocument();
});

test("invalid action JSON blocks save with an error instead of dropping data", () => {
  const h = handlers();
  render(<EnemyDbPanel enemies={[enemy()]} {...h} />);
  fireEvent.click(screen.getByRole("button", { name: "edit 霧獵犬" }));
  fireEvent.change(screen.getByLabelText("enemy actions json"), {
    target: { value: "{not json" },
  });
  fireEvent.click(screen.getByRole("button", { name: "save enemy" }));
  expect(h.onUpdate).not.toHaveBeenCalled();
  expect(screen.getByText("JSON 格式錯誤", { exact: false })).toBeInTheDocument();
});

test("＋自訂敵人 opens a blank form and creates a custom entry", async () => {
  const h = handlers();
  render(<EnemyDbPanel enemies={[enemy()]} {...h} />);
  fireEvent.click(screen.getByRole("button", { name: "new custom enemy" }));
  fireEvent.change(screen.getByLabelText("enemy name zh"), {
    target: { value: "地窖食屍鬼" },
  });
  fireEvent.click(screen.getByRole("button", { name: "save enemy" }));
  // The save resolves async and closes the form back to the browse list.
  await screen.findByRole("button", { name: "new custom enemy" });
  expect(h.onCreate).toHaveBeenCalledTimes(1);
  const [fields] = h.onCreate.mock.calls[0];
  expect(fields.nameZh).toBe("地窖食屍鬼");
  expect(fields.source).toBe("custom");
});
