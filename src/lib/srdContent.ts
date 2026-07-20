/**
 * SRD 5.1 structured content for the character builder (character-builder).
 *
 * SHIP RULE (CLAUDE.md): this file carries ONLY SRD/open data. PHB-only
 * subraces/subclasses/backgrounds and homebrew are NOT here — they go through
 * the builder's "custom / homebrew free-fill" path, entered locally.
 *
 * Every mechanical value here was read from references/srd-5.1/ (races 01_,
 * classes 02_, backgrounds 03_) — not from memory. zh keys match dndCalc's
 * ABILITY_KEYS / SKILLS so the builder feeds the same downstream calc. Feature
 * text is deliberately BRIEF (name + one line): the engine consumes the
 * mechanical fields; full prose is the homebrew/refs path.
 */

import type { AbilityKey } from "./dndCalc";

export type Size = "小型" | "中型";
export type CasterType = "full" | "half" | "pact" | "none";

export type SrdRace = {
  id: string;
  nameZh: string;
  nameEn: string;
  /** Fixed racial ability score increases (zh key → amount). */
  asi: Partial<Record<AbilityKey, number>>;
  /** Free-choice ASIs on top (Half-Elf: two +1 of the player's choice). */
  asiChoice?: { count: number; amount: number };
  speedFt: number;
  size: Size;
  traits: string[];
  /** Languages every member speaks (zh, must match LANGUAGE_OPTIONS zh exactly). */
  languages: string[];
  /** Count of extra free-choice languages (Human/High Elf/Half-Elf: 1). */
  languageChoice?: number;
  /** Fixed skill proficiencies granted by the race (zh, match SKILLS). */
  skills?: string[];
  /** Free-choice skill count granted by the race (Half-Elf: 2). */
  skillChoice?: number;
  /** Fixed weapon proficiencies granted by the race (zh, match WEAPON_PROF_OPTIONS). */
  weaponProfs?: string[];
  /** Fixed tool proficiencies granted by the race (zh, match TOOL_PROF_OPTIONS). */
  toolProfs?: string[];
  /** Choose-N-of-list tool proficiency (Hill Dwarf: pick 1 of 3 artisan's tools). */
  toolChoice?: { count: number; from: string[] };
};

export type SrdSubclass = {
  id: string;
  nameZh: string;
  nameEn: string;
  /** Granted at 1st level? Only then does the builder auto-apply L1 features. */
  l1: boolean;
  l1FeatureText?: string;
  /** Bonus proficiencies granted at L1 (e.g. Life Domain → heavy armor). */
  bonusArmorProfs?: string[];
};

export type SrdClass = {
  id: string;
  nameZh: string;
  nameEn: string;
  /** Hit die max (feeds startingHpFor at L1). */
  hitDie: number;
  saveProfs: AbilityKey[];
  caster: CasterType;
  spellAbility?: AbilityKey;
  skillChoose: number;
  skillFrom: string[]; // zh skill keys (match dndCalc.SKILLS); [] = any
  armorProfs: string[];
  weaponProfs: string[];
  /** What this class calls its subclass ("神聖領域", "誓言"…). */
  subclassLabel: string;
  /** English name for that same "what this class calls its subclass" label. */
  subclassLabelEn: string;
  subclasses: SrdSubclass[]; // SRD ships exactly one
};

export type SrdBackground = {
  id: string;
  nameZh: string;
  nameEn: string;
  skills: string[]; // zh skill keys, granted
  languages: number; // count of free-choice languages
  toolProfs?: string[];
  equipmentText: string;
};

export type SrdArmor = {
  id: string;
  name: string;
  nameZh: string;
  cat: "light" | "medium" | "heavy" | "shield";
  base: number;
  dexBonus: boolean;
  maxBonus?: number;
  strMin?: number;
  stealthDis?: boolean;
};

/** SrdArmor.cat → zh key, for display via profLabel (armor cat isn't itself a
 *  proficiency term, but reads the same "輕甲/中甲/重甲/盾牌" vocabulary). */
export const ARMOR_CAT_ZH: Record<SrdArmor["cat"], string> = {
  light: "輕甲",
  medium: "中甲",
  heavy: "重甲",
  shield: "盾牌",
};

