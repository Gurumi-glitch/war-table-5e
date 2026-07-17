# TTS tablet is a first-class deployment target (build-target quirks + `?Tablet` tracker mode)

The group runs Curse of Strahd on Tabletop Simulator, and a TTS in-game tablet (embedded Chromium) is the shared player-facing view alongside TTS. The tablet is still live at the table, but its resolution and touchscreen are poor, so its role is being narrowed from "full combat surface" to **battle-stats tracker** (PC list, enemy list, character cards' notes/?, combat log).

## Decision

**1. The tablet's embedded Chromium is a first-class deployment target.** Four frontend quirks exist to make the app work on it and must not be removed as "legacy cruft" or cleaned up in a YAGNI pass:

- `build.target: "es2015"` (`vite.config.ts`) — the tablet's Chromium can't parse newer JS syntax.
- `src/lib/polyfills.ts` as `main.tsx`'s first import — fills APIs the tablet's Chromium lacks.
- All Markdown routed through `SafeMarkdown` (never `<ReactMarkdown>` directly) — mandatory both for the tablet's renderer and for the no-login shared-URL threat model (anyone with the URL can submit markdown).
- `?desktop` URL override — forces the full desktop grid layout on a narrow viewport. This is a **layout-density** toggle, general-purpose (also useful for a phone).

**2. A `?Tablet` content-scope mode (partially implemented — see status)** strips the Dice Board, Battle, and Batch Battle surfaces — the heavy interactive combat input that's impractical on the tablet's bad touchscreen — and keeps everything else: 冒險者/PC list, 敵影/enemy list, character cards (notes + ?), 戰鬥紀錄/combat log, and most edits (notes, conditions, recipes, combatant edits, advance turn). The tablet stays **read-mostly, not read-only**: the strip is a UX choice for the touchscreen, not a permission boundary (the backend already withholds DM-only fields per ADR-0001/0002).

### Status (2026-07-16) — half the strip is real, half is still just this ADR

The decision above is unchanged; this records how much of it exists, because the ADR previously said "not yet implemented" and that is no longer true in either direction.

- **Shipped: the map strip.** `?Tablet` pins the shell to the war workspace and removes every map surface — 場景 section nav, the floating 地圖 window, and the map page's character-card picker (`GameShell.tsx:72-101`, `MapBoard.tsx:118-120`). This is what ADR-0011 and ADR-0013 already assume ("the map is off `?Tablet`"), so those two ADRs are accurate.
- **Not shipped: the combat-input strip.** The Dice Board, Battle, and Batch Battle panels still render on the tablet — `GameBoard.tsx` reads no tablet flag at all. So today the tablet gets exactly the heavy touch input this ADR says it shouldn't. Still the intended direction; nothing has been decided against it.

**3. URL overrides are a family of three independent, composable concerns** — none of them implies another, and each is one boolean read from the query string:

- `?desktop` = **layout-density** (forces the desktop grid on a narrow viewport; keep for phones etc.).
- `?Tablet` = **content-scope** (which surfaces exist at all). A purpose-built `?Tablet` view sizes itself for the tablet without also needing `?desktop`.
- `?lang` = **locale** (ADR-0016; `?lang` > localStorage > zh-TW, per-device and never synced — it exists partly so a tablet bookmark can pin its language).

**4. Dependency upgrades are gated by the same build target.** `build.target: "es2015"` only protects the tablet if every *dependency's shipped code* also survives transpilation to it — a package that publishes untranspilable syntax, or a Vite major that drops the es2015 target, produces a blank page **only on the tablet**, silently, with CI fully green. Verified floor as of 2026-07-16: React 19, Vite 8, Vitest 4, TypeScript 7, react-router 7 (PRs #41/#45/#47/#57) all build against `target: "es2015"`, which is unchanged and load-bearing. A future major that forces dropping it is a reversal of this ADR (clause 1), not a routine merge.

## Why

No-login (ADR-0001) means the tablet loads the same app by URL; its embedded Chromium is the deployment constraint that forces the four quirks. The `?Tablet` strip removes only what doesn't work on a bad touchscreen — everything else stays usable, consistent with the open-buttons / DM-authority ethos (ADR-0002).

## Considered options

- **Drop TTS support entirely.** Rejected — the tablet is still live at the table as the shared tracker.
- **Make `?Tablet` a read-only permission boundary.** Rejected — fights the open-buttons/DM-authority ethos; backend already gates DM-only fields. The strip is UX, not security.
- **Replace `?desktop` with `?Tablet`.** Rejected — they're different concerns (layout-density vs content-scope) and compose independently.

## Consequence for future work

Any new feature with heavy interactive input should not be wired into the `?Tablet` view. Removing `es2015` / `polyfills.ts` / `SafeMarkdown` / `?desktop` requires first confirming the tablet is no longer a deployment target — and per clause 4, so does accepting a dependency major that can't build to the target. When the rest of `?Tablet` is implemented, strip sections from the existing Frontstage surface rather than duplicating a whole second view (the shipped map strip is the pattern: one flag, gate the mount, no second view). The Dice Board + Claim + Confirm flow (ADR-0007) is explicitly *not* on the tablet.

**The tablet has no CI gate.** Every constraint in this ADR fails silently — a blank page or a swallowed keystroke on one device nobody's test suite touches, while the build stays green. This ADR is the check; there isn't another one. Anything that changes the build target, the polyfill set, or a dependency's output syntax needs a human to open the app on the actual tablet before it ships.
