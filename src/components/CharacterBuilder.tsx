import { useMemo, useState } from "react";
import { useT } from "../i18n";
import type { CharacterFields, ClassEntry } from "../../convex/characters";
import {
  ABILITY_KEYS,
  type AbilityKey,
  modFor,
  pbForLevel,
  defaultSaves,
  defaultSkills,
  recalcCard,
  startingHpFor,
  acFor,
  applyRacialAsi,
  spellSlotsL1For,
  STANDARD_ARRAY,
  POINT_BUY_BUDGET,
  pointBuyTotal,
  type AbilityRow,
} from "../lib/dndCalc";
import {
  SRD_RACES,
  SRD_CLASSES,
  SRD_BACKGROUNDS,
  SRD_ARMORS,
  type SrdClass,
} from "../lib/srdContent";

/**
 * Guided L1 character builder (character-builder). A linear 7-step wizard whose
 * every structured choice is "SRD dropdown (auto-derives) OR custom/homebrew
 * free-fill (no derivation, no warning)". On finish it assembles the same
 * text-first card the manual editor produces and hands it to `onCreate`; spell
 * PICKING is deferred to the card's existing recipe/library picker (which opens
 * right after), so this doesn't duplicate the 319-spell browser — the wizard
 * just guarantees the L1 slot pool exists.
 *
 * Scope (locked): L1 only, Standard mode only. Multiclass is recorded as rows;
 * cross-class slot/proficiency combination is left manual.
 */

export type BuilderResource = { label: string; current: number; max: number };
export type BuilderPayload = { fields: CharacterFields; resources: BuilderResource[] };

export type CharacterBuilderProps = {
  onCreate: (payload: BuilderPayload) => Promise<void>;
  onCancel: () => void;
};

type Method = "manual" | "array" | "pointbuy";
const STEPS = ["race", "class", "abilities", "background", "profs", "spells", "review"] as const;
type Step = (typeof STEPS)[number];

const emptyScores = (): Record<AbilityKey, number> =>
  Object.fromEntries(ABILITY_KEYS.map((k) => [k, 10])) as Record<AbilityKey, number>;

