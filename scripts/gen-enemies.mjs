/**
 * gen-enemies.mjs — regenerate convex/enemySeed.ts from the shipped seed data.
 *
 * Usage: npm run gen:enemies
 *
 * Sources (see seed/README.md):
 *  - seed/Original_Gothic_Horror_Bestiary.csv — 29 original gothic creatures
 *    with per-action JSON (kind/to_hit/damage/on_hit/save/dc/…), preserved
 *    losslessly (issue #6 acceptance criterion).
 *  - seed/5e-SRD-Monsters.json — 334 SRD 2014 monsters (open content). Their
 *    action blocks are also preserved as-is (name/desc/attack_bonus/damage[]);
 *    `enemies.spawn` reads both shapes.
 */
import { writeFileSync, readFileSync } from "node:fs";
import { readCsv, str } from "./csv-lib.mjs";

const BESTIARY_CSV = "seed/Original_Gothic_Horror_Bestiary.csv";
const SRD_JSON = "seed/5e-SRD-Monsters.json";
const OUT = "convex/enemySeed.ts";

/** en ability key → the zh key used across the app (characters.abilities). */
const ABILITY_ZH = {
  str: "力量",
  dex: "敏捷",
  con: "體質",
  int: "智力",
  wis: "感知",
  cha: "魅力",
};
const ABILITY_ORDER = ["str", "dex", "con", "int", "wis", "cha"];

function parseJsonCell(cell, what, key) {
  const raw = str(cell);
  if (raw === "") return [];
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`bad ${what} JSON on ${key}: ${e.message}`);
  }
}

function mapBestiary(r) {
  const key = str(r.profile_key);
  const speeds = [];
  if (Number(r.speed_walk_ft) > 0) speeds.push(`${Number(r.speed_walk_ft)}呎`);
  if (Number(r.speed_climb_ft) > 0) speeds.push(`攀爬${Number(r.speed_climb_ft)}呎`);
  if (Number(r.speed_fly_ft) > 0) speeds.push(`飛行${Number(r.speed_fly_ft)}呎`);
  if (Number(r.speed_swim_ft) > 0) speeds.push(`游泳${Number(r.speed_swim_ft)}呎`);
  const saveJson = parseJsonCell(r.save_bonuses_json || "{}", "save_bonuses", key);
  const skillsJson = parseJsonCell(r.skills_json || "{}", "skills", key);
  return {
    seedKey: key,
    source: "seed",
    nameZh: str(r.name_zh),
    nameEn: str(r.name_en),
    symbol: str(r.symbol_suggestion),
    role: str(r.role),
    themeTags: str(r.theme_tags),
    size: str(r.size),
    creatureType: str(r.creature_type),
    temperament: str(r.temperament),
    threatTier: Number(r.threat_tier) || 0,
    ac: Number(r.ac) || 10,
    hpMax: Number(r.hp_max) || 1,
    hpFormula: str(r.hp_formula),
    speedText: speeds.join("／"),
    abilities: ABILITY_ORDER.map((a) => ({
      key: ABILITY_ZH[a],
      score: Number(r[`${a}_score`]) || 10,
      mod: Number(r[`${a}_mod`]) || 0,
    })),
    saveBonuses: ABILITY_ORDER.filter((a) => saveJson[a] !== undefined).map(
      (a) => ({ key: ABILITY_ZH[a], bonus: Number(saveJson[a]) }),
    ),
    skills: Object.entries(skillsJson).map(([k, v]) => ({ key: k, bonus: Number(v) })),
    senses: str(r.senses),
    passivePerception: Number(r.passive_perception) || 0,
    languages: str(r.languages),
    damageResistances: str(r.damage_resistances),
    damageVulnerabilities: "",
    damageImmunities: str(r.damage_immunities),
    conditionImmunities: str(r.condition_immunities),
    traits: parseJsonCell(r.traits_json, "traits", key),
    actions: parseJsonCell(r.actions_json, "actions", key),
    bonusActions: parseJsonCell(r.bonus_actions_json, "bonus_actions", key),
    reactions: parseJsonCell(r.reactions_json, "reactions", key),
    legendaryActions: parseJsonCell(r.legendary_actions_json, "legendary_actions", key),
    tactics: str(r.tactics),
    encounterNotes: str(r.encounter_notes),
  };
}