/** One dropdown-add option for the builder's proficiency pickers (profs step). */
export type ProfOption = { zh: string; en: string };

export const ARMOR_PROF_OPTIONS: ProfOption[] = [
  { zh: "輕甲", en: "Light armor" },
  { zh: "中甲", en: "Medium armor" },
  { zh: "重甲", en: "Heavy armor" },
  { zh: "盾牌", en: "Shields" },
];

export const WEAPON_PROF_OPTIONS: ProfOption[] = [
  { zh: "簡易武器", en: "Simple weapons" },
  { zh: "軍用武器", en: "Martial weapons" },
  // Simple melee
  { zh: "棍棒", en: "Club" },
  { zh: "匕首", en: "Dagger" },
  { zh: "巨棍棒", en: "Greatclub" },
  { zh: "手斧", en: "Handaxe" },
  { zh: "標槍", en: "Javelin" },
  { zh: "輕錘", en: "Light hammer" },
  { zh: "硬頭錘", en: "Mace" },
  { zh: "木杖", en: "Quarterstaff" },
  { zh: "鐮刀", en: "Sickle" },
  { zh: "長矛", en: "Spear" },
  // Simple ranged
  { zh: "輕弩", en: "Light crossbow" },
  { zh: "飛鏢", en: "Dart" },
  { zh: "短弓", en: "Shortbow" },
  { zh: "投石索", en: "Sling" },
  // Martial melee
  { zh: "戰斧", en: "Battleaxe" },
  { zh: "鏈枷", en: "Flail" },
  { zh: "長柄刀", en: "Glaive" },
  { zh: "巨斧", en: "Greataxe" },
  { zh: "巨劍", en: "Greatsword" },
  { zh: "戟", en: "Halberd" },
  { zh: "騎槍", en: "Lance" },
  { zh: "長劍", en: "Longsword" },
  { zh: "大錘", en: "Maul" },
  { zh: "釘頭錘", en: "Morningstar" },
  { zh: "長槍", en: "Pike" },
  { zh: "刺劍", en: "Rapier" },
  { zh: "彎刀", en: "Scimitar" },
  { zh: "短劍", en: "Shortsword" },
  { zh: "三叉戟", en: "Trident" },
  { zh: "戰鎬", en: "War pick" },
  { zh: "戰錘", en: "Warhammer" },
  { zh: "長鞭", en: "Whip" },
  // Martial ranged
  { zh: "吹箭筒", en: "Blowgun" },
  { zh: "手弩", en: "Hand crossbow" },
  { zh: "重弩", en: "Heavy crossbow" },
  { zh: "長弓", en: "Longbow" },
  { zh: "網", en: "Net" },
];

export const TOOL_PROF_OPTIONS: ProfOption[] = [
  // Artisan's tools
  { zh: "煉金術士用品", en: "Alchemist's supplies" },
  { zh: "釀酒師用品", en: "Brewer's supplies" },
  { zh: "書法家用品", en: "Calligrapher's supplies" },
  { zh: "木匠工具", en: "Carpenter's tools" },
  { zh: "製圖師工具", en: "Cartographer's tools" },
  { zh: "製鞋匠工具", en: "Cobbler's tools" },
  { zh: "廚師用具", en: "Cook's utensils" },
  { zh: "吹玻璃工工具", en: "Glassblower's tools" },
  { zh: "珠寶匠工具", en: "Jeweler's tools" },
  { zh: "皮革匠工具", en: "Leatherworker's tools" },
  { zh: "石匠工具", en: "Mason's tools" },
  { zh: "畫家用品", en: "Painter's supplies" },
  { zh: "陶匠工具", en: "Potter's tools" },
  { zh: "鐵匠工具", en: "Smith's tools" },
  { zh: "修補匠工具", en: "Tinker's tools" },
  { zh: "織工工具", en: "Weaver's tools" },
  { zh: "木雕師工具", en: "Woodcarver's tools" },
  // Kits
  { zh: "易容組", en: "Disguise kit" },
  { zh: "偽造工具組", en: "Forgery kit" },
  { zh: "骰子組", en: "Dice set" },
  { zh: "紙牌組", en: "Playing card set" },
  { zh: "草藥組", en: "Herbalism kit" },
  // Musical instruments
  { zh: "風笛", en: "Bagpipes" },
  { zh: "鼓", en: "Drum" },
  { zh: "揚琴", en: "Dulcimer" },
  { zh: "長笛", en: "Flute" },
  { zh: "魯特琴", en: "Lute" },
  { zh: "里拉琴", en: "Lyre" },
  { zh: "號角", en: "Horn" },
  { zh: "排笛", en: "Pan flute" },
  { zh: "蕭姆管", en: "Shawm" },
  { zh: "維奧爾琴", en: "Viol" },
  // Other
  { zh: "領航員工具", en: "Navigator's tools" },
  { zh: "下毒者工具組", en: "Poisoner's kit" },
  { zh: "盜賊工具", en: "Thieves' tools" },
  { zh: "載具（陸上）", en: "Vehicles (land)" },
  { zh: "載具（水上）", en: "Vehicles (water)" },
];

