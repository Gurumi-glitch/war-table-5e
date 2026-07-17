# 角色卡 on the 地圖 page — full editable pop-up, parity with 戰爭桌

The full-page 地圖 mount (Frontstage section = "map", Backstage equivalent) used to be a no-edit surface: a player flavor-rolling a die who needed to check (or change) a save mod had to go back to 戰爭桌, open the character card, edit, save, navigate back, then resume. Painful mid-scene and pointless when the same `CharacterCardWindow` component already exists and works on 戰爭桌. Bring the full editable card to the map page, exactly the same UX, so the map is a real working surface, not a read-only display.

## Status amendment — 2026-07-10

The full editable character card and Scene picker remain accepted. Decisions 3–5 below are superseded by the approved `unify-game-shell-navigation` change:

- A Character and a Combatant are distinct domain states. Opening, viewing, focusing, or editing a character card is side-effect free and MUST NOT call `characters.joinBattle`.
- Only the card's explicit `Join battle` control may promote a character into the current combatant list. Until the realtime combatants query contains that character, the open card receives `combatant = null`, stays out of battle, and does not expose combatant-only fields.
- 戰爭桌 and 場景 share one persistent Game Shell and global window layer. Character cards and their child windows are no longer owned separately by `GameBoard` and `MapBoard`; switching workspaces preserves open/fold/position/z state.
- The Scene picker remains the intentional character-card entry point. Map-piece pointer-down remains reserved for dragging.

This amendment reverses the earlier “always in battle” assumption because inspecting a character must not silently change shared combat state. It also replaces the temporary duplicated window ownership now that cross-workspace persistence requires one authoritative owner. Implementation and acceptance scenarios are recorded in `openspec/changes/unify-game-shell-navigation/`.

## Decision

**1. Floating pop-up, same chrome as 戰爭桌 (retained; ownership amended).** When a player clicks a name in the 角色卡 picker (a panel at the top of the side column on the full-page map mount), the full `CharacterCardWindow` opens as a floating parchment pop-up with the same draggable / foldable / z-layerable chrome as 戰爭桌. Under the 2026-07-10 amendment, the persistent global window layer renders the card over either workspace; it is no longer a `MapBoard`-owned sibling of `mb-root`.

**2. Picker, not a list of read-only stats.** Earlier work-in-progress in this branch had a read-only "角色卡速覽" panel (player / name / class / HP / AC / init / 6 mods). The user asked for the *full* card, not a glance, so the picker replaces it. Each entry is a button styled like 戰爭桌's `CharactersPanel` entry — same `📜` glyph, same in-battle `⚔` marker so a player can tell at a glance which cards are already linked to combatants.

**3. Superseded — Always in battle + join-battle from here.** The original implementation called `characters.joinBattle` when opening an out-of-combat card. The 2026-07-10 amendment rejects this implicit mutation. Opening the card is side-effect free; explicit `Join battle` is the sole promotion action.

**4. Superseded — Wiring via `MapBoard` hooks, not via props.** The original implementation duplicated character/resource/recipe/combatant hooks inside `MapBoard`. The 2026-07-10 amendment moves character-card data and mutation ownership to the persistent Game Shell/page integration so one open window has one behavior regardless of workspace. Map-specific maps/pieces/flavor-dice wiring may remain local to the map surface.

**5. Superseded — Inlined `useWindowSet`.** The duplicated window managers cannot preserve identity across workspace switches. The 2026-07-10 amendment requires one shared window-state primitive, namespaced window keys, and one z-order counter owned above both workspace contents.

## Why

The map page is a real working surface; the player should be able to do everything there that they can do on 戰爭桌, including editing their card. The user explicitly asked for "the whole 角色卡 put in 地圖" — exact 戰爭桌 behavior — and the `CharacterCardWindow` component already supports that, so the implementation is "mount the existing component with the right wiring" rather than "build a new editor."

`?Tablet` strips the map entirely (ADR-0006 + ADR-0011), so the picker + floating cards never mount on the tablet. No tablet-specific code path needed.

The floating-window chrome over the map is identical to the floating-window chrome over the war table — the same parchment, the same drag/fold/focus machinery, the same z-index manager. Players who learn the war table's character cards don't have to relearn them on the map; the visual language is shared.

## Considered options

- **Inline editor, no floating chrome.** Embed the card body directly in the side column, no pop-up. Rejected — would be a *second* character-card editor implementation, drifting from the war table over time. The war-table card is the project record (issue #9 design, ADR-0001 / etc.); duplicating it is exactly the kind of fork the project rule against. The floating-chrome reuse is the right call.
- **Add a "join battle" button explicitly, instead of auto-joining on open.** Originally rejected as an extra click; accepted by the 2026-07-10 amendment. Reading and editing are not combat transitions, so explicit intent outweighs the extra click.
- **Read-only character stats, like the earlier 角色卡速覽 panel.** Rejected — the user explicitly asked for the full editable card. The 速覽 panel was a stepping-stone; the floating card supersedes it. The 速覽 styles remain in `MapBoard.css` (kept for now to avoid drive-by diff churn) but the component that uses them is removed.
- **Promote `useWindowSet` to shared ownership.** Originally deferred; accepted by the 2026-07-10 amendment because persistent cross-workspace windows now require a single owner.

## Consequence for future work

Any floating window that must be reachable from either 戰爭桌 or 場景 belongs to the global Game Shell window layer, using a stable namespaced key and the shared z-order manager. A purely map-local transient may remain inside `MapBoard` only when it does not need to survive workspace switches.

R/V/I is available only after explicit Join battle produces a linked combatant. It writes through that combatant (`combatants.update` with `{resist, vuln, immune}` patch), independent of which workspace is visible.

Do not restore separate `GameBoard` and `MapBoard` character-window registries. Cross-workspace open/fold/position/z persistence depends on one authoritative registry above both contents.

The picker is gated on `fullPage` (not the floating `MapWindow` inside the war table) and `!isTablet` (ADR-0006 + ADR-0011), so the map's floating map window inside the war table does not also show a character-card picker — that mount keeps its existing war-table character cards.