const SRD_ABILITY = {
  str: "strength",
  dex: "dexterity",
  con: "constitution",
  int: "intelligence",
  wis: "wisdom",
  cha: "charisma",
};

/**
 * Traditional Chinese names for the 334 SRD monsters, keyed by their exact
 * English `name`. There is no official WotC Traditional Chinese 5e edition, so
 * these are the community-consensus names (matching the official Simplified
 * Chinese where one exists, converted to Traditional). The gothic bestiary
 * carries its own zh names in the CSV; only SRD entries need this overlay.
 * Any name absent here falls back to "" (leaving it English-only).
 */
const SRD_NAME_ZH = {
  "Aboleth": "阿伯雷斯",
  "Acolyte": "侍僧",
  "Adult Black Dragon": "成年黑龍",
  "Adult Blue Dragon": "成年藍龍",
  "Adult Brass Dragon": "成年黃銅龍",
  "Adult Bronze Dragon": "成年青銅龍",
  "Adult Copper Dragon": "成年紅銅龍",
  "Adult Gold Dragon": "成年金龍",
  "Adult Green Dragon": "成年綠龍",
  "Adult Red Dragon": "成年紅龍",
  "Adult Silver Dragon": "成年銀龍",
  "Adult White Dragon": "成年白龍",
  "Air Elemental": "氣元素",
  "Ancient Black Dragon": "遠古黑龍",
  "Ancient Blue Dragon": "遠古藍龍",
  "Ancient Brass Dragon": "遠古黃銅龍",
  "Ancient Bronze Dragon": "遠古青銅龍",
  "Ancient Copper Dragon": "遠古紅銅龍",
  "Ancient Gold Dragon": "遠古金龍",
  "Ancient Green Dragon": "遠古綠龍",
  "Ancient Red Dragon": "遠古紅龍",
  "Ancient Silver Dragon": "遠古銀龍",
  "Ancient White Dragon": "遠古白龍",
  "Androsphinx": "雄性斯芬克斯",
  "Animated Armor": "活化盔甲",
  "Ankheg": "安卡辛",
  "Ape": "猿",
  "Archmage": "大法師",
  "Assassin": "刺客",
  "Awakened Shrub": "覺醒灌木",
  "Awakened Tree": "覺醒樹",
  "Axe Beak": "斧喙鳥",
  "Azer": "阿茲爾",
  "Baboon": "狒狒",
  "Badger": "獾",
  "Balor": "巴洛炎魔",
  "Bandit": "盜賊",
  "Bandit Captain": "盜賊首領",
  "Barbed Devil": "棘刺魔鬼",
  "Basilisk": "石化蜥蜴",
  "Bat": "蝙蝠",
  "Bearded Devil": "髯鬚魔鬼",
  "Behir": "貝西爾",
  "Berserker": "狂戰士",
  "Black Bear": "黑熊",
  "Black Dragon Wyrmling": "幼黑龍",
  "Black Pudding": "黑布丁怪",
  "Blink Dog": "閃現犬",
  "Blood Hawk": "血隼",
  "Blue Dragon Wyrmling": "幼藍龍",
  "Boar": "野豬",
  "Bone Devil": "骸骨魔鬼",
  "Brass Dragon Wyrmling": "幼黃銅龍",
  "Bronze Dragon Wyrmling": "幼青銅龍",
  "Brown Bear": "棕熊",
  "Bugbear": "熊地精",
  "Bulette": "掘地獸",
  "Camel": "駱駝",
  "Cat": "貓",
  "Centaur": "半人馬",
  "Chain Devil": "鎖鏈魔鬼",
  "Chimera": "奇美拉",
  "Chuul": "楚爾",
  "Clay Golem": "黏土魔像",
  "Cloaker": "斗篷魔",
  "Cloud Giant": "雲巨人",
  "Cockatrice": "雞蛇獸",
  "Commoner": "平民",
  "Constrictor Snake": "蟒蛇",
  "Copper Dragon Wyrmling": "幼紅銅龍",
  "Couatl": "羽蛇",
  "Crab": "螃蟹",
  "Crocodile": "鱷魚",
  "Cult Fanatic": "邪教狂徒",
  "Cultist": "邪教徒",
  "Darkmantle": "黑暗斗篷",
  "Death Dog": "死亡犬",
  "Deep Gnome (Svirfneblin)": "深地諾姆",
  "Deer": "鹿",
  "Deva": "天神",
  "Dire Wolf": "恐狼",
  "Djinni": "迪精",
  "Doppelganger": "變形怪",
  "Draft Horse": "馱馬",
  "Dragon Turtle": "龍龜",
  "Dretch": "德雷奇",
  "Drider": "蜘蛛精",
  "Drow": "卓爾",
  "Druid": "德魯伊",
  "Dryad": "樹精",
  "Duergar": "灰矮人",
  "Dust Mephit": "塵魅怖",
  "Eagle": "鷹",
  "Earth Elemental": "土元素",
  "Efreeti": "火巨精",
  "Elephant": "大象",
  "Elk": "麋鹿",
  "Erinyes": "復仇魔女",
  "Ettercap": "蛛網妖",
  "Ettin": "雙頭巨人",
  "Fire Elemental": "火元素",
  "Fire Giant": "火巨人",
  "Flesh Golem": "血肉魔像",
  "Flying Snake": "飛蛇",
  "Flying Sword": "飛劍",
  "Frog": "青蛙",
  "Frost Giant": "霜巨人",
  "Gargoyle": "石像鬼",
  "Gelatinous Cube": "膠質立方體",
  "Ghast": "惡屍",
  "Ghost": "鬼魂",
  "Ghoul": "食屍鬼",
  "Giant Ape": "巨猿",
  "Giant Badger": "巨獾",
  "Giant Bat": "巨蝙蝠",
  "Giant Boar": "巨野豬",
  "Giant Centipede": "巨蜈蚣",
  "Giant Constrictor Snake": "巨蟒",
  "Giant Crab": "巨蟹",
  "Giant Crocodile": "巨鱷",
  "Giant Eagle": "巨鷹",
  "Giant Elk": "巨麋鹿",
  "Giant Fire Beetle": "巨火甲蟲",
  "Giant Frog": "巨蛙",
  "Giant Goat": "巨山羊",
  "Giant Hyena": "巨鬣狗",
  "Giant Lizard": "巨蜥",
  "Giant Octopus": "巨章魚",
  "Giant Owl": "巨梟",
  "Giant Poisonous Snake": "巨毒蛇",
  "Giant Rat": "巨鼠",
  "Giant Rat (Diseased)": "巨鼠（染病）",
  "Giant Scorpion": "巨蠍",
  "Giant Sea Horse": "巨海馬",
  "Giant Shark": "巨鯊",
  "Giant Spider": "巨蜘蛛",
  "Giant Toad": "巨蟾蜍",
  "Giant Vulture": "巨禿鷲",
  "Giant Wasp": "巨黃蜂",
  "Giant Weasel": "巨鼬",
  "Giant Wolf Spider": "巨狼蛛",
  "Gibbering Mouther": "囈語血口",
  "Glabrezu": "格拉布雷祖",
  "Gladiator": "角鬥士",
  "Gnoll": "豺狼人",
  "Goat": "山羊",
  "Goblin": "哥布林",
  "Gold Dragon Wyrmling": "幼金龍",
  "Gorgon": "戈爾貢鐵牛",
  "Gray Ooze": "灰泥怪",
  "Green Dragon Wyrmling": "幼綠龍",
  "Green Hag": "綠鬼婆",
  "Grick": "格里克",
  "Griffon": "獅鷲",
  "Grimlock": "盲鬥士",
  "Guard": "衛兵",
  "Guardian Naga": "守護那伽",
  "Gynosphinx": "雌性斯芬克斯",
  "Half-Red Dragon Veteran": "半紅龍老兵",
  "Harpy": "鷹身女妖",
  "Hawk": "隼",
  "Hell Hound": "地獄犬",
  "Hezrou": "赫茲魯",
  "Hill Giant": "丘陵巨人",
  "Hippogriff": "駿鷹",
  "Hobgoblin": "大地精",
  "Homunculus": "人造精怪",
  "Horned Devil": "角魔鬼",
  "Hunter Shark": "獵手鯊",
  "Hydra": "九頭蛇",
  "Hyena": "鬣狗",
  "Ice Devil": "冰魔鬼",
  "Ice Mephit": "冰魅怖",
  "Imp": "小惡魔",
  "Invisible Stalker": "隱形追蹤者",
  "Iron Golem": "鐵魔像",
  "Jackal": "胡狼",
  "Killer Whale": "虎鯨",
  "Knight": "騎士",
  "Kobold": "狗頭人",
  "Kraken": "克拉肯",
  "Lamia": "拉彌亞",
  "Lemure": "萊姆瑞",
  "Lich": "巫妖",
  "Lion": "獅",
  "Lizard": "蜥蜴",
  "Lizardfolk": "蜥蜴人",
  "Mage": "法師",
  "Magma Mephit": "岩漿魅怖",
  "Magmin": "岩漿人",
  "Mammoth": "猛獁象",
  "Manticore": "蠍尾獅",
  "Marilith": "瑪麗莉絲",
  "Mastiff": "獒犬",
  "Medusa": "美杜莎",
  "Merfolk": "人魚",
  "Merrow": "梅羅",
  "Mimic": "擬形怪",
  "Minotaur": "牛頭人",
  "Minotaur Skeleton": "牛頭人骷髏",
  "Mule": "騾",
  "Mummy": "木乃伊",
  "Mummy Lord": "木乃伊之王",
  "Nalfeshnee": "納夫希尼",
  "Night Hag": "夜鬼婆",
  "Nightmare": "夢魘馬",
  "Noble": "貴族",
  "Ochre Jelly": "赭黃凍怪",
  "Octopus": "章魚",
  "Ogre": "食人魔",
  "Ogre Zombie": "食人魔殭屍",
  "Oni": "鬼婆羅",
  "Orc": "獸人",
  "Otyugh": "污穢獸",
  "Owl": "貓頭鷹",
  "Owlbear": "梟熊",
  "Panther": "黑豹",
  "Pegasus": "飛馬",
  "Phase Spider": "相位蜘蛛",
  "Pit Fiend": "深坑惡魔",
  "Planetar": "主天使",
  "Plesiosaurus": "蛇頸龍",
  "Poisonous Snake": "毒蛇",
  "Polar Bear": "北極熊",
  "Pony": "矮種馬",
  "Priest": "祭司",
  "Pseudodragon": "偽龍",
  "Purple Worm": "紫蟲",
  "Quasit": "類魔",
  "Quipper": "咬魚",
  "Rakshasa": "羅剎",
  "Rat": "老鼠",
  "Raven": "渡鴉",
  "Red Dragon Wyrmling": "幼紅龍",
  "Reef Shark": "礁鯊",
  "Remorhaz": "極寒巨蟲",
  "Rhinoceros": "犀牛",
  "Riding Horse": "乘用馬",
  "Roc": "大鵬鳥",
  "Roper": "繩魔",
  "Rug of Smothering": "窒息魔毯",
  "Rust Monster": "鏽蝕怪",
  "Saber-Toothed Tiger": "劍齒虎",
  "Sahuagin": "薩華金",
  "Salamander": "火蜥蜴",
  "Satyr": "羊男",
  "Scorpion": "蠍子",
  "Scout": "斥候",
  "Sea Hag": "海鬼婆",
  "Sea Horse": "海馬",
  "Shadow": "陰影",
  "Shambling Mound": "蹣跚泥怪",
  "Shield Guardian": "護盾守衛",
  "Shrieker": "尖嘯菇",
  "Silver Dragon Wyrmling": "幼銀龍",
  "Skeleton": "骷髏",
  "Solar": "熾天使",
  "Specter": "幽靈",
  "Spider": "蜘蛛",
  "Spirit Naga": "靈那伽",
  "Sprite": "花精",
  "Spy": "間諜",
  "Steam Mephit": "蒸汽魅怖",
  "Stirge": "吸血蟲",
  "Stone Giant": "石巨人",
  "Stone Golem": "石魔像",
  "Storm Giant": "風暴巨人",
  "Succubus/Incubus": "魅魔／夢魔",
  "Swarm of Bats": "蝙蝠群",
  "Swarm of Beetles": "甲蟲群",
  "Swarm of Centipedes": "蜈蚣群",
  "Swarm of Insects": "蟲群",
  "Swarm of Poisonous Snakes": "毒蛇群",
  "Swarm of Quippers": "咬魚群",
  "Swarm of Rats": "鼠群",
  "Swarm of Ravens": "渡鴉群",
  "Swarm of Spiders": "蜘蛛群",
  "Swarm of Wasps": "黃蜂群",
  "Tarrasque": "塔拉斯克",
  "Thug": "暴徒",
  "Tiger": "老虎",
  "Treant": "樹人",
  "Tribal Warrior": "部落戰士",
  "Triceratops": "三角龍",
  "Troll": "巨魔",
  "Tyrannosaurus Rex": "暴龍",
  "Unicorn": "獨角獸",
  "Vampire, Vampire Form": "吸血鬼（本體形態）",
  "Vampire, Bat Form": "吸血鬼（蝙蝠形態）",
  "Vampire, Mist Form": "吸血鬼（霧形態）",
  "Vampire Spawn": "吸血鬼眷屬",
  "Veteran": "老兵",
  "Violet Fungus": "紫菌",
  "Vrock": "鷲魔",
  "Vulture": "禿鷲",
  "Warhorse": "戰馬",
  "Warhorse Skeleton": "戰馬骷髏",
  "Water Elemental": "水元素",
  "Weasel": "鼬",
  "Werebear, Bear Form": "熊化人（熊形態）",
  "Werebear, Human Form": "熊化人（人形態）",
  "Werebear, Hybrid Form": "熊化人（混合形態）",
  "Wereboar, Boar Form": "豬化人（豬形態）",
  "Wereboar, Human Form": "豬化人（人形態）",
  "Wereboar, Hybrid Form": "豬化人（混合形態）",
  "Wererat, Human Form": "鼠化人（人形態）",
  "Wererat, Hybrid Form": "鼠化人（混合形態）",
  "Wererat, Rat Form": "鼠化人（鼠形態）",
  "Weretiger, Human Form": "虎化人（人形態）",
  "Weretiger, Hybrid Form": "虎化人（混合形態）",
  "Weretiger, Tiger Form": "虎化人（虎形態）",
  "Werewolf, Human Form": "狼人（人形態）",
  "Werewolf, Hybrid Form": "狼人（混合形態）",
  "Werewolf, Wolf Form": "狼人（狼形態）",
  "White Dragon Wyrmling": "幼白龍",
  "Wight": "屍妖",
  "Will-o'-Wisp": "鬼火",
  "Winter Wolf": "冬狼",
  "Wolf": "狼",
  "Worg": "座狼",
  "Wraith": "怨靈",
  "Wyvern": "雙足飛龍",
  "Xorn": "索恩",
  "Young Black Dragon": "年輕黑龍",
  "Young Blue Dragon": "年輕藍龍",
  "Young Brass Dragon": "年輕黃銅龍",
  "Young Bronze Dragon": "年輕青銅龍",
  "Young Copper Dragon": "年輕紅銅龍",
  "Young Gold Dragon": "年輕金龍",
  "Young Green Dragon": "年輕綠龍",
  "Young Red Dragon": "年輕紅龍",
  "Young Silver Dragon": "年輕銀龍",
  "Young White Dragon": "年輕白龍",
  "Zombie": "殭屍",
};

