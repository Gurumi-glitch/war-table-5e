# Localization is a display layer — storage keys never translate, and the combat log ships structured events

The UI shipped bilingual (zh-TW / en) in PR #59; the full proposal and task record are local-only working docs. The acceptance criterion was set up front: **adding a third language must be adding one file** — not a migration, not a schema change, not a second rendering path. This ADR fixes the contracts that make that true, and the one data-shape change it required.

Note this reverses `CLAUDE.md`'s "v2 / deferred (i18n)" listing — it shipped early because going public (ADR-0014) makes a Chinese-only UI unusable for the audience the public release exists for.

## Decision

**1. Language is a display layer. Storage keys are never translated.** Ability keys (`力量`), skill keys (`隱匿`), condition keys, and canonical English damage types (`piercing`) are **database identifiers that happen to look like words**. They stay exactly as they are in every locale; `src/i18n/terms.ts` maps key → label at render time (`abilityLabel`, `skillLabel`, `damageTypeLabel`, `saveAbilityLabel`). Unknown keys — the DM's homebrew customs — display as themselves rather than erroring or blanking.

This generalizes the pattern ADR-0005 already established for damage types (canonical key + zh/en alias map in `convex/rules.ts`) to the whole UI. The consequence is the important half: **translating a storage key is a data migration wearing a translation's clothes.** Every character card's `saves`/`skills` map, every condition spec, and every seeded row is keyed on those strings. They are not English-pending; they are the schema.

**2. One typed registry; the type system enforces completeness.** `Messages = typeof zhTW` (`src/i18n/types.ts`) derives the message contract from the zh-TW baseline, and every locale declares `const xx: Messages` — so a missing, extra, or misspelled key anywhere in the tree fails `tsc`. An incomplete translation cannot ship silently; it cannot ship at all. Adding a language = add `locales/<tag>.ts` + one line in `registry.ts` (`src/i18n/registry.ts`). Nothing else reads the locale list.

No i18n library. The bundle is a constraint (ADR-0006's tablet), ICU plurals/dates aren't used, and the whole runtime is a context + a hook.

**3. The combat log stores structured events; clients render them.** `combatLog.event` (`convex/schema.ts`) carries the resolved facts — kind, recipe name, DC, per-target hit/crit/save/damage/darts — and `src/i18n/renderLogEvent.ts` composes the sentence in the *viewer's* language. Contracts:

- **Dual-write, expand-only.** `event` is optional and additive. Rows written before this shipped have no `event` and render via the server-composed `rollSummary` string, which is still written alongside. No migration, no backfill; legacy rows render correctly forever. Same discipline as ADR-0015 §4's envelope versioning — old data lives forever.
- **Player text is embedded verbatim, never translated.** Combatant names, recipe names, extra-roll labels, reaction names, `effectText`. The DM's 薩滿之怒 stays 薩滿之怒 for an English reader; machine-translating a player's homebrew would be both wrong and rude. Only *engine vocabulary* (hit/miss/crit/save/damage types) localizes.
- **Enum-shaped fields cross the wire as canonical keys**, not as rendered text: `damageType` canonical English, `saveAbility` lowercase English as stored on the recipe. The client localizes at the edge. A server that wrote localized strings would bake the writer's language into shared history.
- **The engine still resolves everything.** It stops *formatting the sentence*, nothing else. ADR-0007's single-chokepoint rule is intact — `renderLogEvent` is a pure function of (event, messages) with no rules in it. Switching language re-renders the whole history, which is the cheap proof it holds no state.

**4. Locale is per-device, not per-game.** `?lang=` URL override > `localStorage` > `zh-TW` default (`src/i18n/index.tsx`). Deliberately **not** synced game state: two players at one table read different languages, and the `?lang=` override is transient (never written back) so a TTS-tablet bookmark can pin a language without stomping the device's own preference. It joins `?desktop` and `?Tablet` as the third member of the URL-override family — see ADR-0006 clause 3; the three are independent and compose.

## Why

- **The one-file promise is the whole point.** Every clause above exists to keep "add a language" from touching the database, the engine, or the log's history. The two ways that promise dies are translating storage keys (turns every language into a migration) and letting the server compose display strings (turns history into one language's artifact). Both are closed structurally.
- **zh-TW is the baseline, not the fallback.** The table plays in Chinese; deriving `Messages` from zh-TW means the language the group actually uses is the one that can't drift, and English is checked against it by the compiler.
- **Server-composed strings can't be un-baked.** The log is append-only (never edited, never deleted). A row written as Chinese prose is Chinese prose forever — for every future reader, in every future language. Structuring the event was the only change that fixes the *existing* log's rows too (they re-render in the new locale as soon as they carry an `event`).

## Considered options

- **i18next / react-intl.** Rejected — bundle weight against ADR-0006's tablet, ICU features unused, and the type-enforced completeness we get from `typeof zhTW` is stronger than a runtime "missing key" warning. The whole system is ~100 lines.
- **English storage keys with a zh display map** ("the proper way round"). Rejected — it is a migration of every card, spec, and seed row for zero user-visible benefit; the keys are already canonical and already work. `rules.ts` damage types are English for their own historical reason, and `terms.ts` bridges both directions, so the mixed baseline costs one lookup, not a rewrite.
- **Server renders the log in a per-game language.** Rejected — bakes one language into append-only shared history, and forces a language to be game state (so the tablet and the DM's laptop couldn't differ).
- **Machine-translate player content.** Rejected — homebrew names and notes are the DM's authored voice (ADR-0002); the app has no business rewriting them.
- **Per-game locale setting.** Rejected — a table's players read different languages; the device is the right scope.

## Consequence for future work

Adding a language = one locale file + one registry line. If you find yourself touching anything else, something above has been broken.

Adding a UI string = add it to `zh-TW.ts` first (the baseline defines the contract), then `tsc` tells you every locale that now needs it. Never inline a display string in a component — the CJK sweep that caught the last of them is not automated, so a hardcoded string is invisible until an English reader hits it.

Adding an engine fact to the log = extend the `event` validator **optionally** (expand-only; existing rows must stay valid) and teach `renderLogEvent` to render it. Never widen `rollSummary` instead — it's the legacy path, kept only for rows that predate `event`.

**`LogEvent.kind` is a rendering discriminator, not a `hitType`** — and the difference matters, because conflating them is exactly the bug ADR-0007's amendment records. `kind: "darts"` is emitted only inside the automatic branch (`combatLog.ts:874`: `isHeal ? "heal" : isDarts ? "darts" : "auto"`), where it selects a *sentence shape*. An attack-with-darts logs `kind: "attack"` and carries per-target dart counts on the target rows, exactly as ADR-0007 requires. Do not read `kind` as the recipe's resolution mode, and do not add a `kind` that implies one.

New shared surfaces inherit clause 1's question: is this string an identifier or a label? Identifiers stay put and get a map; labels live in the locale files.