export const LANGUAGE_OPTIONS: ProfOption[] = [
  // Standard
  { zh: "通用語", en: "Common" },
  { zh: "矮人語", en: "Dwarvish" },
  { zh: "精靈語", en: "Elvish" },
  { zh: "巨人語", en: "Giant" },
  { zh: "侏儒語", en: "Gnomish" },
  { zh: "哥布林語", en: "Goblin" },
  { zh: "半身人語", en: "Halfling" },
  { zh: "獸人語", en: "Orc" },
  // Exotic
  { zh: "深淵語", en: "Abyssal" },
  { zh: "天界語", en: "Celestial" },
  { zh: "龍語", en: "Draconic" },
  { zh: "幽邃語", en: "Deep Speech" },
  { zh: "煉獄語", en: "Infernal" },
  { zh: "始源語", en: "Primordial" },
  { zh: "妖精語", en: "Sylvan" },
  { zh: "地底通用語", en: "Undercommon" },
];

// --- Races (SRD 01_Races): 9, one SRD subrace baked into each ---

export const SRD_RACES: SrdRace[] = [
  { id: "dragonborn", nameZh: "龍裔", nameEn: "Dragonborn", asi: { 力量: 2, 魅力: 1 }, speedFt: 30, size: "中型", traits: ["龍息", "傷害抗性"], languages: ["通用語", "龍語"] },
  { id: "hill-dwarf", nameZh: "丘陵矮人", nameEn: "Hill Dwarf", asi: { 體質: 2, 感知: 1 }, speedFt: 25, size: "中型", traits: ["黑暗視覺", "矮人韌性", "矮人戰鬥訓練", "石之狡詐", "重甲不減速", "丘陵矮人堅韌（每級 +1 HP）"], languages: ["通用語", "矮人語"], weaponProfs: ["戰斧", "手斧", "輕錘", "戰錘"], toolChoice: { count: 1, from: ["鐵匠工具", "釀酒師用品", "石匠工具"] } },
  { id: "high-elf", nameZh: "高等精靈", nameEn: "High Elf", asi: { 敏捷: 2, 智力: 1 }, speedFt: 30, size: "中型", traits: ["黑暗視覺", "精類血統（魅惑優勢、免疫魔法沉睡）", "敏銳感官（察覺熟練）", "法術戲法（1 個法師戲法）", "額外語言"], languages: ["通用語", "精靈語"], languageChoice: 1, skills: ["察覺"], weaponProfs: ["長劍", "短劍", "短弓", "長弓"] },
  { id: "rock-gnome", nameZh: "岩石侏儒", nameEn: "Rock Gnome", asi: { 智力: 2, 體質: 1 }, speedFt: 25, size: "小型", traits: ["黑暗視覺", "侏儒狡詐（對抗魔法的智/感/魅豁免優勢）", "工匠巧手"], languages: ["通用語", "侏儒語"], toolProfs: ["修補匠工具"] },
  { id: "half-elf", nameZh: "半精靈", nameEn: "Half-Elf", asi: { 魅力: 2 }, asiChoice: { count: 2, amount: 1 }, speedFt: 30, size: "中型", traits: ["黑暗視覺", "精類血統", "技能多才（2 項技能熟練）"], languages: ["通用語", "精靈語"], languageChoice: 1, skillChoice: 2 },
  { id: "half-orc", nameZh: "半獸人", nameEn: "Half-Orc", asi: { 力量: 2, 體質: 1 }, speedFt: 30, size: "中型", traits: ["黑暗視覺", "威嚇熟練", "頑強耐力", "野蠻攻擊"], languages: ["通用語", "獸人語"], skills: ["威嚇"] },
  { id: "lightfoot-halfling", nameZh: "輕足半身人", nameEn: "Lightfoot Halfling", asi: { 敏捷: 2, 魅力: 1 }, speedFt: 25, size: "小型", traits: ["幸運", "勇敢", "半身人靈巧", "天生潛行"], languages: ["通用語", "半身人語"] },
  { id: "human", nameZh: "人類", nameEn: "Human", asi: { 力量: 1, 敏捷: 1, 體質: 1, 智力: 1, 感知: 1, 魅力: 1 }, speedFt: 30, size: "中型", traits: ["額外語言"], languages: ["通用語"], languageChoice: 1 },
  { id: "tiefling", nameZh: "提夫林", nameEn: "Tiefling", asi: { 智力: 1, 魅力: 2 }, speedFt: 30, size: "中型", traits: ["黑暗視覺", "地獄抗性（火焰抗性）", "地獄血脈（戲法：法焰術等）"], languages: ["通用語", "煉獄語"] },
];

