# 測試計畫 — Confirm Engine 攻擊結算與優勢/劣勢規則

| | |
|---|---|
| 受測系統 | War Table 5e 的 Confirm engine（`convex/rules.ts`、`convex/combatLog.ts`、`convex/modifiers.ts`）＋ War Table UI（battle block 燈號、Claim、Preview） |
| 文件目的 | 將戰鬥結算規則拆解為可驗證的測試案例，並對照既有自動化測試，標示哪些行為已有自動化覆蓋、哪些仍需手動 E2E 驗證 |
| 規則來源 | ADR-0002（手動覆寫優先）、ADR-0003（優劣勢 actor/target 分離）、ADR-0007（Dice Board→Claim→Confirm 流程）、ADR-0008（conditions/modifiers 引擎） |
| 維護方式 | 領域專家（DM）審核每一條案例的步驟與預期結果；新增規則時先補需求編號，再掛測試案例 |

## 測試方法備註：決定性測試資料

骰子是隨機的，隨機就無法驗證。本計畫的手動案例一律利用 **DM 手動編輯骰值** 功能（「手動覆寫永遠優先」的產品原則）把 claim 的骰子設成已知數值，讓正確結果變成唯一解。

慣例：驗證「取高/取低」時使用 **15 與 3、對 AC 10 的目標**——取對了命中、取錯了落空，且刻意避開 20 與 1（大成功/大失敗有自己的規則，由 TC-CRIT／TC-FUM 系列獨立驗證，不與取值規則混在同一案例）。

---

## 需求清單（Requirements）

| 編號 | 規則 | 來源 |
|---|---|---|
| **R1** | 攻擊分三型：① **命中骰型**（攻擊者 d20+加值 vs 目標 AC，目標不骰骰子）② **豁免型**（目標 d20+豁免加值 vs 攻擊者 DC）③ **自動命中型**（不骰 d20） | 戰鬥流程規則、`rules.ts` |
| **R2** | 優勢/劣勢有**兩個獨立來源**：攻擊者自身狀態（actor-side，`attack`）與目標狀態（target-side，`attackAgainst`／豁免型為 `save`）。兩側以 `combineAdv` 合併；**優勢＋劣勢＝中和，不論各有幾個來源**（5e 規則）。目標列燈亮＝「攻擊此人時有優/劣勢」，不是「此人骰優/劣勢」 | ADR-0003 |
| **R2a** | 命中骰型的多目標攻擊是**同一次揮擊**（universal swing）：攻擊者只 claim **一組** d20（合併後有優/劣勢時共 2 顆），同一組骰值對**每個目標各自的 AC** 分別判定命中；不是每個目標各骰一次。豁免型相反：**每個目標 claim 自己的豁免 d20**（該目標豁免有優/劣勢時為 2 顆） | `combatLog.ts`（same swing 註解）、DM 實測確認 |
| **R3** | 優勢/劣勢狀態下 claim **2 顆 d20**：優勢取**高**值、劣勢取**低**值；中性 claim 1 顆 | `rollD20WithAdvantage` |
| **R4** | 手動優劣勢覆寫（actor 的 `actorAdvOverride`、每目標的 `advOverride`）**只取代自己那一側**的成分，不取代合併後的淨值——一側的手動操作不得抹掉另一側的條件效果 | ADR-0003 |
| **R5** | 大成功/大失敗：nat 20 **必中**；**是否爆擊取決於該 recipe 有沒有勾選「不爆擊」**（`critImmune`——勾了則 nat 20 仍命中但傷害不加倍）。爆擊時**傷害骰加倍、加值不加倍**；nat 1 **必失**。優勢下任一顆 20 即爆擊；劣勢下需**兩顆都是 20** 才爆擊、任一顆 1 即大失敗 | `rules.ts`、recipe 設定 |
| **R6** | 豁免結算：`saveMode="damage"` 成功＝**半傷**、失敗＝全額；`saveMode="hitOrMiss"` 成功＝**完全未命中（0 傷）**。豁免**不會爆擊**。auto-fail 條件（如 Stunned 的 STR/DEX）即使骰出 nat 20 也判定失敗 | ADR-0003、`modifiers.ts` |
| **R7** | 自動命中型：不骰 d20、不爆擊，抗性/易傷/免疫（R/V/I）照常計算 | `rules.ts` |
| **R8** | DM 強制覆寫最大：`forceOutcome`（強制中/失/豁免成敗）與 `forceDamage` 蓋過引擎的一切計算 | ADR-0002 |
| **R9** | 條件（conditions）是可逆的標籤層：chip 一鍵套用、一鍵移除即回復，永不覆寫手動基礎值 | ADR-0008 |

