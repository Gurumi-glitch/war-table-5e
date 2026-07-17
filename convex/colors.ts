/**
 * The palette of Colors used to identify Combatants on the Dice Board. A
 * Combatant Claims dice in its Color. Colors are auto-assigned when a
 * Combatant enters combat (the next unused palette color), with DM override.
 *
 * 25 hex values chosen for maximum mutual distinguishability on the dark War
 * Table board (based on the 20-distinct-colors set, dropping shades too dim to
 * glow on a near-black background). ORDER MATTERS: auto-assignment walks the
 * list front to back, so the first dozen entries are the most mutually
 * distinct — light/edge-case variants sit at the tail. (The old palette walked
 * the hue wheel, so consecutive combatants got near-identical hues.)
 */
export const PALETTE: readonly string[] = [
  "#e6194b", // red
  "#3cb44b", // green
  "#ffe119", // yellow
  "#4363d8", // blue
  "#f58231", // orange
  "#911eb4", // purple
  "#42d4f4", // cyan
  "#f032e6", // magenta
  "#bfef45", // lime
  "#fabed4", // light pink
  "#469990", // teal
  "#dcbeff", // lavender
  "#9a6324", // brown
  "#fffac8", // cream
  "#aaffc3", // mint
  "#808000", // olive
  "#ffd8b1", // apricot
  "#ffffff", // white
  "#a9a9a9", // gray
  "#8bc4ff", // light blue
  "#c62828", // dark red
  "#14805e", // dark emerald
  "#d4a24e", // ember gold
  "#7b5fb0", // dusk violet
  "#ff6f61", // coral
];

/**
 * Pick the next Color for a new Combatant: the first palette color not already
 * in `used`. If every palette color is taken, the palette cycles (a second
 * combatant can share a color rather than blocking combat entry). Colors not
 * in the palette are ignored — only palette colors count as "used".
 */
export function pickNextColor(used: readonly string[]): string {
  const usedSet = new Set(used);
  for (const color of PALETTE) {
    if (!usedSet.has(color)) {
      return color;
    }
  }
  // All palette colors are taken; cycle from the start.
  return PALETTE[0];
}