// --- Classes (SRD 02_Classes): 12, each with its single SRD subclass ---

const ANY_SKILLS: string[] = []; // Bard "choose any"

export const SRD_CLASSES: SrdClass[] = [
  { id: "barbarian", nameZh: "野蠻人", nameEn: "Barbarian", hitDie: 12, saveProfs: ["力量", "體質"], caster: "none", skillChoose: 2, skillFrom: ["馴獸", "運動", "威嚇", "自然", "察覺", "求生"], armorProfs: ["輕甲", "中甲", "盾牌"], weaponProfs: ["簡易武器", "軍用武器"], subclassLabel: "始源之道", subclassLabelEn: "Primal Path", subclasses: [{ id: "berserker", nameZh: "狂戰士之道", nameEn: "Path of the Berserker", l1: false }] },
  { id: "bard", nameZh: "吟遊詩人", nameEn: "Bard", hitDie: 8, saveProfs: ["敏捷", "魅力"], caster: "full", spellAbility: "魅力", skillChoose: 3, skillFrom: ANY_SKILLS, armorProfs: ["輕甲"], weaponProfs: ["簡易武器", "手弩", "長劍", "刺劍", "短劍"], subclassLabel: "詩人學院", subclassLabelEn: "Bard College", subclasses: [{ id: "college-of-lore", nameZh: "知識學院", nameEn: "College of Lore", l1: false }] },
  { id: "cleric", nameZh: "牧師", nameEn: "Cleric", hitDie: 8, saveProfs: ["感知", "魅力"], caster: "full", spellAbility: "感知", skillChoose: 2, skillFrom: ["歷史", "洞悉", "醫藥", "說服", "宗教"], armorProfs: ["輕甲", "中甲", "盾牌"], weaponProfs: ["簡易武器"], subclassLabel: "神聖領域", subclassLabelEn: "Divine Domain", subclasses: [{ id: "life-domain", nameZh: "生命領域", nameEn: "Life Domain", l1: true, bonusArmorProfs: ["重甲"], l1FeatureText: "領域法術（祝福、療傷術）；生命門徒：以 1 環或更高法術回復生命時，額外回復 2 + 法術環階 點生命值。" }] },
  { id: "druid", nameZh: "德魯伊", nameEn: "Druid", hitDie: 8, saveProfs: ["智力", "感知"], caster: "full", spellAbility: "感知", skillChoose: 2, skillFrom: ["奧秘", "馴獸", "洞悉", "醫藥", "自然", "察覺", "宗教", "求生"], armorProfs: ["輕甲", "中甲", "盾牌"], weaponProfs: ["棍棒", "匕首", "飛鏢", "標槍", "硬頭錘", "木杖", "彎刀", "鐮刀", "投石索", "長矛"], subclassLabel: "德魯伊結社", subclassLabelEn: "Druid Circle", subclasses: [{ id: "circle-of-the-land", nameZh: "土地結社", nameEn: "Circle of the Land", l1: false }] },
  { id: "fighter", nameZh: "戰士", nameEn: "Fighter", hitDie: 10, saveProfs: ["力量", "體質"], caster: "none", skillChoose: 2, skillFrom: ["特技", "馴獸", "運動", "歷史", "洞悉", "威嚇", "察覺", "求生"], armorProfs: ["輕甲", "中甲", "重甲", "盾牌"], weaponProfs: ["簡易武器", "軍用武器"], subclassLabel: "戰鬥原型", subclassLabelEn: "Martial Archetype", subclasses: [{ id: "champion", nameZh: "鬥士", nameEn: "Champion", l1: false }] },
  { id: "monk", nameZh: "武僧", nameEn: "Monk", hitDie: 8, saveProfs: ["力量", "敏捷"], caster: "none", skillChoose: 2, skillFrom: ["特技", "運動", "歷史", "洞悉", "宗教", "隱匿"], armorProfs: [], weaponProfs: ["簡易武器", "短劍"], subclassLabel: "武道傳承", subclassLabelEn: "Monastic Tradition", subclasses: [{ id: "open-hand", nameZh: "空明拳之道", nameEn: "Way of the Open Hand", l1: false }] },
  { id: "paladin", nameZh: "聖騎士", nameEn: "Paladin", hitDie: 10, saveProfs: ["感知", "魅力"], caster: "half", spellAbility: "魅力", skillChoose: 2, skillFrom: ["運動", "洞悉", "威嚇", "醫藥", "說服", "宗教"], armorProfs: ["輕甲", "中甲", "重甲", "盾牌"], weaponProfs: ["簡易武器", "軍用武器"], subclassLabel: "神聖誓言", subclassLabelEn: "Sacred Oath", subclasses: [{ id: "oath-of-devotion", nameZh: "奉獻之誓", nameEn: "Oath of Devotion", l1: false }] },
  { id: "ranger", nameZh: "遊俠", nameEn: "Ranger", hitDie: 10, saveProfs: ["力量", "敏捷"], caster: "half", spellAbility: "感知", skillChoose: 3, skillFrom: ["馴獸", "運動", "洞悉", "調查", "自然", "察覺", "隱匿", "求生"], armorProfs: ["輕甲", "中甲", "盾牌"], weaponProfs: ["簡易武器", "軍用武器"], subclassLabel: "遊俠原型", subclassLabelEn: "Ranger Archetype", subclasses: [{ id: "hunter", nameZh: "狩獵者", nameEn: "Hunter", l1: false }] },
  { id: "rogue", nameZh: "盜賊", nameEn: "Rogue", hitDie: 8, saveProfs: ["敏捷", "智力"], caster: "none", skillChoose: 4, skillFrom: ["特技", "運動", "欺瞞", "洞悉", "威嚇", "調查", "察覺", "表演", "說服", "巧手", "隱匿"], armorProfs: ["輕甲"], weaponProfs: ["簡易武器", "手弩", "長劍", "刺劍", "短劍"], subclassLabel: "盜賊原型", subclassLabelEn: "Roguish Archetype", subclasses: [{ id: "thief", nameZh: "神偷", nameEn: "Thief", l1: false }] },
  { id: "sorcerer", nameZh: "術士", nameEn: "Sorcerer", hitDie: 6, saveProfs: ["體質", "魅力"], caster: "full", spellAbility: "魅力", skillChoose: 2, skillFrom: ["奧秘", "欺瞞", "洞悉", "威嚇", "說服", "宗教"], armorProfs: [], weaponProfs: ["匕首", "飛鏢", "投石索", "木杖", "輕弩"], subclassLabel: "術源", subclassLabelEn: "Sorcerous Origin", subclasses: [{ id: "draconic-bloodline", nameZh: "龍族血脈", nameEn: "Draconic Bloodline", l1: true, l1FeatureText: "龍族祖先；龍族韌性：生命值上限每術士等級 +1（1 級即 +1），未著甲時 AC = 13 + 敏捷。" }] },
  { id: "warlock", nameZh: "契術士", nameEn: "Warlock", hitDie: 8, saveProfs: ["感知", "魅力"], caster: "pact", spellAbility: "魅力", skillChoose: 2, skillFrom: ["奧秘", "欺瞞", "歷史", "威嚇", "調查", "自然", "宗教"], armorProfs: ["輕甲"], weaponProfs: ["簡易武器"], subclassLabel: "異界宗主", subclassLabelEn: "Otherworldly Patron", subclasses: [{ id: "the-fiend", nameZh: "魔鬼", nameEn: "The Fiend", l1: true, l1FeatureText: "擴展法術列表；黑暗祝福：使敵人生命值歸零時，獲得 魅力調整值 + 契術士等級 點臨時生命值。" }] },
  { id: "wizard", nameZh: "法師", nameEn: "Wizard", hitDie: 6, saveProfs: ["智力", "感知"], caster: "full", spellAbility: "智力", skillChoose: 2, skillFrom: ["奧秘", "歷史", "洞悉", "調查", "醫藥", "宗教"], armorProfs: [], weaponProfs: ["匕首", "飛鏢", "投石索", "木杖", "輕弩"], subclassLabel: "秘法傳統", subclassLabelEn: "Arcane Tradition", subclasses: [{ id: "evocation", nameZh: "塑能學派", nameEn: "School of Evocation", l1: false }] },
];

