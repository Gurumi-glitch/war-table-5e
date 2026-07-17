# Pull Request Format Guide / PR 格式指南

A format guide for humans and agents writing PRs in this repo. Based on industry standards: **Conventional Commits** for titles, sectioned templates for bodies.
給人類與 agent 使用的 PR 格式指南。依據業界標準：標題採 **Conventional Commits**，內文採固定區塊模板。

---

## 1. PR Title / PR 標題

Format / 格式：

```
<type>(<scope>): <description>
```

- `type` — the kind of change (see table below) / 變更類型（見下表）
- `scope` — optional; the affected area, e.g. `battle`, `scene`, `enemy-db`, `convex` / 選填；受影響的模組
- `description` — imperative mood, lowercase start, no trailing period, ≤ 72 chars / 祈使句、小寫開頭、結尾不加句號、72 字元以內
- Breaking change: add `!` before the colon, e.g. `feat(api)!: ...` / 破壞性變更：冒號前加 `!`

| type         | When to use / 使用時機                                                 |
| ------------ | ---------------------------------------------------------------------- |
| `feat`     | New feature or capability / 新功能                                     |
| `fix`      | Bug fix / 修 bug                                                       |
| `refactor` | Code restructuring, no behavior change / 重構，行為不變                |
| `perf`     | Performance improvement / 效能改善                                     |
| `docs`     | Documentation only / 只改文件                                          |
| `test`     | Add or fix tests only / 只改測試                                       |
| `style`    | Formatting, whitespace, naming — no logic change / 格式排版，不動邏輯 |
| `chore`    | Deps, tooling, scripts, config / 依賴、工具、腳本、設定                |
| `ci`       | CI/CD pipeline changes / CI 流程                                       |
| `build`    | Build system or bundler changes / 建置系統                             |
| `revert`   | Reverts a previous commit/PR / 還原先前變更                            |

Examples / 範例：

```
feat(battle): sync per-game Battle/Batch drafts and reorder Confirm flow
fix(battle): stop Claim Dice button stretching across its row
refactor(confirm): extract adv/disadv resolution into diceHelpers
chore(deps): upgrade convex to 1.17
feat(api)!: rename combatant.color to combatant.tokenColor
```

Rules / 規則：

- One PR = one purpose. If the title needs "and" twice, split the PR.
  一個 PR 只做一件事。標題需要兩個「和」就該拆分。
- The title stands alone in changelogs and `git log` — it must make sense without the body.
  標題會單獨出現在 changelog 和 `git log`，必須不看內文也能懂。

---

## 2. PR Body — Universal Skeleton / PR 內文通用骨架

Every PR body uses these sections. Omit a section only if truly empty; write `N/A` rather than deleting it if unsure.
所有 PR 內文都用這些區塊。確定沒內容才省略；不確定就寫 `N/A`，不要直接刪掉。

```markdown
## Summary / 摘要
<!-- 1–3 sentences: what this PR does, in plain language. -->
<!-- 1–3 句話：這個 PR 做了什麼，用白話說。 -->

## Why / 動機
<!-- The problem or need. Link the issue: Closes #123 / Fixes #123 / Refs #123 -->
<!-- 問題或需求背景。連結 issue：Closes #123（會自動關閉）/ Refs #123（僅關聯） -->

## Changes / 變更內容
<!-- Bullet list of what changed, grouped by area. Mention key files for non-obvious changes. -->
<!-- 條列變更，依模組分組。不明顯的變更要點出關鍵檔案。 -->

## How to test / 測試方式
<!-- Commands run + results (e.g. `npm test` → 332/332 green), and manual steps to verify. -->
<!-- 執行過的指令與結果（如 `npm test` → 332/332 全綠），以及手動驗證步驟。 -->

## Screenshots / 截圖
<!-- Required for any UI change: before/after. Otherwise omit. -->
<!-- UI 變更必附：前後對照。無 UI 變更可省略。 -->

## Breaking changes / 破壞性變更
<!-- What breaks, who is affected, migration steps. Omit if none. -->
<!-- 什麼壞了、影響誰、如何遷移。沒有就省略。 -->

## Notes for reviewers / 給審查者的備註
<!-- Where to start reading, known trade-offs, follow-ups deferred to later PRs. Omit if none. -->
<!-- 建議從哪讀起、已知取捨、留待後續 PR 的事項。沒有就省略。 -->
```

---

## 3. Scenario Templates / 情境模板

Pick the one matching your `type`. These are the universal skeleton with scenario-specific prompts filled in.
依 `type` 選用。它們是通用骨架加上情境專屬的提示。

### 3.1 Feature / 新功能（`feat`）

```markdown
## Summary / 摘要
Adds <feature> so that <user benefit>.
新增〈功能〉，讓〈使用者得到的好處〉。

## Why / 動機
Closes #<issue>. <What users couldn't do before / 之前做不到什麼。>

## Changes / 變更內容
- Backend / 後端：<new tables, mutations, queries / 新增的資料表、mutation、query>
- Frontend / 前端：<new components, UI flow / 新元件、操作流程>
- <Config, docs updated alongside / 順帶更新的設定與文件>

## How to test / 測試方式
1. <Setup step / 前置步驟>
2. <Action / 操作>
3. Expected / 預期結果：<...>
- Automated / 自動化測試：<command + result / 指令與結果>

## Screenshots / 截圖
<before/after or new UI / 前後對照或新畫面>

## Notes for reviewers / 給審查者的備註
- Out of scope (follow-up) / 不在本次範圍（後續處理）：<...>
```

### 3.2 Bug Fix / 修復（`fix`）