---

## 測試案例總表

| 案例 | 驗證規則 | 對應自動化測試 | 手動 E2E | 審核 |
|---|---|---|---|---|
| TC-DIS-001 目標隱形→劣勢取低值 | R2, R3 | `rules.test.ts`「resolveAttack advantage takes the higher die; disadvantage the lower」＋`dice.helpers.test.ts`「disadvantage rolls 2 dice and takes the lower」 | ✅ 必要（燈號＋claim 數＋preview 是引擎測試蓋不到的 UI 接線） | ✅ DM 已審（本文件範本案例） |
| TC-ADV-002 目標目盲→優勢取高值 | R2, R3 | `combatLog.test.ts`「attacks against a Blinded target resolve with advantage (2 d20s, takes the higher)」 | ✅ 必要 | ✅ DM 已審（2026-07-12） |
| TC-ADV-003 攻擊者自身優勢：多目標＝同一次揮擊 | R2, R2a | `combatLog.test.ts`「actorAdvOverride drives the attack roll independent of any target override」 | ✅ 必要 | ✅ DM 已審（修正初稿的每目標各骰說法） |
| TC-NEU-004 優勢＋劣勢中和（不論來源數量） | R2, R3 | `recipes.test.ts`「attack advantage + attackAgainst disadvantage from different sources cancel to neutral (1 d20, not 2)」 | ✅ 必要 | 🐛 已審——B 組發現真實 bug（issue #31：issue #31） |
| TC-OVR-005 手動 override「none」取消條件優勢 | R4 | `combatLog.test.ts`「manual advOverride 'none' cancels a Blinded target's condition advantage (1 d20)」 | 建議 | ✅ DM 已審（2026-07-12） |
| TC-OVR-006 目標側覆寫不抹掉攻擊者側條件 | R4 | `combatLog.test.ts`「Case 1: a target-only advOverride no longer wipes the actor's own condition advantage」 | 建議 | ✅ DM 已審（2026-07-12） |
| TC-CRIT-007 nat 20 必中爆擊（骰加倍、加值不加倍） | R5 | `recipes.test.ts`「attack nat 20 crits: damage dice doubled, modifier not」＋`rules.test.ts`「resolveAttack: d20 + mod ≥ AC hits; nat 20 always hits + crits」 | 建議 | ✅ DM 已審（修正：爆擊與否依 recipe「不爆擊」設定） |
| TC-FUM-008 nat 1 必失 | R5 | `rules.test.ts`「nat 1 always misses; critImmune suppresses the crit (still hits on nat 20)」 | 建議 | ✅ DM 已審（2026-07-12） |
| TC-CRIT-009 劣勢需兩顆 20 才爆擊 | R5 | `rules.test.ts`「resolveAttack advantage crits if either die is 20; disadvantage crits only if both are 20」 | 選做 | ✅ DM 已審（補上未指定的 AC） |
| TC-SAVE-010 豁免 damage 模式：成功半傷/失敗全額 | R1, R6 | `recipes.test.ts`「save recipe: fail = full damage, success = half; target's claimed d20 is the save」 | ✅ 必要（誰 claim 骰、preview 顯示） | ✅ DM 已審（2026-07-12） |
| TC-SAVE-011 豁免 hitOrMiss 模式：成功＝0 傷 | R6 | `combatLog.test.ts`「Case 1 Extend: saveMode 'hitOrMiss' — a successful save means MISS, zero damage」 | ✅ 必要 | ✅ DM 已審（2026-07-12） |
| TC-SAVE-012 Stunned 自動失敗豁免（nat 20 也一樣） | R6 | `combatLog.test.ts`「Stunned target auto-fails its DEX save (full damage even on a nat 20)」 | 建議 | ✅ DM 已審（衍生 （issue #32：issue #32） |
| TC-AUTO-013 自動命中型：不骰 d20、不爆擊 | R1, R7 | `recipes.test.ts`「darts (Magic Missile): each claimed d4 = one dart (d4+1), split per target, no crit」＋`rules.test.ts`「resolveAutomatic: no d20, no crit; R/V/I applies」 | 建議 | ✅ DM 已審（衍生 （issue #33：issue #33） |
| TC-FORCE-014 DM 強制覆寫蓋過引擎 | R8 | `recipes.test.ts`「DM force overrides: force miss → no damage; forceDamage → exact」 | 建議 | ✅ DM 已審（2026-07-12） |

