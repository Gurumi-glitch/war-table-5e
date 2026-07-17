/**
 * Pure grid-derivation for the map system (add-map-system, design Decision #2).
 * A map's grid is DERIVED from the uploaded image's own aspect ratio, offered as
 * discrete steps that scale together — never independently-typed cols/rows. Kept
 * pure (no React, no Convex) so it can be unit-tested and shared.
 *
 * Two regimes:
 *  - When the image reduces to a small whole-number ratio (e.g. 1920×1080 → 16:9),
 *    the steps are that base ratio × 1, × 2, × 3, … (16×9, 32×18, 48×27, …) —
 *    matching the spec's worked example exactly.
 *  - Otherwise (an odd photo ratio that won't reduce cleanly), fall back to a
 *    fixed column-count ladder, deriving rows from the exact ratio so every step
 *    still preserves the image's shape.
 */

export type GridStep = {
  cols: number;
  rows: number;
  /** e.g. "32 × 18 squares (160 ft × 90 ft)". */
  label: string;
};

/** Greatest common divisor (Euclid). */
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** 5 ft per grid square (5e). */
export const FEET_PER_SQUARE = 5;

/** Human label for one step, including the real-world size in feet. */
export function stepLabel(cols: number, rows: number): string {
  return `${cols} × ${rows} 格 (${cols * FEET_PER_SQUARE} ft × ${rows * FEET_PER_SQUARE} ft)`;
}

/**
 * Derive the grid-density steps for an image of natural `width`×`height`.
 * Returns steps from coarsest to finest. Always returns at least one step.
 */
export function gridSteps(width: number, height: number): GridStep[] {
  if (!(width > 0) || !(height > 0)) {
    // Degenerate (unknown dimensions) — a single sane square-ish default.
    return [{ cols: 16, rows: 16, label: stepLabel(16, 16) }];
  }
  const g = gcd(width, height);
  const baseCols = width / g;
  const baseRows = height / g;

  const steps: GridStep[] = [];
  if (baseCols <= 32 && baseRows <= 32) {
    // Clean ratio: base × 1, × 2, … until cols would exceed ~64.
    for (let k = 1; baseCols * k <= 64; k++) {
      const cols = baseCols * k;
      const rows = baseRows * k;
      steps.push({ cols, rows, label: stepLabel(cols, rows) });
    }
  } else {
    // Odd ratio: fixed column ladder, rows derived from the exact ratio.
    const ratio = width / height;
    for (const cols of [12, 16, 20, 24, 32, 40]) {
      const rows = Math.max(1, Math.round(cols / ratio));
      steps.push({ cols, rows, label: stepLabel(cols, rows) });
    }
  }
  return steps;
}
