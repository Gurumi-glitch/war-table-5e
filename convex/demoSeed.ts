import type { SeedCharacter } from "./characters";

/**
 * The public demo's four sample characters (prep-public-release / design D6):
 * a Fighter, a Wizard, a Cleric, and a Rogue at level 3, built from SRD 5.1
 * open content (CC-BY-4.0, Wizards of the Coast). They exist so a visitor who
 * opens the demo has something to fight with in the first ten seconds, instead
 * of an empty table and a character sheet to fill in.
 *
 * Hand-written rather than generated. The `gen:characters` pipeline resolves
 * spells by joining against a PHB spell CSV, and the PHB is NOT open content —
 * running these through it would mean shipping copyrighted text in a public
 * repo. Four cards are also small enough that a generator would be more code
 * than the data (design D6 assumed the pipeline; the copyright boundary is why
 * this deviates).
 *
 * Kept in its own module, separate from any private table's seed: this file is
 * the ONLY character data the public repo ships, which is a property that is
 * easy to keep true when it's a whole file and easy to lose when it's a
 * section of one.
 *
 * Numbers follow SRD 5.1: `pb` 2 at level 3, saves/skills computed as ability
 * mod (+ PB where proficient). `resourceKey` names a seed resource, resolved
 * to a real id at insert time.
 */

/** Build the six ability rows in display order from raw scores. */
function abilities(
  str: number,
  dex: number,
  con: number,
  int: number,
  wis: number,
  cha: number,
): { key: string; score: number; mod: number }[] {
  const mod = (score: number) => Math.floor((score - 10) / 2);
  return [
    { key: "力量", score: str, mod: mod(str) },
    { key: "敏捷", score: dex, mod: mod(dex) },
    { key: "體質", score: con, mod: mod(con) },
    { key: "智力", score: int, mod: mod(int) },
    { key: "感知", score: wis, mod: mod(wis) },
    { key: "魅力", score: cha, mod: mod(cha) },
  ];
}

/** Save rows for the six abilities; `prof` names the two proficient ones. */
function saves(
  rows: { key: string; score: number; mod: number }[],
  pb: number,
  prof: string[],
): { key: string; prof: boolean; total: number }[] {
  return rows.map((a) => ({
    key: a.key,
    prof: prof.includes(a.key),
    total: a.mod + (prof.includes(a.key) ? pb : 0),
  }));
}

/**
 * Only the proficient skills — the card fills the rest of the 18-skill
 * template from the dndCalc defaults on first open, so listing them here would
 * be 14 rows of noise per card.
 */
function skills(
  rows: { key: string; score: number; mod: number }[],
  pb: number,
  proficient: { key: string; ability: string }[],
): { key: string; ability: string; prof: "proficient"; total: number }[] {
  const modOf = (ability: string) =>
    rows.find((a) => a.key === ability)?.mod ?? 0;
  return proficient.map((s) => ({
    key: s.key,
    ability: s.ability,
    prof: "proficient" as const,
    total: modOf(s.ability) + pb,
  }));
}

const fighterAbilities = abilities(16, 13, 15, 10, 12, 8);
const wizardAbilities = abilities(8, 14, 13, 16, 12, 10);
const clericAbilities = abilities(13, 10, 14, 10, 16, 12);
const rogueAbilities = abilities(10, 16, 13, 12, 14, 11);