> **自動化 vs 手動的分工**：自動化測試驗證的是**引擎數學**（給定輸入→結算輸出）；手動 E2E 案例驗證的是**UI 接線**——燈號亮在對的列、claim 要求對的骰數、preview 預告與實際結算一致。兩者缺一不可：引擎全對但燈亮錯邊，玩家照樣會做出錯誤決策。

---

## 詳細測試案例

### TC-DIS-001　命中骰型攻擊：目標隱形 → 劣勢取低值

| 欄位 | 內容 |
|---|---|
| **受測規則** | R2＋R3 — 命中骰型攻擊中，目標帶有「對其攻擊有劣勢」的狀態時，攻擊者 claim 2 顆 d20，engine 取**低值**與目標 AC 比較 |
| **前置條件** | ① PC 擁有命中骰型動作（火焰箭）② 敵人 AC 10、身上掛「隱形」狀態 ③ DM 用手動編輯骰值，把兩顆 d20 設為 **15** 和 **3** |
| **操作步驟** | 1. 使用火焰箭，指定該敵人 → 2. 確認敵人列的劣勢燈亮起 → 3. 按 claim dice for recipe，claim 那兩顆 d20 → 4. 查看 preview → 5. 按 confirm |
| **預期結果** | ① 劣勢燈亮在**敵人列** ② claim 需要 **2 顆** d20 ③ engine 取 **3**（低值）→ 3 vs AC 10 → **未命中**，preview 預告 miss、傷害 0 ④ confirm 後敵人 HP **不變** |
| **備註** | 燈亮在敵人列＝「你攻擊這個人時有劣勢」（target-side 語義），不是敵人骰劣勢——命中骰型攻擊敵人根本不骰骰子（R1）。測試資料刻意避開 20/1（見 TC-CRIT／TC-FUM 系列）。手動改骰值＝決定性測試資料（見文件開頭方法備註）。 |

### TC-ADV-002　命中骰型攻擊：目標目盲 → 優勢取高值

| 欄位 | 內容 |
|---|---|
| **受測規則** | R2＋R3 — 目標帶有「對其攻擊有優勢」的狀態時，claim 2 顆 d20 取**高**值 |
| **前置條件** | PC 使用**火焰箭**；敵人 AC 10、掛「目盲」；兩顆 d20 手動設為 15 和 3 |
| **操作步驟** | 同 TC-DIS-001（火焰箭），條件換成目盲 |
| **預期結果** | 敵人列**優勢**燈亮；claim 2 顆；engine 取 **15** → 命中；preview 顯示命中與傷害；confirm 後依 preview 扣 HP |
| **備註** | 與 TC-DIS-001 成對——同一機制的兩個方向，兩條都過才能證明「取高/取低」不是寫死一邊 |

### TC-ADV-003　攻擊者自身優勢（actor-side）：多目標＝同一次揮擊

| 欄位 | 內容 |
|---|---|
| **受測規則** | R2＋R2a — actor-side 的優劣勢跟著攻擊者走，對每一個被指定的目標都生效；且多目標命中骰型攻擊只 claim **一組** d20（同一次揮擊套用到所有人） |
| **前置條件** | PC 自身掛「自己的攻擊有優勢」的自訂 modifier；使用**火焰箭**；兩個乾淨（無條件）的敵人，AC 皆 10；兩顆 d20 手動設 15 和 3 |
| **操作步驟** | 用火焰箭同時指定兩個敵人為目標 → 觀察 claim 要求 → claim → 看 preview → confirm |
| **預期結果** | ① claim 要求**總共 2 顆** d20（不是每個目標各 2 顆）② 兩個目標都以同一組骰值取**高**（15）對各自 AC 判定 → 都命中 ③ 燈號反映 actor 側成分 |
| **備註** | 對照 TC-DIS-001：target-side 只影響「攻擊那一個人」，actor-side 影響「我打誰都算」。「一組骰套用所有目標」是 DM 審核時指出、並經引擎碼證實的規則（`combatLog.ts`「universal multi-target — same swing」）——文件初稿誤寫成每目標各 2 顆，此案例即為防止再犯的回歸紀錄 |

### TC-NEU-004　優勢＋劣勢中和（不論來源數量）🐛