function mapSrd(m) {
  const saveBonuses = [];
  const skills = [];
  for (const p of m.proficiencies ?? []) {
    const idx = p.proficiency?.index ?? "";
    if (idx.startsWith("saving-throw-")) {
      const en = idx.slice("saving-throw-".length);
      if (ABILITY_ZH[en]) saveBonuses.push({ key: ABILITY_ZH[en], bonus: p.value });
    } else if (idx.startsWith("skill-")) {
      skills.push({ key: idx.slice("skill-".length), bonus: p.value });
    }
  }
  const senses = Object.entries(m.senses ?? {})
    .filter(([k]) => k !== "passive_perception")
    .map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`)
    .join(", ");
  const joinNamed = (arr) => (arr ?? []).map((x) => (typeof x === "string" ? x : x.name)).join(", ");
  return {
    seedKey: `srd_${m.index}`,
    source: "srd",
    nameZh: SRD_NAME_ZH[m.name] ?? "",
    nameEn: m.name,
    symbol: "",
    role: "",
    themeTags: [m.type, m.subtype].filter(Boolean).join("|"),
    size: m.size ?? "",
    creatureType: m.type ?? "",
    temperament: m.alignment ?? "",
    threatTier: m.challenge_rating ?? 0,
    ac: m.armor_class?.[0]?.value ?? 10,
    hpMax: m.hit_points ?? 1,
    hpFormula: m.hit_points_roll ?? m.hit_dice ?? "",
    speedText: Object.entries(m.speed ?? {})
      .map(([k, v]) => `${k} ${v}`)
      .join(", "),
    abilities: ABILITY_ORDER.map((a) => {
      const score = m[SRD_ABILITY[a]] ?? 10;
      return { key: ABILITY_ZH[a], score, mod: Math.floor((score - 10) / 2) };
    }),
    saveBonuses,
    skills,
    senses,
    passivePerception: m.senses?.passive_perception ?? 0,
    languages: m.languages ?? "",
    damageResistances: joinNamed(m.damage_resistances),
    damageVulnerabilities: joinNamed(m.damage_vulnerabilities),
    damageImmunities: joinNamed(m.damage_immunities),
    conditionImmunities: joinNamed(m.condition_immunities),
    traits: m.special_abilities ?? [],
    actions: m.actions ?? [],
    bonusActions: [],
    reactions: m.reactions ?? [],
    legendaryActions: m.legendary_actions ?? [],
    tactics: "",
    encounterNotes: "",
  };
}

function main() {
  const bestiary = readCsv(BESTIARY_CSV).map(mapBestiary);
  const srd = JSON.parse(readFileSync(SRD_JSON, "utf8")).map(mapSrd);
  const seed = [...bestiary, ...srd];

  const banner = [
    "/**",
    " * AUTO-GENERATED by `npm run gen:enemies` (scripts/gen-enemies.mjs).",
    " * Source: seed/Original_Gothic_Horror_Bestiary.csv + seed/5e-SRD-Monsters.json",
    " *",
    " * The initial seed for the global `enemies` table (issue #6). Pure data —",
    " * no Convex runtime. Seeding (`enemies.seedAll`) is idempotent by `seedKey`;",
    " * after seeding, the in-app enemy DB is the source of truth (templates are",
    " * editable — DM authority, ADR-0002). Action blocks preserve each source's",
    " * original per-action JSON shape.",
    " *",
    ` * ${bestiary.length} gothic bestiary · ${srd.length} SRD monsters · ${seed.length} total.`,
    " */",
  ].join("\n");

  const body = `${banner}
import type { SeedEnemy } from "./enemies";

export const ENEMY_SEED: readonly SeedEnemy[] = ${JSON.stringify(seed, null, 2)};
`;
  writeFileSync(OUT, body, "utf8");
  console.log(
    `wrote ${OUT}: ${bestiary.length} bestiary + ${srd.length} SRD = ${seed.length} enemies.`,
  );
}

main();