```markdown
## Summary / 摘要
Fixes <symptom> caused by <root cause, one sentence>.
修正〈症狀〉，肇因於〈一句話講根因〉。

## Why / 動機
Fixes #<issue>.
- Symptom / 症狀：<what the user saw / 使用者看到什麼>
- Reproduction / 重現步驟：<steps>
- Root cause / 根因：<the actual defect, not just where it crashed / 真正的缺陷，不只是爆炸點>

## Changes / 變更內容
- <The minimal fix / 最小修正>
- <Regression test added / 新增的回歸測試>

## How to test / 測試方式
1. Follow the reproduction steps above — bug no longer occurs. / 照上述重現步驟操作，bug 不再發生。
2. <Nearby behavior still works / 周邊功能未被波及的驗證>
- Automated / 自動化測試：<command + result>

## Notes for reviewers / 給審查者的備註
- Why this approach over <alternative> / 為何不用〈替代方案〉：<...>
```

### 3.3 Change / Refactor / 調整與重構（`refactor`, `perf`, `style`, behavior tweaks）

For behavior-preserving restructuring, or deliberate small behavior changes that are neither a new feature nor a bug fix (use `feat`/`fix` if it is one).
用於不改行為的重構，或刻意的小幅行為調整（若其實是新功能或修 bug，請改用 `feat`/`fix`）。

```markdown
## Summary / 摘要
<What was restructured/changed and the one-line payoff.>
〈重構或調整了什麼，一句話說明好處。〉

## Why / 動機
<Pain point: duplication, perf, readability, prep for upcoming feature #N.>
〈痛點：重複、效能、可讀性、為後續功能 #N 鋪路。〉

## Changes / 變更內容
- Behavior change? / 行為是否改變：**No / 否**（或明確列出改變了什麼）
- <Moved/extracted/renamed what / 搬移、抽出、改名了什麼>

## How to test / 測試方式
- Existing tests pass unchanged / 既有測試不改而全過：<command + result>
- <For perf: before/after numbers / 效能類：前後數據>

## Notes for reviewers / 給審查者的備註
- <Suggested reading order for large diffs / 大 diff 的建議閱讀順序>
```

### 3.4 Docs / Chore / 文件與雜項（`docs`, `chore`, `ci`, `build`, `test`)

Short form is fine. / 可用精簡版。

```markdown
## Summary / 摘要
<What and why in 1–2 sentences. / 1–2 句講完做了什麼、為什麼。>

## Changes / 變更內容
- <...>

## How to test / 測試方式
<For deps/CI: build + test still green. For docs: N/A or preview link.>
〈依賴或 CI：建置與測試仍全綠。文件：N/A 或預覽連結。〉
```

For dependency upgrades, also note / 升級依賴請加註：breaking changes in the changelog of the upgraded package / 該套件 changelog 中的破壞性變更。

### 3.5 Revert / 還原（`revert`）

```markdown
## Summary / 摘要
Reverts #<PR> (<original title>).
還原 #<PR>（〈原標題〉）。

## Why / 動機
<What broke in production/table use. / 上線或實際使用時壞了什麼。>

## Notes for reviewers / 給審查者的備註
<Plan for re-landing the change, if any. / 之後重新上這個變更的計畫（如有）。>
```

---

## 4. Checklist Before Opening / 開 PR 前檢查清單

- [ ] Title follows `type(scope): description` / 標題符合格式
- [ ] One purpose per PR; unrelated changes split out / 一個 PR 一個目的，無關變更已拆出
- [ ] Linked issue with `Closes #N` / `Fixes #N` / `Refs #N` / 已連結 issue
- [ ] Tests pass locally; command + result recorded in body / 本地測試通過，指令與結果寫進內文
- [ ] UI changes have screenshots / UI 變更附截圖
- [ ] No secrets, debug code, or commented-out leftovers / 無密鑰、除錯碼、註解掉的殘留
- [ ] Breaking changes flagged with `!` and a Breaking changes section / 破壞性變更有 `!` 標記與專屬區塊
- [ ] Self-reviewed the diff before requesting review / 送審前自己先看過一遍 diff

---

## 5. General Principles / 通用原則

- **Small PRs review faster and better.** Aim for one reviewable sitting (~400 lines of meaningful diff or less). / **小 PR 審得又快又好**，目標是一次能看完（有效 diff 約 400 行內）。
- **Write for the reviewer who has zero context.** The body should answer "what / why / how verified" without opening the diff. / **假設審查者毫無背景**，內文要讓人不開 diff 就知道「做了什麼、為什麼、如何驗證」。
- **Why > What.** The diff already shows what changed; the body's main job is why. / **動機比內容重要**，diff 本身就會呈現改了什麼，內文的重點是為什麼。
- **Never leave "How to test" empty.** "Not tested" is acceptable information; silence is not. / **測試方式不可留白**，寫「未測試」也是有效資訊，留白不是。
- **Agent-generated PRs** in this repo end the body with the standard footer: / 本 repo 的 **agent 產生的 PR** 內文結尾加上標準頁腳：
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`

---

## Sources / 參考來源

- [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)
- [Enforcing conventional PR titles on GitHub — Satellytes](https://www.satellytes.com/blog/post/writing-and-enforcing-conventional-commit-messages-and-pull-request-titles/)
- [Pull Request Best Practices — Axolo](https://axolo.co/blog/p/pull-request-best-practices-how-to-create-great-pull-requests)
- [8 Essential Pull Request Best Practices — Sopa](https://www.heysopa.com/post/pull-request-best-practices)
- [PR templates — Microsoft Learn (Azure Repos)](https://learn.microsoft.com/en-us/azure/devops/repos/git/pull-request-templates?view=azure-devops)
- [How to Write Better PR Descriptions — gitrolysis](https://gitrolysis.com/posts/2026/01/how-to-write-better-pull-request-descriptions-templates-and-examples/)
