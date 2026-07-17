const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

/**
 * Parses a spell-slot level out of a freeform resource label, or null.
 * Matches "L1 slots" / "L2 slots" (English presets) and "L1 法術位" /
 * "1級法術位" (Chinese labels) without false-positiving on "Ki", "Rage",
 * "Lay on Hands", or other homebrew labels.
 */
export function parseSlotLevel(label: string): number | null {
  const en = label.match(/^L(\d{1,2})\b/i);
  if (en) {
    const n = Number(en[1]);
    return n >= 1 && n <= 10 ? n : null;
  }
  const zh = label.match(/(\d{1,2})\s*級/);
  if (zh) {
    const n = Number(zh[1]);
    return n >= 1 && n <= 10 ? n : null;
  }
  return null;
}

export function romanFor(level: number): string {
  return ROMAN[level - 1] ?? String(level);
}

/** Roman numeral for a parsed spell-slot level, else the label as-is. */
export function headerFor(label: string): string {
  const level = parseSlotLevel(label);
  return level !== null ? romanFor(level) : label;
}