| 欄位 | 內容 |
|---|---|
| **受測規則** | R2 — 優勢與劣勢同時存在即中和，**不論各有幾個來源** |
| **前置條件** | 使用**火焰箭**。兩組資料：**A 組**＝PC 掛「自己的攻擊有優勢」、敵人掛「隱形」（1 優 1 劣）；**B 組**＝PC 掛「自己的攻擊有優勢」、**同一個**敵人同時掛「目盲」＋「隱形」（2 優 1 劣） |
| **操作步驟** | 各組分別指定該敵人，觀察 claim 要求與燈號 |
| **預期結果** | 兩組都應為**中和**：claim 只要求 1 顆 d20、無優無劣 |
| **實測結果（2026-07-12）** | A 組 ✅ 通過。**B 組 ❌ 失敗**：顯示為優勢——target 側內部先把目盲＋隱形抵銷成無，再與 actor 側優勢合併，遺失了「場上存在劣勢」的資訊。**已記錄為 （issue #31：issue #31）** |
| **備註** | 這條是最容易寫錯成「數量相減」的規則——5e 是「有優有劣即中和」，不是 2 優 1 劣＝1 優。本案例正是靠把這句話寫成可執行的測試資料（B 組）才抓到真實 bug 的：**文件驅動測試的直接戰果** |

### TC-OVR-005　手動 override「none」取消條件優勢

| 欄位 | 內容 |
|---|---|
| **受測規則** | R4 — 目標列的手動切換可以把條件計算出的優/劣勢改成中性 |
| **前置條件** | 使用**火焰箭**；敵人 AC 10、掛「目盲」（預設對其攻擊有優勢）；兩顆 d20 設 15 和 3 |
| **操作步驟** | 指定目標後，把該目標列的優劣勢切換手動改為「無」，claim、看 preview、confirm |
| **預期結果** | claim 變成 1 顆；結算不取高不取低 |
| **備註** | 驗證「手動覆寫永遠優先」（ADR-0002）在優劣勢層的落實 |

### TC-OVR-006　目標側覆寫不得抹掉攻擊者側條件

| 欄位 | 內容 |
|---|---|
| **受測規則** | R4 — 一側的手動覆寫只取代該側成分（歷史 bug：Case 1，舊設計會整組蓋掉） |
| **前置條件** | PC 中毒（actor-side 劣勢），使用**火焰箭**；敵人 AC 10；目標列被手動切過優劣勢 |
| **操作步驟** | 指定目標、動目標列的手動切換、claim、confirm |
| **預期結果** | 攻擊者的中毒劣勢**仍然參與**合併計算，不因目標側被手動操作而消失 |
| **備註** | 這是真實發生過、經兩輪 playtest 才定案的回歸案例（ADR-0003「Case 1」）——回歸測試的教科書範例 |

### TC-CRIT-007　nat 20：必中＋爆擊（傷害骰加倍、加值不加倍）

| 欄位 | 內容 |
|---|---|
| **受測規則** | R5 |
| **前置條件** | 使用**火焰箭**（1d10），且該 recipe **未勾選「不爆擊」**；敵人 AC 設成極高（例如 25，確保「非 nat 20 不可能中」）；d20 手動設 **20**；d10 手動設 **6**；攻擊/傷害加值以角色卡實際值代入（下例以傷害加值 +3 示範） |
| **操作步驟** | 指定目標、claim、看 preview、confirm |
| **預期結果** | 判定**命中**（無視 AC 25）；傷害＝骰面加倍＋加值一次 ＝ 6×2＋3 ＝ **15**（不是 (6+3)×2＝18） |
| **備註** | 「骰加倍、加值不加倍」是最常被寫錯的爆擊規則，預期值必須算到個位數。若 recipe 勾了「不爆擊」，預期改為：仍命中、傷害不加倍（6＋3＝9）——可作為本案例的第二組資料 |

### TC-FUM-008　nat 1：必失

| 欄位 | 內容 |
|---|---|
| **受測規則** | R5 |
| **前置條件** | 使用**火焰箭**；敵人 AC 設成極低（例如 1）；d20 設 **1**；攻擊加值高（確保 1+加值 ≥ AC，即「若非必失規則就會中」） |
| **操作步驟** | 指定目標、claim、confirm |
| **預期結果** | 判定**未命中**，傷害 0，HP 不變 |
| **備註** | 前置刻意構造「數學上會中、規則上必失」的狀態，否則測不出必失規則有沒有存在 |

### TC-CRIT-009　劣勢下需兩顆 20 才爆擊

| 欄位 | 內容 |
|---|---|
| **受測規則** | R5 — 優勢任一顆 20 即爆；劣勢**兩顆都要 20** |
| **前置條件** | 使用**火焰箭**（recipe 未勾「不爆擊」）；敵人 **AC 10**、掛「隱形」（造成劣勢）；兩顆 d20 分別測（20, 15）與（20, 20）兩組 |
| **操作步驟** | 各組 claim、confirm，比較結果 |
| **預期結果** | （20, 15）→ 取 15，15 vs AC 10 → **命中但不爆擊**；（20, 20）→ 命中且**爆擊** |
| **備註** | 一個案例、兩組資料——同一規則的邊界兩側都要踩到 |

