import { test, expect } from "vitest";
import { gridSteps, stepLabel, FEET_PER_SQUARE } from "./mapGrid";

test("a clean 16:9 image steps through 16×9, 32×18, 48×27, 64×36", () => {
  const steps = gridSteps(1920, 1080);
  expect(steps.map((s) => [s.cols, s.rows])).toEqual([
    [16, 9],
    [32, 18],
    [48, 27],
    [64, 36],
  ]);
});

test("a clean 4:3 image reduces to a 4:3 base ratio", () => {
  const steps = gridSteps(1024, 768);
  expect(steps[0]).toMatchObject({ cols: 4, rows: 3 });
  // Every step preserves 4:3.
  for (const s of steps) expect(s.cols / s.rows).toBeCloseTo(4 / 3);
});

test("an odd photo ratio falls back to the column ladder but preserves shape", () => {
  const steps = gridSteps(1023, 767); // ~4:3 but gcd = 1
  expect(steps.map((s) => s.cols)).toEqual([12, 16, 20, 24, 32, 40]);
  for (const s of steps) {
    // rows track the true ratio within rounding.
    expect(s.rows).toBe(Math.round(s.cols / (1023 / 767)));
  }
});

test("step label shows the squares and the real-world feet size", () => {
  expect(stepLabel(32, 18)).toBe("32 × 18 格 (160 ft × 90 ft)");
  expect(FEET_PER_SQUARE).toBe(5);
});

test("degenerate dimensions yield a single sane default", () => {
  expect(gridSteps(0, 0)).toHaveLength(1);
  expect(gridSteps(0, 0)[0].cols).toBeGreaterThan(0);
});

test("re-grid from natural dimensions matches creation's ladder and differs from the stored-grid ladder", () => {
  // An odd-ratio map (1000×605, gcd 5 → base 200×121, both > 32) whose creation
  // step landed on 20×12. Re-gridding must re-derive from the recorded natural
  // dimensions (the ladder creation offered), not from the rounded 20×12 (which
  // reduces to a clean 5:3 and drifts the aspect ratio).
  const fromNatural = gridSteps(1000, 605);
  expect(fromNatural.map((s) => [s.cols, s.rows])).toEqual([
    [12, 7],
    [16, 10],
    [20, 12],
    [24, 15],
    [32, 19],
    [40, 24],
  ]);

  const fromStoredGrid = gridSteps(20, 12);
  // 20×12 reduces to 5:3 — a clean-ratio ladder, a different shape than the odd
  // natural-dimensions ladder above.
  expect(fromStoredGrid[0]).toMatchObject({ cols: 5, rows: 3 });
  expect(fromStoredGrid.map((s) => [s.cols, s.rows])).not.toEqual(
    fromNatural.map((s) => [s.cols, s.rows]),
  );
});
