# War Table map entry points: 場景 (section) + 地圖 (floating window)

The 戰爭桌 topbar has two ways to reach the map, and they used to be confusingly named: both wore the 🗺 icon and both lived in the right cluster of utility buttons, with no visual hint that one swaps the whole layout and the other floats over it. Rename + reposition so the distinction is obvious from the topbar alone.

## Decision

**1. Two entry points, two roles, two labels.** The map is reached two different ways in 戰爭桌 and each has a different job:

- **場景** — the full-page section that replaces the table for a while (`setSection("map")` in `Frontstage.tsx` / `Backstage.tsx`). Player wants to step out of combat, look at the map, drag pieces around. The label is 場景 because the player is *changing scenes* — leaving the war-table view.
- **地圖** — the floating window over the table (`mapWin.open("map")` in `GameBoard.tsx`, `add-map-system` task 9.3). Player wants to glance at the map mid-combat, place a piece, flavor-roll a die, and snap back. The label stays 地圖 because the table is still the surface; the map is layered on top.

**2. Sibling-pair layout in the topbar.** 場景 moves out of the right cluster and sits immediately after the `⚜ 戰爭桌` title, sharing the same `⚜` brand mark so the eye groups them as one navigation block. 地圖 stays in the right cluster of utility buttons (共用板 / DM / 敵人庫 / 地圖) where it reads as "another drawer".

**3. Typographic twin, not a duplicate.** The 場景 button is styled as a typographic twin of the title — same Cinzel + 700 + 0.22em letter-spacing + crimson `text-shadow` (`button.wt-topnav` rule in `warTable.css`). It keeps its own button chrome (border, hover, focus) so it still reads as a control. The 戰爭桌 ↔ 場景 pair should look like "two equal siblings" — not "title + subtitle" and not "title + button" — so a player doesn't have to study the topbar to know which one is the section switch.

## Why

The original "🗺 地圖 / 🗺 視窗" pair named the buttons by *layout difference* (full-page vs. floating). That information is real but it's not what the player is doing when they click — the player is choosing *between two roles* (change scenes vs. glance at the map). The new "場景 / 地圖" pair names them by role, which matches the action. Layout is implementation; role is intent.

The `⚜` brand mark on both 場景 and 戰爭桌 is the same one that already appears on `⚜ 返回戰爭桌` (the map page's exit button) — a single glyph, three places, one family. The eye groups them automatically.

The typographic twin matters more than the label: the only reason the title currently feels weighty is its typography. A button labeled 場景 but wearing the generic `.wt :where(button)` Noto Sans 500 chrome reads as "label next to a heading", not as a sibling. Matching Cinzel + 700 + 0.22em tracking + the crimson glow is the change that actually delivers the sibling-pair read.

## Considered options

- **Rename but keep both in the right cluster.** Rejected — keeps the original confusion (which is which?). Putting 場景 next to 戰爭桌 is the load-bearing part of the change.
- **Drop the section button entirely and only keep the floating window.** Rejected — the section is where the player goes to *focus* on the map (drag pieces around, browse the library, edit the character card with the picker — see ADR-0013). Collapsing it to a window would put 7 panels in a too-small box on phone-sized screens.
- **Use 場景 for the floating window and 地圖 for the section.** Rejected — the floating window literally shows a map; the section is more than a map (it's the whole stage area with pieces + dice + character-card picker + DM-only library). Inverting the labels fights the implementation.
- **Make 場景 a heading (h2), not a button.** Rejected — the section entry is interactive (clicks switch sections). A heading would be a lie about what the element is. A button is honest.

## Consequence for future work

When adding a new section that takes over the page, follow this pattern: same `⚜` brand mark on the section-nav button, sit it next to the title, give it a `wt-topnav` class (or a similar named opt-out per the project's zero-specificity base layer, ADR-0009). New drawers (windows that float over the table) go in the right cluster and keep the drawer-icon convention (📋/🗝/👹/🗺) — not the `⚜` brand mark.

The map is already off `?Tablet` (ADR-0006 / ADR-0011) so neither entry point shows on the tablet, and the new sibling layout inherits that gating.

## Standing constraint (footgun — in-code, not ADR-level)

`button.wt-topnav` uses element+class specificity on purpose. A bare `.wt-topnav` rule would **tie** with the zero-specificity `.wt :where(button)` base and lose in the **minified production** CSS — dev hides it. Always `button.classname` for any specificity-dependent button override in this project. Documented at the top of `warTable.css` and in the `warTable-css-specificity-gotcha` memory; stays in-code as the source of truth, not duplicated here.