export const DEMO_SEED: readonly SeedCharacter[] = [
  {
    seedKey: "demo_fighter",
    fields: {
      player: "Demo",
      nameZh: "示範戰士",
      nameEn: "Sample Fighter",
      race: "人類",
      classesText: "戰士：冠軍 (3)",
      level: 3,
      alignment: "守序善良",
      statusText: "正常",
      hp: 28,
      maxHp: 28,
      ac: 18,
      acFormula: "鏈甲 16 + 盾牌 2",
      speedText: "30呎",
      initBonus: 1,
      pb: 2,
      abilities: fighterAbilities,
      spellcastingAbility: "",
      spellAttack: 0,
      spellDc: 0,
      attackText: "長劍 +5（1d8+3 揮砍）· 重弩 +3（1d10+1 穿刺）",
      saves: saves(fighterAbilities, 2, ["力量", "體質"]),
      skills: skills(fighterAbilities, 2, [
        { key: "運動", ability: "力量" },
        { key: "察覺", ability: "感知" },
      ]),
      toolsText: "所有護甲、盾牌、簡易與軍用武器",
      goldText: "10 金幣",
      refs: [
        {
          title: "動作激發（每短休一次）",
          body: "以一個**額外動作**，立刻再取得一個動作。\n\n（示範用途：Resources 面板的「動作激發」池就是這個——按 Confirm 時可以順手扣掉。）",
        },
        {
          title: "第二風（每短休一次）",
          body: "以一個**額外動作**回復 `1d10 + 戰士等級` 生命值。\n\n（示範用途：一個 automatic + healing 的 recipe，連結到自己的資源池。）",
        },
        {
          title: "戰鬥風格：防禦",
          body: "穿著護甲時 AC +1（已計入上方的 18）。",
        },
      ],
      classRules: [
        "冠軍 3 級：**強化重擊**——攻擊骰 19 或 20 都算重擊。示範時可以在 Confirm 面板直接用 DM 強制結果覆蓋。",
      ],
      story:
        "示範用角色卡（SRD 5.1 開放內容）。想改成自己的角色：按「⬇ 匯出」存成檔案，再用角卡選單的「⬆ 匯入」帶回來，那張就完全歸你編輯。",
    },
    resources: [
      { key: "second_wind", label: "第二風", current: 1, max: 1 },
      { key: "action_surge", label: "動作激發", current: 1, max: 1 },
    ],
    recipes: [
      {
        name: "長劍",
        hitType: "attack",
        attackMod: 5,
        damageDice: [{ type: "d8", count: 1 }],
        damageMod: 3,
        damageType: "slashing",
        dc: 0,
        saveAbility: "",
        critImmune: false,
        resourceCost: 0,
        multiTarget: "none",
        appliesMods: [],
      },
      {
        name: "重弩",
        hitType: "attack",
        attackMod: 3,
        damageDice: [{ type: "d10", count: 1 }],
        damageMod: 1,
        damageType: "piercing",
        dc: 0,
        saveAbility: "",
        critImmune: false,
        resourceCost: 0,
        multiTarget: "none",
        appliesMods: [],
      },
      {
        name: "第二風",
        hitType: "automatic",
        attackMod: 0,
        damageDice: [{ type: "d10", count: 1 }],
        damageMod: 3,
        damageType: "healing",
        dc: 0,
        saveAbility: "",
        critImmune: true,
        resourceKey: "second_wind",
        resourceCost: 1,
        multiTarget: "none",
        appliesMods: [],
      },
    ],
  },
  {
    seedKey: "demo_wizard",
    fields: {
      player: "Demo",
      nameZh: "示範法師",
      nameEn: "Sample Wizard",
      race: "高等精靈",
      classesText: "法師：塑能學派 (3)",
      level: 3,
      alignment: "中立善良",
      statusText: "正常",
      hp: 17,
      maxHp: 17,
      ac: 12,
      acFormula: "10 + 敏捷 2",
      speedText: "30呎",
      initBonus: 2,
      pb: 2,
      abilities: wizardAbilities,
      spellcastingAbility: "智力",
      spellAttack: 5,
      spellDc: 13,
      attackText: "法術攻擊 +5 · 法術 DC 13 · 木杖 +0（1d6−1 鈍擊）",
      saves: saves(wizardAbilities, 2, ["智力", "感知"]),
      skills: skills(wizardAbilities, 2, [
        { key: "奧秘", ability: "智力" },
        { key: "調查", ability: "智力" },
      ]),
      toolsText: "匕首、法杖、輕弩",
      goldText: "8 金幣",
      refs: [
        {
          title: "法術位",
          body: "1 環 ×4、2 環 ×2（見 Resources 面板）。\n\n施法時在 Confirm 面板勾選要消耗的法術位——扣除是手動的，DM 永遠說了算。",
        },
        {
          title: "戲法（不消耗法術位）",
          body: "**火焰箭**：法術攻擊 +5，命中造成 `1d10` 火焰傷害。\n\n**魔法飛彈**（1 環）：自動命中，三發各 `1d4+1` 力場傷害。",
        },
        {
          title: "奧術復元（每長休一次）",
          body: "短休時回復總環數不超過 2 的法術位。示範時直接在 Resources 面板把數字改回去就好。",
        },
      ],
      classRules: [
        "塑能學派 2 級：**塑能雕琢**——法術影響範圍內，可讓 `智力調整值` 個目標的成功豁免免受傷害（示範時用 Confirm 的 DM 強制結果）。",
      ],
      story:
        "示範用角色卡（SRD 5.1 開放內容）。想改成自己的角色：按「⬇ 匯出」存成檔案，再用角卡選單的「⬆ 匯入」帶回來，那張就完全歸你編輯。",
    },
    resources: [
      { key: "slots_1", label: "1 環法術位", current: 4, max: 4 },
      { key: "slots_2", label: "2 環法術位", current: 2, max: 2 },
    ],
    recipes: [
      {
        name: "火焰箭",
        hitType: "attack",
        attackMod: 5,
        damageDice: [{ type: "d10", count: 1 }],
        damageMod: 0,
        damageType: "fire",
        dc: 0,
        saveAbility: "",
        critImmune: false,
        resourceCost: 0,
        multiTarget: "none",
        appliesMods: [],
      },
      {
        name: "魔法飛彈",
        hitType: "automatic",
        attackMod: 0,
        // PER DART, not the volley: Confirm multiplies by the dart count the
        // caster assigns (combatLog: `dartValues.length * damageMod`), so three
        // darts resolve as 3d4+3. Baking the whole volley in here instead would
        // total the same on one target while making the darts unsplittable —
        // and splitting them across targets is the entire spell.
        damageDice: [{ type: "d4", count: 1 }],
        damageMod: 1,
        damageType: "force",
        dc: 0,
        saveAbility: "",
        // Magic Missile always hits and never crits (SRD).
        critImmune: true,
        resourceKey: "slots_1",
        resourceCost: 1,
        multiTarget: "darts",
        appliesMods: [],
      },
      {
        name: "燃燒之手",
        hitType: "save",
        attackMod: 0,
        damageDice: [{ type: "d6", count: 3 }],
        damageMod: 0,
        damageType: "fire",
        dc: 13,
        saveAbility: "dex",
        critImmune: true,
        resourceKey: "slots_1",
        resourceCost: 1,
        multiTarget: "aoe",
        appliesMods: [],
      },
      {
        name: "護盾術",
        hitType: "automatic",
        attackMod: 0,
        damageDice: [],
        damageMod: 0,
        damageType: "",
        dc: 0,
        saveAbility: "",
        critImmune: true,
        resourceKey: "slots_1",
        resourceCost: 1,
        multiTarget: "none",
        // A reaction buff: +5 AC until the start of the caster's next turn.
        // Toggling the chip off reverts it (issue #5 model), which is the
        // demo's one-click showcase of the modifier system.
        appliesMods: [
          {
            stat: "ac",
            mode: "bonus",
            value: 5,
            direction: "self",
            note: "護盾術：持續到下回合開始",
          },
        ],
      },
    ],
  },
  {
    seedKey: "demo_cleric",
    fields: {
      player: "Demo",
      nameZh: "示範牧師",
      nameEn: "Sample Cleric",
      race: "山矮人",
      classesText: "牧師：生命領域 (3)",
      level: 3,
      alignment: "守序善良",
      statusText: "正常",
      hp: 24,
      maxHp: 24,
      ac: 18,
      acFormula: "鏈甲 16 + 盾牌 2",
      speedText: "25呎",
      initBonus: 0,
      pb: 2,
      abilities: clericAbilities,
      spellcastingAbility: "感知",
      spellAttack: 5,
      spellDc: 13,
      attackText: "戰鎚 +3（1d8+1 鈍擊）· 法術攻擊 +5 · 法術 DC 13",
      saves: saves(clericAbilities, 2, ["感知", "魅力"]),
      skills: skills(clericAbilities, 2, [
        { key: "醫療", ability: "感知" },
        { key: "宗教", ability: "智力" },
      ]),
      toolsText: "中型護甲、盾牌、簡易武器",
      goldText: "15 金幣",
      refs: [
        {
          title: "生命領域：門徒之生",
          body: "以法術回復生命值時，額外回復 `2 + 法術環數`。\n\n（示範用途：Confirm 面板的手動調整值就是為這種規則留的——引擎不猜，你填。）",
        },
        {
          title: "引導神力（每短休一次）",
          body: "**保命神術**：一個動作，觸碰一個生物回復 `牧師等級 × 5` 生命值。",
        },
        {
          title: "法術位",
          body: "1 環 ×4、2 環 ×2（見 Resources 面板）。",
        },
      ],
      classRules: [
        "3 級可以驅散不死：DC 13 感知豁免，失敗則被驅散 1 分鐘。示範時用 Conditions 面板的「恐懼」加上手動註記。",
      ],
      story:
        "示範用角色卡（SRD 5.1 開放內容）。想改成自己的角色：按「⬇ 匯出」存成檔案，再用角卡選單的「⬆ 匯入」帶回來，那張就完全歸你編輯。",
    },
    resources: [
      { key: "slots_1", label: "1 環法術位", current: 4, max: 4 },
      { key: "slots_2", label: "2 環法術位", current: 2, max: 2 },
      { key: "channel_divinity", label: "引導神力", current: 1, max: 1 },
    ],
    recipes: [
      {
        name: "戰鎚",
        hitType: "attack",
        attackMod: 3,
        damageDice: [{ type: "d8", count: 1 }],
        damageMod: 1,
        damageType: "bludgeoning",
        dc: 0,
        saveAbility: "",
        critImmune: false,
        resourceCost: 0,
        multiTarget: "none",
        appliesMods: [],
      },
      {
        name: "神聖之火",
        hitType: "save",
        attackMod: 0,
        damageDice: [{ type: "d8", count: 1 }],
        damageMod: 0,
        damageType: "radiant",
        dc: 13,
        saveAbility: "dex",
        critImmune: true,
        resourceCost: 0,
        multiTarget: "none",
        appliesMods: [],
      },
      {
        name: "治療真言",
        hitType: "automatic",
        attackMod: 0,
        damageDice: [{ type: "d8", count: 1 }],
        // 感知 +3, plus 門徒之生 (2 + 1 環) = +3 → +6 total.
        damageMod: 6,
        damageType: "healing",
        dc: 0,
        saveAbility: "",
        critImmune: true,
        resourceKey: "slots_1",
        resourceCost: 1,
        multiTarget: "none",
        appliesMods: [],
      },
      {
        name: "保命神術",
        hitType: "automatic",
        attackMod: 0,
        damageDice: [],
        damageMod: 15,
        damageType: "healing",
        dc: 0,
        saveAbility: "",
        critImmune: true,
        resourceKey: "channel_divinity",
        resourceCost: 1,
        multiTarget: "none",
        appliesMods: [],
      },
    ],
  },
  {
    seedKey: "demo_rogue",
    fields: {
      player: "Demo",
      nameZh: "示範盜賊",
      nameEn: "Sample Rogue",
      race: "輕靈半身人",
      classesText: "盜賊：盜匪 (3)",
      level: 3,
      alignment: "混亂中立",
      statusText: "正常",
      hp: 21,
      maxHp: 21,
      ac: 14,
      acFormula: "皮甲 11 + 敏捷 3",
      speedText: "25呎",
      initBonus: 3,
      pb: 2,
      abilities: rogueAbilities,
      spellcastingAbility: "",
      spellAttack: 0,
      spellDc: 0,
      attackText: "短劍 +5（1d6+3 穿刺，靈巧）· 短弓 +5（1d6+3 穿刺）",
      saves: saves(rogueAbilities, 2, ["敏捷", "智力"]),
      skills: skills(rogueAbilities, 2, [
        { key: "隱匿", ability: "敏捷" },
        { key: "巧手", ability: "敏捷" },
        { key: "察覺", ability: "感知" },
        { key: "欺瞞", ability: "魅力" },
      ]),
      toolsText: "盜賊工具、輕型護甲、手弩、長劍、細劍、短劍",
      goldText: "20 金幣",
      refs: [
        {
          title: "偷襲（每回合一次）",
          body: "對有優勢、或目標身邊有你的盟友時，額外造成 `2d6` 傷害。\n\n（示範用途：Confirm 面板的「額外擲骰」——加一組自己的骰子與傷害類型，掛在同一次命中上。）",
        },
        {
          title: "狡詐動作",
          body: "每回合可用**額外動作**衝刺、撤離或躲藏。躲藏成功 → 下次攻擊有優勢。",
        },
        {
          title: "盜匪：快手",
          body: "狡詐動作還可以用來使用盜賊工具解除陷阱／開鎖，或做一次巧手檢定。",
        },
      ],
      classRules: [
        "半身人的**幸運**：攻擊骰、屬性檢定或豁免擲出 1 時可以重擲一次。示範時用骰子板的「重擲」按鈕。",
      ],
      story:
        "示範用角色卡（SRD 5.1 開放內容）。想改成自己的角色：按「⬇ 匯出」存成檔案，再用角卡選單的「⬆ 匯入」帶回來，那張就完全歸你編輯。",
    },
    resources: [],
    recipes: [
      {
        name: "短劍",
        hitType: "attack",
        attackMod: 5,
        damageDice: [{ type: "d6", count: 1 }],
        damageMod: 3,
        damageType: "piercing",
        dc: 0,
        saveAbility: "",
        critImmune: false,
        resourceCost: 0,
        multiTarget: "none",
        appliesMods: [],
      },
      {
        name: "短弓",
        hitType: "attack",
        attackMod: 5,
        damageDice: [{ type: "d6", count: 1 }],
        damageMod: 3,
        damageType: "piercing",
        dc: 0,
        saveAbility: "",
        critImmune: false,
        resourceCost: 0,
        multiTarget: "none",
        appliesMods: [],
      },
      {
        name: "短劍 + 偷襲",
        hitType: "attack",
        attackMod: 5,
        // 1d6 weapon + 2d6 sneak attack, rolled together: the demo's simplest
        // showing of "the recipe is a shortcut, the rules stay on the card".
        damageDice: [{ type: "d6", count: 3 }],
        damageMod: 3,
        damageType: "piercing",
        dc: 0,
        saveAbility: "",
        critImmune: false,
        resourceCost: 0,
        multiTarget: "none",
        appliesMods: [],
      },
    ],
  },
];