// --- Backgrounds (SRD 03_Characterization): SRD ships Acolyte only ---

export const SRD_BACKGROUNDS: SrdBackground[] = [
  { id: "acolyte", nameZh: "侍僧", nameEn: "Acolyte", skills: ["洞悉", "宗教"], languages: 2, equipmentText: "聖徽、祈禱書或祈禱輪、5 根香、法衣、一套平民服裝、裝有 15 gp 的錢包" },
];

// --- Armor (extracted from seed/5e-SRD-Equipment.json — not re-transcribed) ---

export const SRD_ARMORS: SrdArmor[] = [
  { id: "padded-armor", name: "Padded Armor", nameZh: "軟墊甲", cat: "light", base: 11, dexBonus: true, stealthDis: true },
  { id: "leather-armor", name: "Leather Armor", nameZh: "皮甲", cat: "light", base: 11, dexBonus: true },
  { id: "studded-leather-armor", name: "Studded Leather Armor", nameZh: "鑲釘皮甲", cat: "light", base: 12, dexBonus: true },
  { id: "hide-armor", name: "Hide Armor", nameZh: "獸皮甲", cat: "medium", base: 12, dexBonus: true, maxBonus: 2 },
  { id: "chain-shirt", name: "Chain Shirt", nameZh: "鏈甲衫", cat: "medium", base: 13, dexBonus: true, maxBonus: 2 },
  { id: "scale-mail", name: "Scale Mail", nameZh: "鱗甲", cat: "medium", base: 14, dexBonus: true, maxBonus: 2, stealthDis: true },
  { id: "breastplate", name: "Breastplate", nameZh: "胸甲", cat: "medium", base: 14, dexBonus: true, maxBonus: 2 },
  { id: "half-plate-armor", name: "Half Plate Armor", nameZh: "半身板甲", cat: "medium", base: 15, dexBonus: true, maxBonus: 2, stealthDis: true },
  { id: "ring-mail", name: "Ring Mail", nameZh: "環甲", cat: "heavy", base: 14, dexBonus: false, stealthDis: true },
  { id: "chain-mail", name: "Chain Mail", nameZh: "鏈甲", cat: "heavy", base: 16, dexBonus: false, strMin: 13, stealthDis: true },
  { id: "splint-armor", name: "Splint Armor", nameZh: "板條甲", cat: "heavy", base: 17, dexBonus: false, strMin: 15, stealthDis: true },
  { id: "plate-armor", name: "Plate Armor", nameZh: "全身板甲", cat: "heavy", base: 18, dexBonus: false, strMin: 15, stealthDis: true },
  { id: "shield", name: "Shield", nameZh: "盾牌", cat: "shield", base: 2, dexBonus: false },
];
