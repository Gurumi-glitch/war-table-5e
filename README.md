# War Table 5e

A no-login, link-based combat toolkit for tabletop RPG groups playing fifth
edition. A DM creates a **Game** and gets two URLs: a secret **DM URL**
(Backstage) and a **player URL** (Frontstage). Everyone opens a URL and sees the same realtime combat state,
synced through a [Convex](https://convex.dev) backend. The DM is the authority;
automation never blocks a manual ruling.

**v1 shipped:** no-login realtime Game with Frontstage/Backstage split, combatant
list + lite initiative, the Dice Board (batch roll / claim / confirm), a full
character editor, action recipes with a rules-aware confirm engine (advantage/
disadvantage, saves, conditions), and an enemy database (SRD import + custom
editor) with spawn-as-independent-instance. The DM can edit any stat, spawn/kill
any unit, and force any result at any time — automation is a convenience layer,
never a gatekeeper.

## Try it

**[Live demo](https://war-table-toolkit-5e-demo.vercel.app)** — no signup, no install. Create a
game, open a sample character card, and run a fight. The demo runs with
`PLAYGROUND_MODE` on: cards you make are visible only inside your own game, the
sample cards are read-only, and **data is wiped periodically** — export any
character you want to keep (see [Character files](#character-files)).

## Self-host in 15 minutes

Both Convex and Vercel have free tiers that comfortably run a weekly table.

1. **Fork this repo**, then `npm install`.
2. **`npx convex deploy`** — creates a Convex project and prints its URL. (First
   run opens a browser to log in.)
3. **Import to Vercel**, set `VITE_CONVEX_URL` to that URL, and deploy.
4. Open your Vercel URL, hit **Create Game**, and share the player URL.

That is the whole setup. Leave `PLAYGROUND_MODE` unset — the default is the
friend-group table: character cards are global across your games, everything is
editable, no demo banner. You only ever set it if you are hosting a public
sandbox for strangers.

## Character files

A character card exports to a `.dndcard.json` file (**⬇ Export** on the card)
and imports back through **⬆ Import** in the Characters strip. That is how you
move a PC between deployments, keep a backup, or rescue a character from the
public demo before it is wiped. Imports pass server-side customs: unknown fields
are dropped, HP is clamped to the card's max, and size limits apply.

The repo ships four SRD sample characters (`convex/demoSeed.ts`) — a Fighter,
Wizard, Cleric, and Rogue — as the "Load sample cards" button. Your own party's
cards live in your own deployment's database and are never in this repo.

## Stack

- **Frontend:** Vite + React + TypeScript (deployable to Vercel)
- **Backend:** Convex (realtime, no-login, URL-token identity)
- **Tests:** Vitest + `convex-test` (backend seam) + Testing Library (UI smoke)

## Getting started

```bash
npm install

# Start the Convex backend (creates a deployment + generates `convex/_generated/`).
# This opens a browser to log in / pick a deployment the first time.
npx convex dev

# Copy the deployment URL Convex prints into .env.local:
#   VITE_CONVEX_URL=https://<your-deployment>.convex.cloud

npm run dev
```

Open the app, click **Create a new Game**, and share the two links it shows.

> **No-deployment dev path:** the backend tests run in-memory via `convex-test`
> and need no deployment. A minimal `convex/_generated/api.ts` is committed so
> the frontend builds without codegen; running `npx convex dev` overwrites it
> with the fully-typed version (expected).

## Scripts

| Script                  | What it does                                                      |
| ----------------------- | ----------------------------------------------------------------- |
| `npm run dev`         | Vite dev server                                                   |
| `npm run build`       | `tsc --noEmit` + Vite production build                          |
| `npm run preview`     | Preview the production build locally                              |
| `npm test`            | Run the full Vitest suite once                                    |
| `npm run test:watch`  | Vitest in watch mode                                              |
| `npm run typecheck`   | `tsc --noEmit`                                                  |
| `npm run gen:enemies` | Regenerate`convex/enemySeed.ts` from `seed/` (SRD + bestiary) |
| `npm run gen:library` | Regenerate`convex/library.ts` (weapons/spells) from `infos/`  |

## URLs & roles

A Game has a public `playerToken` (in the player URL) and a secret `dmToken`
(in the DM URL):

- Player (Frontstage): `/play/<playerToken>`
- DM (Backstage): `/dm/<playerToken>/<dmToken>`

The **backend** resolves the role from the token and withholds DM-only fields
(`dmNote`, each combatant's `dmNotes`) from Frontstage queries — not just hidden
in the UI.

## Testing seam

Per the PRD, the load-bearing guarantees (realtime sync, backend-enforced
DM-only withholding, manual-override-authoritative, confirm-to-commit) are
proven at the Convex query/mutation level against an in-memory backend
(`convex-tests/games.test.ts`, `convex-tests/combatants.test.ts`). Pure
rules-calc (`convex/colors.ts`) is unit-tested. The UI is thin and backed by
one smoke test (`src/components/FrontstageView.test.tsx`).

## License

Copyright (C) 2026 Gurumi-glitch.

Code: [AGPL-3.0](./LICENSE) — self-host it, change it, run it for your table.
If you run a *modified* version as a service others use, publish your source.

Bundled game content is third-party and keeps its own terms: this project
includes material from the **System Reference Document 5.1** by Wizards of the
Coast, licensed [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/legalcode).
The AGPL adds nothing to it. Full notices, and what is *not* included, are in
[NOTICE.md](./NOTICE.md).

Unofficial fan tool; not affiliated with or endorsed by Wizards of the Coast.

## Design record

`docs/adr/` holds the architecture decision records — why cards are global, why
spawning an enemy copies rather than references, why the map system is barred
from combat resolution. They ship with the repo on purpose: they are the reason
the code is shaped the way it is.

## Deployments

Frontend deploys to Vercel, backend to Convex, with separate Production and
Preview environments so test branches never touch live game data. See
[DEPLOYMENT.md](./DEPLOYMENT.md) for the environment split and why it exists.

---

## 繁體中文

一套**免登入**、以連結分享的戰鬥工具,給玩第五版規則的桌遊團。DM 建立一個 **Game** 會拿到兩個
網址：秘密的 **DM URL**（Backstage）與可分享的 **Player URL**（Frontstage）。
所有人打開網址就看到同一份即時同步的戰鬥狀態。**DM 永遠說了算**——自動化只是
便利層，不是守門員：任何數值都能手改，任何結果都能強制覆寫。

介面內建**繁體中文／English 雙語**，首頁右上角可切換（偏好記在該裝置上）。

### 線上試玩

**[Live demo](https://war-table-toolkit-5e-demo.vercel.app)** — 免註冊。建個遊戲、開一張示範
角卡、打一場。demo 站的資料會**定期清空**：想留下角色，在角卡視窗按「⬇ 匯出」
存成 `.dndcard.json`，之後在任何部署用「⬆ 匯入」帶回來。

### 自架（約 15 分鐘）

Convex 與 Vercel 的免費額度足以支撐一桌每週跑的戰役。

1. **Fork 本 repo**，然後 `npm install`。
2. **`npx convex deploy`** — 會建立 Convex 專案並印出網址。
3. **在 Vercel 匯入專案**，把 `VITE_CONVEX_URL` 設成上一步的網址，部署。
4. 打開你的 Vercel 網址，按 **Create Game**，把 Player URL 發給團員。

`PLAYGROUND_MODE` **不用設**——預設就是自己桌的模式（角卡跨 game 共用、全部可
編輯、沒有 demo 橫幅）。只有要開放給陌生人的公開沙盒才需要打開它。

### 授權

Copyright (C) 2026 Gurumi-glitch。

程式碼採 [AGPL-3.0](./LICENSE) —— 自架、修改、給自己團用都沒問題;但若你把**改
過的版本**當服務提供給別人,要公開你的原始碼。隨附的遊戲資料含 **SRD 5.1**
(Wizards of the Coast,[CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/legalcode)),
AGPL 不對它附加任何限制。完整聲明與「哪些內容不在本 repo」見 [NOTICE.md](./NOTICE.md)。
非官方同好工具,與 Wizards of the Coast 無隸屬關係。

### 這個 repo 裡有什麼角色卡

只有四張 SRD 開放內容的示範卡（戰士／法師／牧師／盜賊，見 `convex/demoSeed.ts`），
就是「載入示範角卡」按鈕的來源。你自己團的角色卡活在你自己部署的資料庫裡，
不會進 repo。