export function CharacterBuilder({ onCreate, onCancel }: CharacterBuilderProps) {
  const t = useT();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);

  // Identity
  const [nameZh, setNameZh] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [player, setPlayer] = useState("");

  // Race: an SRD id, or "" = custom (with a free-text label)
  const [raceId, setRaceId] = useState<string>(SRD_RACES[0].id);
  const [customRace, setCustomRace] = useState("");

  // Classes: structured rows. First row is the primary; multiclass adds rows.
  const [classes, setClasses] = useState<ClassEntry[]>([
    { classId: SRD_CLASSES[0].id, level: 1, active: true },
  ]);

  // Abilities
  const [method, setMethod] = useState<Method>("manual");
  const [baseScores, setBaseScores] = useState<Record<AbilityKey, number>>(emptyScores());

  // Background
  const [bgId, setBgId] = useState<string>(SRD_BACKGROUNDS[0].id);

  // Proficiencies (structured, seeded from class+bg, freely editable)
  const [armorProfs, setArmorProfs] = useState<string[]>([]);
  const [weaponProfs, setWeaponProfs] = useState<string[]>([]);
  const [toolProfs, setToolProfs] = useState<string[]>([]);
  const [languageProfs, setLanguageProfs] = useState<string[]>([]);
  const [profsSeeded, setProfsSeeded] = useState(false);

  // Skills chosen (zh keys), Armor for AC
  const [chosenSkills, setChosenSkills] = useState<string[]>([]);
  const [armorId, setArmorId] = useState<string>(""); // "" = unarmored
  const [shield, setShield] = useState(false);

  const race = SRD_RACES.find((r) => r.id === raceId);
  const primary = classes.find((c) => c.active) ?? classes[0];
  const primaryClass: SrdClass | undefined = SRD_CLASSES.find((c) => c.id === primary?.classId);

  // Final ability rows = base + racial ASI (SRD race only; custom race = no auto ASI).
  const finalAbilities: AbilityRow[] = useMemo(() => {
    const base = ABILITY_KEYS.map((k) => ({ key: k, score: baseScores[k], mod: modFor(baseScores[k]) }));
    return race ? applyRacialAsi(base, race.asi) : base;
  }, [baseScores, race]);
  const modOf = (k: AbilityKey) => finalAbilities.find((a) => a.key === k)!.mod;

  // AC preview
  const armor = SRD_ARMORS.find((a) => a.id === armorId);
  const ac = useMemo(
    () =>
      acFor({
        dexMod: modOf("敏捷"),
        armor: armor && armor.cat !== "shield" ? armor : null,
        shield: shield || armor?.cat === "shield",
        armorLabel: armor?.name,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [armorId, shield, finalAbilities],
  );

  // HP preview (primary class hit die)
  const hp = primaryClass ? startingHpFor(primaryClass.hitDie, modOf("體質")) : 8 + modOf("體質");

  // Seed proficiencies + skills-available from class + background once we reach that step.
  const seedProfs = () => {
    if (profsSeeded || !primaryClass) return;
    const bg = SRD_BACKGROUNDS.find((b) => b.id === bgId);
    const sub = primaryClass.subclasses[0];
    setArmorProfs([...primaryClass.armorProfs, ...(sub.l1 && sub.bonusArmorProfs ? sub.bonusArmorProfs : [])]);
    setWeaponProfs([...primaryClass.weaponProfs]);
    setToolProfs([]);
    setLanguageProfs([]);
    setProfsSeeded(true);
    if (bg) setChosenSkills((s) => Array.from(new Set([...s, ...bg.skills])));
  };

  const pointBudget = POINT_BUY_BUDGET - pointBuyTotal(ABILITY_KEYS.map((k) => baseScores[k]));

  const raceLabel = race ? `${race.nameZh}（${race.size}）` : customRace;
  const classesText = classes
    .map((c) => {
      const sc = SRD_CLASSES.find((x) => x.id === c.classId);
      const name = sc?.nameZh ?? c.classNameZh ?? c.classId;
      const sub = c.subclassNameZh ? `：${c.subclassNameZh}` : "";
      return `${name}${sub} (${c.level}${c.active ? "" : "，未啟用"})`;
    })
    .join("\n");

  const assemble = (): BuilderPayload => {
    const pb = pbForLevel(1);
    const mods = Object.fromEntries(finalAbilities.map((a) => [a.key, a.mod]));
    const saves = defaultSaves(mods, pb).map((s) => ({
      ...s,
      prof: primaryClass?.saveProfs.includes(s.key as AbilityKey) ?? false,
    }));
    const skills = defaultSkills(mods, pb).map((s) => ({
      ...s,
      prof: chosenSkills.includes(s.key) ? ("proficient" as const) : s.prof,
    }));
    const spellAbility = primaryClass?.spellAbility ?? "";

    const refs: { title: string; body: string }[] = [];
    if (race && race.traits.length) refs.push({ title: `種族：${race.nameZh}`, body: race.traits.join("\n") });
    for (const c of classes) {
      const sc = SRD_CLASSES.find((x) => x.id === c.classId);
      const sub = sc?.subclasses[0];
      if (sub?.l1 && sub.l1FeatureText && c.subclassId === sub.id) {
        refs.push({ title: `${sc!.nameZh}：${sub.nameZh}`, body: sub.l1FeatureText });
      }
    }

    const toolsText = [
      armorProfs.length ? `護甲：${armorProfs.join("、")}` : "",
      weaponProfs.length ? `武器：${weaponProfs.join("、")}` : "",
      toolProfs.length ? `工具：${toolProfs.join("、")}` : "",
      languageProfs.length ? `語言：${languageProfs.join("、")}` : "",
    ]
      .filter(Boolean)
      .join("；");

    const base: CharacterFields = {
      player,
      nameZh: nameZh || t.card.newCardName,
      nameEn,
      race: raceLabel,
      classesText,
      classes,
      level: 1,
      alignment: "",
      statusText: "正常",
      hp,
      maxHp: hp,
      tempHp: 0,
      ac: ac.ac,
      acFormula: ac.acFormula,
      speedText: race ? `${race.speedFt}呎` : "30呎",
      initBonus: modOf("敏捷"),
      pb,
      abilities: finalAbilities,
      spellcastingAbility: spellAbility,
      spellAttack: 0,
      spellDc: 0,
      passivePerception: undefined,
      attackText: "",
      saves,
      skills,
      toolsText,
      armorProfs,
      weaponProfs,
      toolProfs,
      languageProfs,
      goldText: "",
      refs,
      classRules: [],
      story: "",
    };
    // Recompute every derived number (spell attack/DC, save/skill totals, PP).
    const recalced = recalcCard({
      abilities: base.abilities,
      level: 1,
      pb,
      initBonus: base.initBonus,
      saves: base.saves!,
      skills: base.skills!,
      spellcastingAbility: spellAbility,
      spellAttack: 0,
      spellDc: 0,
      passivePerception: 10,
    });
    const fields: CharacterFields = {
      ...base,
      abilities: recalced.abilities,
      initBonus: recalced.initBonus,
      saves: recalced.saves,
      skills: recalced.skills,
      spellAttack: recalced.spellAttack,
      spellDc: recalced.spellDc,
      passivePerception: recalced.passivePerception,
    };

    const resources: BuilderResource[] = [];
    const slots = spellSlotsL1For(primaryClass?.caster ?? "none");
    if (slots > 0) resources.push({ label: "L1 法術位", current: slots, max: slots });

    return { fields, resources };
  };

  const finish = async () => {
    setBusy(true);
    try {
      await onCreate(assemble());
    } finally {
      setBusy(false);
    }
  };

  const current: Step = STEPS[step];
  const next = () => {
    if (current === "background") seedProfs();
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };
  const back = () => setStep((s) => Math.max(0, s - 1));

  return (
    <div className="wt-builder-overlay" role="dialog" aria-label="character builder" aria-modal="true">
      <div className="wt-builder">
        <header className="wt-builder-head">
          <b>{t.builder.title}</b>
          <span className="wt-builder-progress">
            {step + 1} / {STEPS.length} · {t.builder.steps[current]}
          </span>
          <button onClick={onCancel} aria-label="cancel builder">✕</button>
        </header>

        <div className="wt-builder-body">
          {current === "race" && (
            <fieldset>
              <label>
                {t.builder.raceSrd}
                <select aria-label="race select" value={raceId} onChange={(e) => setRaceId(e.target.value)}>
                  {SRD_RACES.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.nameZh}（{r.size}, {r.speedFt}呎）
                    </option>
                  ))}
                  <option value="">{t.builder.custom}</option>
                </select>
              </label>
              {raceId === "" && (
                <label>
                  {t.builder.raceCustom}
                  <input aria-label="race custom" value={customRace} onChange={(e) => setCustomRace(e.target.value)} />
                </label>
              )}
              {race && <p className="wt-builder-hint">ASI：{Object.entries(race.asi).map(([k, v]) => `${k}+${v}`).join("、")}{race.asiChoice ? `、自選 ${race.asiChoice.count}×+${race.asiChoice.amount}` : ""}</p>}
            </fieldset>
          )}

          {current === "class" && (
            <fieldset>
              {classes.map((c, i) => {
                const sc = SRD_CLASSES.find((x) => x.id === c.classId);
                return (
                  <div key={i} className="wt-builder-classrow">
                    <select
                      aria-label={`class select ${i}`}
                      value={sc ? c.classId : ""}
                      onChange={(e) => {
                        const cls = SRD_CLASSES.find((x) => x.id === e.target.value);
                        setProfsSeeded(false);
                        setClasses((rows) => rows.map((r, j) => (j === i ? { classId: e.target.value, classNameZh: cls?.nameZh, level: r.level, active: r.active } : r)));
                      }}
                    >
                      {SRD_CLASSES.map((x) => (
                        <option key={x.id} value={x.id}>{x.nameZh}</option>
                      ))}
                      <option value="">{t.builder.custom}</option>
                    </select>
                    {sc ? (
                      <select
                        aria-label={`subclass select ${i}`}
                        value={c.subclassId ?? ""}
                        onChange={(e) => {
                          const sub = sc.subclasses.find((s) => s.id === e.target.value);
                          setClasses((rows) => rows.map((r, j) => (j === i ? { ...r, subclassId: sub?.id, subclassNameZh: sub?.nameZh } : r)));
                        }}
                      >
                        <option value="">{sc.subclassLabel}…</option>
                        {sc.subclasses.map((s) => (
                          <option key={s.id} value={s.id}>{s.nameZh}{s.l1 ? "（1級）" : ""}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        aria-label={`class custom ${i}`}
                        placeholder={t.builder.classCustom}
                        value={c.classNameZh ?? ""}
                        onChange={(e) => setClasses((rows) => rows.map((r, j) => (j === i ? { ...r, classNameZh: e.target.value } : r)))}
                      />
                    )}
                    <input
                      aria-label={`class level ${i}`}
                      type="number"
                      min={0}
                      style={{ width: "3.5em" }}
                      value={c.level}
                      onChange={(e) => setClasses((rows) => rows.map((r, j) => (j === i ? { ...r, level: Number(e.target.value) } : r)))}
                    />
                    <label className="wt-builder-active">
                      <input type="checkbox" aria-label={`class active ${i}`} checked={c.active} onChange={(e) => setClasses((rows) => rows.map((r, j) => (j === i ? { ...r, active: e.target.checked } : r)))} />
                      {t.builder.active}
                    </label>
                    {classes.length > 1 && (
                      <button aria-label={`remove class ${i}`} onClick={() => setClasses((rows) => rows.filter((_, j) => j !== i))}>✕</button>
                    )}
                  </div>
                );
              })}
              <button aria-label="add class" onClick={() => setClasses((rows) => [...rows, { classId: SRD_CLASSES[0].id, classNameZh: SRD_CLASSES[0].nameZh, level: 0, active: false }])}>
                + {t.builder.addClass}
              </button>
            </fieldset>
          )}

          {current === "abilities" && (
            <fieldset>
              <div className="wt-builder-methods">
                {(["manual", "array", "pointbuy"] as Method[]).map((m) => (
                  <label key={m}>
                    <input type="radio" name="abmethod" aria-label={`method ${m}`} checked={method === m} onChange={() => setMethod(m)} />
                    {t.builder.methods[m]}
                  </label>
                ))}
              </div>
              {method === "array" && <p className="wt-builder-hint">{t.builder.arrayHint}：{STANDARD_ARRAY.join("、")}</p>}
              {method === "pointbuy" && <p className="wt-builder-hint">{t.builder.pointsLeft}：{pointBudget}</p>}
              <div className="wt-builder-abilities">
                {ABILITY_KEYS.map((k) => (
                  <label key={k}>
                    {k}
                    <input
                      aria-label={`ability ${k}`}
                      type="number"
                      value={baseScores[k]}
                      onChange={(e) => setBaseScores((s) => ({ ...s, [k]: Number(e.target.value) }))}
                    />
                    <span className="wt-builder-final" aria-label={`final ${k}`}>
                      → {finalAbilities.find((a) => a.key === k)!.score}（{modOf(k) >= 0 ? "+" : ""}{modOf(k)}）
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {current === "background" && (
            <fieldset>
              <label>
                {t.builder.background}
                <select aria-label="background select" value={bgId} onChange={(e) => { setBgId(e.target.value); setProfsSeeded(false); }}>
                  {SRD_BACKGROUNDS.map((b) => (
                    <option key={b.id} value={b.id}>{b.nameZh}</option>
                  ))}
                  <option value="">{t.builder.custom}</option>
                </select>
              </label>
              {primaryClass && (
                <div>
                  <p className="wt-builder-hint">{t.builder.pickSkills}（{primaryClass.skillChoose}）</p>
                  <div className="wt-builder-skills">
                    {(primaryClass.skillFrom.length ? primaryClass.skillFrom : ABILITY_KEYS.flatMap(() => [])).map((sk) => (
                      <label key={sk}>
                        <input
                          type="checkbox"
                          aria-label={`skill ${sk}`}
                          checked={chosenSkills.includes(sk)}
                          onChange={(e) => setChosenSkills((s) => (e.target.checked ? [...s, sk] : s.filter((x) => x !== sk)))}
                        />
                        {sk}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </fieldset>
          )}

          {current === "profs" && (
            <fieldset>
              {(
                [
                  ["armor", armorProfs, setArmorProfs, t.builder.armor],
                  ["weapon", weaponProfs, setWeaponProfs, t.builder.weapons],
                  ["tool", toolProfs, setToolProfs, t.builder.tools],
                  ["lang", languageProfs, setLanguageProfs, t.builder.languages],
                ] as const
              ).map(([key, list, set, label]) => (
                <label key={key}>
                  {label}
                  <input
                    aria-label={`profs ${key}`}
                    value={list.join("、")}
                    onChange={(e) => set(e.target.value.split(/[、,]/).map((s) => s.trim()).filter(Boolean))}
                  />
                </label>
              ))}
              <hr />
              <label>
                {t.builder.armorForAc}
                <select aria-label="armor select" value={armorId} onChange={(e) => setArmorId(e.target.value)}>
                  <option value="">{t.builder.unarmored}</option>
                  {SRD_ARMORS.filter((a) => a.cat !== "shield").map((a) => (
                    <option key={a.id} value={a.id}>{a.name}（{a.cat}, {a.base}）</option>
                  ))}
                </select>
              </label>
              <label className="wt-builder-active">
                <input type="checkbox" aria-label="shield" checked={shield} onChange={(e) => setShield(e.target.checked)} />
                {t.builder.shield}
              </label>
              <p className="wt-builder-hint" aria-label="ac preview">AC {ac.ac}（{ac.acFormula}）</p>
            </fieldset>
          )}

          {current === "spells" && (
            <fieldset>
              {primaryClass && spellSlotsL1For(primaryClass.caster) > 0 ? (
                <p className="wt-builder-hint">{t.builder.spellSlots}：{spellSlotsL1For(primaryClass.caster)}（{t.builder.spellPickLater}）</p>
              ) : (
                <p className="wt-builder-hint">{t.builder.noSpells}</p>
              )}
            </fieldset>
          )}

          {current === "review" && (
            <fieldset>
              <label>{t.builder.nameZh}<input aria-label="builder name zh" value={nameZh} onChange={(e) => setNameZh(e.target.value)} /></label>
              <label>{t.builder.nameEn}<input aria-label="builder name en" value={nameEn} onChange={(e) => setNameEn(e.target.value)} /></label>
              <label>{t.builder.player}<input aria-label="builder player" value={player} onChange={(e) => setPlayer(e.target.value)} /></label>
              <ul className="wt-builder-review">
                <li>{raceLabel || "—"} · {classesText.replace(/\n/g, " / ")}</li>
                <li>HP {hp} · AC {ac.ac} · {t.builder.speed} {race ? race.speedFt : 30}呎</li>
                <li>{ABILITY_KEYS.map((k) => `${k} ${finalAbilities.find((a) => a.key === k)!.score}`).join(" · ")}</li>
              </ul>
            </fieldset>
          )}
        </div>

        <footer className="wt-builder-foot">
          <button onClick={back} disabled={step === 0} aria-label="builder back">← {t.builder.back}</button>
          {current === "review" ? (
            <button onClick={() => void finish()} disabled={busy} aria-label="builder finish">{busy ? t.builder.creating : t.builder.finish}</button>
          ) : (
            <button onClick={next} aria-label="builder next">{t.builder.nextStep} →</button>
          )}
        </footer>
      </div>
    </div>
  );
}
