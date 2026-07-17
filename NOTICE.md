# Third-party content notices

The source code of this project is licensed under the GNU Affero General Public
License v3.0 (see [LICENSE](./LICENSE)). The game content bundled with it is not
all ours; this file records where it comes from.

**The AGPL applies to our code, never to the SRD material.** CC-BY-4.0 forbids
imposing downstream restrictions on the material it licenses, and this project
relies on exactly that freedom to use the SRD at all. SRD 5.1 content stays
CC-BY-4.0 in your hands as it is in ours — including for commercial use.

## System Reference Document 5.1

> This work includes material taken from the System Reference Document 5.1
> ("SRD 5.1") by Wizards of the Coast LLC and available at
> https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is
> licensed under the Creative Commons Attribution 4.0 International License
> available at https://creativecommons.org/licenses/by/4.0/legalcode.

SRD 5.1 material appears in:

| Where | What |
| ----- | ---- |
| `seed/5e-SRD-Monsters.json` | SRD 5.1 monster data (source file) |
| `seed/5e-SRD-Spells.json`, `seed/5e-SRD-Equipment.json` | SRD 5.1 spell and equipment data (source files) |
| `convex/enemySeed.ts` | 334 monster entries derived from the above (`source: "srd"`) |
| `convex/library.ts` | 319 spells + 37 weapons — mechanical metadata for the recipe picker. Full effect text is deliberately not reproduced. |
| `convex/demoSeed.ts` | 4 sample characters (fighter / wizard / cleric / rogue) built from SRD 5.1 |

The SRD data files were obtained via [5e-bits/5e-database](https://github.com/5e-bits/5e-database),
whose own compilation is offered under the MIT License:

> Copyright (c) 2024 5e-bits
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of
> this software and associated documentation files (the "Software"), to deal in the
> Software without restriction… The above copyright notice and this permission
> notice shall be included in all copies or substantial portions of the Software.
> (Full text: https://github.com/5e-bits/5e-database/blob/main/LICENSE.md)

## Original content

The following is original work by Gurumi-glitch (Copyright (C) 2026), and is covered
by the AGPL-3.0 along with the code:

| Where | What |
| ----- | ---- |
| `seed/Original_Gothic_Horror_Bestiary.csv` | An original gothic-horror bestiary |
| `convex/enemySeed.ts` | 29 entries derived from the above (`source: "seed"`) |
| `seed/zh-tw-names.json` | Our own zh-TW rendering of the SRD's English spell/weapon/school names, translated from the English entries — not taken from any published translation |

## Not included

Content from published Dungeons & Dragons books beyond the SRD — adventure
text, and any campaign material a table runs — is **not** in this repository.
A group running such a campaign enters that content into their own deployment,
which is theirs and stays theirs.

## Trademarks

Dungeons & Dragons and D&D are trademarks of Wizards of the Coast LLC. This
project is an unofficial, non-commercial fan tool. It is not affiliated with,
endorsed, sponsored, or approved by Wizards of the Coast.

---

## 繁體中文摘要

本專案的**程式碼**採 AGPL-3.0(見 [LICENSE](./LICENSE))。隨附的**遊戲資料**
不全是我們的:

- **程式碼採 AGPL-3.0**:任何人都能自架、修改、甚至收費營運——但**把改過的版本當網路服務提供給別人時,必須公開該版本的原始碼**。目的不是禁止商業,是防止有人把它拿走封閉起來。
- **SRD 5.1**(CC-BY-4.0,需標示出處)——334 隻怪物、319 個法術與 37 把武器的機制資料、4 張示範角色卡。上方英文
  區塊的聲明文字是 SRD 授權要求的格式,請勿刪改。
- **原創**——哥德恐怖敵人圖鑑 29 筆,以及 `seed/zh-tw-names.json`(我們自己從 SRD 英文名翻的繁中對照,非取自任何已出版譯本),與程式碼同樣採 AGPL-3.0。
- **未收錄**——SRD 以外的官方出版品內容、以及各團自己的戰役資料,都不在本 repo;
  跑戰役的人自行輸入到自己的部署裡,那是他們的東西。

「Dungeons & Dragons」與「D&D」是 Wizards of the Coast LLC 的商標。本專案為非官方、
非商業的同好工具,與 Wizards of the Coast 無任何隸屬或背書關係。
