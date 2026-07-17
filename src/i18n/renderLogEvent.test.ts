import { describe, expect, it } from "vitest";
import type { LogEvent } from "../../convex/combatLog";
import { locales } from "./registry";
import { renderLogEvent } from "./renderLogEvent";

const zh = locales["zh-TW"];
const en = locales["en"];

describe("renderLogEvent", () => {
  it("attack: adv + HIT + crit + typed damage, per locale", () => {
    const ev: LogEvent = {
      kind: "attack",
      recipeName: "Longsword",
      targets: [
        {
          name: "Goblin",
          adv: "advantage",
          hit: true,
          crit: true,
          damage: 15,
          damageType: "slashing",
        },
      ],
    };
    expect(renderLogEvent(ev, zh)).toBe("Longsword · Goblin: (adv) HIT (CRIT) 15 揮砍");
    expect(renderLogEvent(ev, en)).toBe("Longsword · Goblin: (adv) HIT (CRIT) 15 slashing");
  });

  it("attack: MISS with extras only on hit — extras absent stays clean", () => {
    const ev: LogEvent = {
      kind: "attack",
      recipeName: "Bite",
      targets: [{ name: "Hero", hit: false }],
    };
    expect(renderLogEvent(ev, zh)).toBe("Bite · Hero: MISS");
  });

  it("save: FAIL with auto-fail mark and healing extra; hitOrMiss success reads MISS", () => {
    const fail: LogEvent = {
      kind: "save",
      recipeName: "Fireball",
      dc: 15,
      saveAbility: "dex",
      targets: [
        {
          name: "Goblin",
          autoFail: true,
          saveSuccess: false,
          saveMode: "damage",
          damage: 24,
          damageType: "fire",
          extras: [{ label: "Rider", amount: 3, isHeal: true }],
        },
      ],
    };
    expect(renderLogEvent(fail, zh)).toBe(
      "Fireball · Goblin: (自動失敗) FAIL 24 火焰 [Rider +3治療]",
    );
    expect(renderLogEvent(fail, en)).toBe(
      "Fireball · Goblin: (auto-fail) FAIL 24 fire [Rider +3 heal]",
    );

    const negated: LogEvent = {
      kind: "save",
      recipeName: "雷鳴爆",
      targets: [
        { name: "Hero", saveSuccess: true, saveMode: "hitOrMiss", damageType: "thunder" },
      ],
    };
    expect(renderLogEvent(negated, zh)).toBe("雷鳴爆 · Hero: MISS 0 雷鳴");
  });

  it("heal / auto / darts kinds", () => {
    const heal: LogEvent = {
      kind: "heal",
      recipeName: "Cure",
      targets: [{ name: "Hero", heal: 7 }],
    };
    expect(renderLogEvent(heal, en)).toBe("Cure · Hero: +7");

    const auto: LogEvent = {
      kind: "auto",
      recipeName: "Cloud",
      targets: [{ name: "Goblin", damage: 7, damageType: "poison" }],
    };
    expect(renderLogEvent(auto, zh)).toBe("Cloud · Goblin: 7 毒素");

    const darts: LogEvent = {
      kind: "darts",
      recipeName: "Magic Missile",
      targets: [{ name: "Goblin", darts: 2, damage: 7, damageType: "force" }],
    };
    expect(renderLogEvent(darts, zh)).toBe("Magic Missile · Goblin: 2 鏢 → 7 力場");
    expect(renderLogEvent(darts, en)).toBe("Magic Missile · Goblin: 2 darts → 7 force");
  });

  it("manual: dice notation via summarizeRoll; DM-forced marks", () => {
    const manual: LogEvent = {
      kind: "manual",
      targets: [],
      claimedDice: [
        { type: "d20", value: 14 },
        { type: "d6", value: 4 },
        { type: "d6", value: 2 },
      ],
    };
    // Locale-neutral dice notation (same as the legacy rollSummary).
    const zhOut = renderLogEvent(manual, zh);
    expect(zhOut).toBe(renderLogEvent(manual, en));
    expect(zhOut).toContain("d20");
    expect(zhOut).toContain("14");

    const forced: LogEvent = {
      kind: "attack",
      recipeName: "Smite",
      targets: [{ name: "Goblin", hit: true, forced: true, damage: 4, damageType: "radiant" }],
    };
    expect(renderLogEvent(forced, zh)).toContain("(DM強制)");
    expect(renderLogEvent(forced, en)).toContain("(DM-forced)");
  });

  it("grants / heals / spent suffixes localize stat and mode names", () => {
    const ev: LogEvent = {
      kind: "attack",
      recipeName: "Bless Strike",
      targets: [{ name: "Goblin", hit: true, damage: 9, damageType: "slashing" }],
      grants: [{ to: "Goblin", mods: [{ mode: "bonus", stat: "ac", value: 2 }] }],
      heals: [{ amount: 5, tempHp: true, to: ["Hero"] }],
      spent: [{ label: "L1 法術位", amount: 2 }],
    };
    const zhOut = renderLogEvent(ev, zh);
    expect(zhOut).toContain("附加 +2 AC → Goblin");
    expect(zhOut).toContain("治療 +5臨時 → Hero");
    expect(zhOut).toContain("消耗 L1 法術位 ×2");
    const enOut = renderLogEvent(ev, en);
    expect(enOut).toContain("grants +2 AC → Goblin");
    expect(enOut).toContain("heals +5 temp → Hero");
    expect(enOut).toContain("spent L1 法術位 ×2");
  });

  it("reaction name rides the target name verbatim", () => {
    const ev: LogEvent = {
      kind: "attack",
      recipeName: "Bite",
      targets: [{ name: "Hero", reactionName: "Shield", hit: false }],
    };
    expect(renderLogEvent(ev, en)).toBe("Bite · Hero (Shield!): MISS");
  });
});