### TC-SAVE-010　豁免型攻擊（damage 模式）：成功半傷、失敗全額

| 欄位 | 內容 |
|---|---|
| **受測規則** | R1＋R6 — 豁免型攻擊是**目標**骰 d20（對照 R1：命中骰型是攻擊者骰） |
| **前置條件** | PC 使用**火球術**（DEX 豁免，DC 已知例如 13）；目標豁免加值已知；目標的 d20 手動設一次 3（必失）、一次 18（必成） |
| **操作步驟** | 指定目標、選 saveMode＝damage、由**目標方** claim d20、看 preview、confirm |
| **預期結果** | 失敗組：全額傷害；成功組：**減半**（向下取整）。preview 事先顯示成敗與對應傷害 |
| **備註** | 誰 claim 那顆 d20 是這型攻擊的靈魂——豁免骰屬於目標，UI 接線錯了會讓攻擊者替目標骰命 |

### TC-SAVE-011　豁免型攻擊（hitOrMiss 模式）：成功＝完全未命中

| 欄位 | 內容 |
|---|---|
| **受測規則** | R6 |
| **前置條件** | 同 TC-SAVE-010（火球術），saveMode 改選 hitOrMiss |
| **操作步驟** | 同上，跑成功組 |
| **預期結果** | 豁免成功＝**0 傷**（不是半傷），HP 不變 |
| **備註** | 與 TC-SAVE-010 成對，驗證兩種模式真的走不同結算 |

### TC-SAVE-012　Stunned 自動失敗豁免（nat 20 也一樣）

| 欄位 | 內容 |
|---|---|
| **受測規則** | R6 — auto-fail 條件蓋過骰值 |
| **前置條件** | 目標掛「震懾（Stunned）」；PC 使用**火球術**（DEX 豁免）；目標 d20 手動設 **20** |
| **操作步驟** | 指定目標、claim、confirm |
| **預期結果** | 豁免**失敗**、全額傷害——即使骰出 20 |
| **備註** | 又一個「構造矛盾狀態」的案例：數學上必成、規則上必敗，測的就是規則優先權。**衍生發現（2026-07-12）**：自訂條件的 mode 選 auto-fail 時，UI 沒有提供「哪些屬性 auto-fail」的選項——記錄為 （issue #32：issue #32） |

### TC-AUTO-013　自動命中型：不骰 d20、不爆擊

| 欄位 | 內容 |
|---|---|
| **受測規則** | R1＋R7 |
| **前置條件** | PC 使用**魔法飛彈**；目標 HP 已知 |
| **操作步驟** | 指定目標、claim（只有傷害骰，**不應要求 d20**）、confirm |
| **預期結果** | 無命中判定、無爆擊可能；傷害照骰面＋加值；R/V/I 照常套用 |
| **備註** | 驗證重點在「**不該出現的東西沒出現**」——claim 清單裡不該有 d20。**衍生發現（2026-07-12）**：魔法飛彈的自動命中疑似寫死、不跟隨 recipe 設定（改成豁免型後敵人仍無法骰豁免）——記錄為 （issue #33：issue #33） |

### TC-FORCE-014　DM 強制覆寫蓋過引擎

| 欄位 | 內容 |
|---|---|
| **受測規則** | R8 — DM 是最終權威，引擎永遠只是建議 |
| **前置條件** | 使用**火焰箭**構造一次數學上必中的攻擊（敵人 AC 1、d20 設 15） |
| **操作步驟** | confirm 前由 DM 設 force miss；另一組設 forceDamage 為特定數值 |
| **預期結果** | force miss → 0 傷、HP 不變（無視骰值）；forceDamage → 扣血**恰好**等於指定值 |
| **備註** | 這條驗證的是整個產品的第一原則：「手動覆寫永遠優先，DM 是權威、引擎不是守門員」 |

---

## 未覆蓋／已知限制（誠實揭露）

- **距離相關效果**（5 呎內自動爆擊、倒地對近戰/遠程的差異）在系統中是**備註提示**、不參與結算（設計如此，非缺陷）——不設測試案例。
- 自動化測試檔目前**不在 tsc 型別檢查範圍**（`tsconfig.json` 未涵蓋 `convex-tests/`），CI 的 typecheck 步驟保護不到測試檔本身。
- 手動 E2E 案例尚未自動化為瀏覽器測試（Playwright）；現階段由 DM 依本文件人工執行。
