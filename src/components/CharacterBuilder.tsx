import { useMemo, useState } from "react";
import { useT } from "../i18n";
import { abilityLabel, skillLabel, profLabel } from "../i18n/terms";
import type { CharacterFields, ClassEntry } from "../../convex/characters";
import {
  ABILITY_KEYS,
  SKILLS,
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
  ARMOR_CAT_ZH,
  ARMOR_PROF_OPTIONS,
  WEAPON_PROF_OPTIONS,
  TOOL_PROF_OPTIONS,
  LANGUAGE_OPTIONS,
  type SrdClass,
  type ProfOption,
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
  Object.fromEntries(ABILITY_KEYS.map((k) => [k, 8])) as Record<AbilityKey, number>;

export function CharacterBuilder({ onCreate, onCancel }: CharacterBuilderProps) {
  const t = useT();
  const cc = t.builder.content;
  /** Locale-aware display name (zh in Chinese mode, en in English mode). */
  const dn = (zh: string, en: string) => t.terms.displayName(zh, en);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);

  // Identity
  const [nameZh, setNameZh] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [player, setPlayer] = useState("");

  // Race: an SRD id, or "" = custom (with a free-text label)
  const [raceId, setRaceId] = useState<string>(SRD_RACES[0].id);
  const [customRace, setCustomRace] = useState("");
  // Free-choice racial ASI (Half-Elf: two +1s of the player's choice), separate
  // from the 27-point budget — race.asiChoice.count slots, "" = unpicked.
  const [asiChoices, setAsiChoices] = useState<(AbilityKey | "")[]>([]);

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

  // Merged racial ASI (fixed race.asi + any free-choice picks), keyed by
  // ability — the single source both finalAbilities and the per-row "race
  // gave you +N" badge read from. Custom race (no `race`) = no auto ASI.
  const racialAsi: Record<string, number> = useMemo(() => {
    if (!race) return {};
    const asi: Record<string, number> = { ...race.asi };
    if (race.asiChoice) {
      for (const k of asiChoices) if (k) asi[k] = (asi[k] ?? 0) + race.asiChoice.amount;
    }
    return asi;
  }, [race, asiChoices]);

  // Final ability rows = base + racialAsi.
  const finalAbilities: AbilityRow[] = useMemo(() => {
    const base = ABILITY_KEYS.map((k) => ({ key: k, score: baseScores[k], mod: modFor(baseScores[k]) }));
    return applyRacialAsi(base, racialAsi);
  }, [baseScores, racialAsi]);
  const modOf = (k: AbilityKey) => finalAbilities.find((a) => a.key === k)!.mod;

  // AC preview
  const armor = SRD_ARMORS.find((a) => a.id === armorId);
  const ac = useMemo(
    () =>
      acFor({
        dexMod: modOf("敏捷"),
        armor: armor && armor.cat !== "shield" ? armor : null,
        shield: shield || armor?.cat === "shield",
        armorLabel: armor && dn(armor.nameZh, armor.name),
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
    setArmorProfs(
      [...primaryClass.armorProfs, ...(sub.l1 && sub.bonusArmorProfs ? sub.bonusArmorProfs : [])].map((p) => profLabel(t, p)),
    );
    setWeaponProfs(primaryClass.weaponProfs.map((p) => profLabel(t, p)));
    setToolProfs([]);
    // Racial fixed languages (Human/Dragonborn/…) seed as chips; SRD classes
    // grant none, so there's no class-side language list to fold in here.
    const langDn = (zh: string) => {
      const o = LANGUAGE_OPTIONS.find((x) => x.zh === zh);
      return o ? dn(o.zh, o.en) : zh;
    };
    setLanguageProfs(race ? race.languages.map(langDn) : []);
    setProfsSeeded(true);
    if (bg) setChosenSkills((s) => Array.from(new Set([...s, ...bg.skills])));
  };

  const pointBudget = POINT_BUY_BUDGET - pointBuyTotal(ABILITY_KEYS.map((k) => baseScores[k]));
  // pointBuyTotal treats scores outside 8-15 as 0 cost (dndCalc.ts, unchanged) —
  // that's a silent no-op that makes the remaining-points number jump when a
  // score crosses 15. Explain it here instead of clamping the input.
  const outOfRange = ABILITY_KEYS.filter((k) => baseScores[k] < 8 || baseScores[k] > 15);

  const raceLabel = race ? `${dn(race.nameZh, race.nameEn)}（${cc.sizes[race.size]}）` : customRace;
  const classesText = classes
    .map((c) => {
      const sc = SRD_CLASSES.find((x) => x.id === c.classId);
      const name = sc ? dn(sc.nameZh, sc.nameEn) : c.classNameZh ?? c.classId;
      const sub = c.subclassNameZh ? `：${c.subclassNameZh}` : "";
      return `${name}${sub} (${c.level}${c.active ? "" : cc.inactive})`;
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
    if (race && race.traits.length) refs.push({ title: `${cc.raceTitle}：${dn(race.nameZh, race.nameEn)}`, body: race.traits.join("\n") });
    for (const c of classes) {
      const sc = SRD_CLASSES.find((x) => x.id === c.classId);
      const sub = sc?.subclasses[0];
      if (sub?.l1 && sub.l1FeatureText && c.subclassId === sub.id) {
        refs.push({ title: `${dn(sc!.nameZh, sc!.nameEn)}：${dn(sub.nameZh, sub.nameEn)}`, body: sub.l1FeatureText });
      }
    }

    const toolsText = [
      armorProfs.length ? `${cc.profPrefix.armor}：${armorProfs.join("、")}` : "",
      weaponProfs.length ? `${cc.profPrefix.weapon}：${weaponProfs.join("、")}` : "",
      toolProfs.length ? `${cc.profPrefix.tool}：${toolProfs.join("、")}` : "",
      languageProfs.length ? `${cc.profPrefix.language}：${languageProfs.join("、")}` : "",
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
      statusText: cc.statusNormal,
      hp,
      maxHp: hp,
      tempHp: 0,
      ac: ac.ac,
      acFormula: ac.acFormula,
      speedText: race ? `${race.speedFt}${cc.ftSuffix}` : `30${cc.ftSuffix}`,
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
    if (slots > 0) resources.push({ label: cc.slotLabel, current: slots, max: slots });

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
    // Arriving at the background step: pre-check the current background's
    // granted skills so they show up without the player having to touch the
    // select first (they still get merged again in seedProfs on the way out).
    if (current === "abilities") {
      const bg = SRD_BACKGROUNDS.find((b) => b.id === bgId);
      if (bg) setChosenSkills((s) => Array.from(new Set([...s, ...bg.skills])));
    }
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
                <select
                  aria-label="race select"
                  value={raceId}
                  onChange={(e) => {
                    setRaceId(e.target.value);
                    const newRace = SRD_RACES.find((r) => r.id === e.target.value);
                    setAsiChoices(newRace?.asiChoice ? Array(newRace.asiChoice.count).fill("") : []);
                    // Race now feeds seeded languages too — reseed on race change.
                    setProfsSeeded(false);
                  }}
                >
                  {SRD_RACES.map((r) => (
                    <option key={r.id} value={r.id}>
                      {dn(r.nameZh, r.nameEn)}（{cc.sizes[r.size]}, {r.speedFt}{cc.ftSuffix}）
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
              {race && <p className="wt-builder-hint">ASI：{Object.entries(race.asi).map(([k, v]) => `${abilityLabel(t, k)}+${v}`).join("、")}{race.asiChoice ? `、${cc.asiChoose} ${race.asiChoice.count}×+${race.asiChoice.amount}` : ""}</p>}
            </fieldset>
          )}

          {current === "class" && (
            <fieldset>
              {classes.map((c, i) => {
                const sc = SRD_CLASSES.find((x) => x.id === c.classId);
                return (
                  <div key={i} className="wt-builder-classrow">
                    <div className="wt-builder-col">
                      {i === 0 && <span className="wt-builder-collabel">{t.builder.colClass}</span>}
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
                          <option key={x.id} value={x.id}>{dn(x.nameZh, x.nameEn)}</option>
                        ))}
                        <option value="">{t.builder.custom}</option>
                      </select>
                    </div>
                    <div className="wt-builder-col">
                      {i === 0 && <span className="wt-builder-collabel">{t.builder.colSubclass}</span>}
                      {sc ? (
                        <select
                          aria-label={`subclass select ${i}`}
                          value={c.subclassId ?? ""}
                          onChange={(e) => {
                            const sub = sc.subclasses.find((s) => s.id === e.target.value);
                            setClasses((rows) => rows.map((r, j) => (j === i ? { ...r, subclassId: sub?.id, subclassNameZh: sub?.nameZh } : r)));
                          }}
                        >
                          <option value="">{dn(sc.subclassLabel, sc.subclassLabelEn)}…</option>
                          {sc.subclasses.map((s) => (
                            <option key={s.id} value={s.id}>{dn(s.nameZh, s.nameEn)}{s.l1 ? cc.l1Tag : ""}</option>
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
                    </div>
                    <div className="wt-builder-col">
                      {i === 0 && <span className="wt-builder-collabel">{t.builder.colLevel}</span>}
                      <input
                        aria-label={`class level ${i}`}
                        type="number"
                        min={0}
                        style={{ width: "3.5em" }}
                        value={c.level}
                        onChange={(e) => setClasses((rows) => rows.map((r, j) => (j === i ? { ...r, level: Number(e.target.value) } : r)))}
                      />
                    </div>
                    <div className="wt-builder-col">
                      {i === 0 && <span className="wt-builder-collabel">{t.builder.active}</span>}
                      <label className="wt-builder-active">
                        <input type="checkbox" aria-label={`class active ${i}`} checked={c.active} onChange={(e) => setClasses((rows) => rows.map((r, j) => (j === i ? { ...r, active: e.target.checked } : r)))} />
                        {t.builder.active}
                      </label>
                    </div>
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
              {method === "pointbuy" && (
                <p className="wt-builder-hint">
                  {t.builder.pointsLeft}：{pointBudget}
                  {outOfRange.length > 0 &&
                    ` ${t.builder.pointsOverRange(outOfRange.map((k) => abilityLabel(t, k)).join("、"))}`}
                </p>
              )}
              {race?.asiChoice && (
                <div className="wt-builder-asichoice">
                  {Array.from({ length: race.asiChoice.count }).map((_, i) => {
                    const taken = new Set([...Object.keys(race.asi), ...asiChoices.filter((_v, j) => j !== i)]);
                    return (
                      <label key={i}>
                        {t.builder.asiChoicePick} #{i + 1}
                        <select
                          aria-label={`asi choice ${i}`}
                          value={asiChoices[i] ?? ""}
                          onChange={(e) =>
                            setAsiChoices((choices) => choices.map((c, j) => (j === i ? (e.target.value as AbilityKey | "") : c)))
                          }
                        >
                          <option value="">{t.builder.asiChoosePlaceholder}</option>
                          {ABILITY_KEYS.filter((k) => !taken.has(k)).map((k) => (
                            <option key={k} value={k}>{abilityLabel(t, k)}</option>
                          ))}
                        </select>
                      </label>
                    );
                  })}
                </div>
              )}
              <div className="wt-builder-abilities">
                {ABILITY_KEYS.map((k) => (
                  <label key={k}>
                    {abilityLabel(t, k)}
                    <input
                      aria-label={`ability ${k}`}
                      type="number"
                      value={baseScores[k]}
                      onChange={(e) => setBaseScores((s) => ({ ...s, [k]: Number(e.target.value) }))}
                    />
                    {(racialAsi[k] ?? 0) !== 0 && (
                      <span className="wt-builder-asi" aria-label={`racial ${k}`}>
                        {t.builder.racialTag}+{racialAsi[k]}
                      </span>
                    )}
                    <span className="wt-builder-final" aria-label={`final ${k}`}>
                      → {finalAbilities.find((a) => a.key === k)!.score}（{t.builder.modTag}{modOf(k) >= 0 ? "+" : ""}{modOf(k)}）
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
                <select
                  aria-label="background select"
                  value={bgId}
                  onChange={(e) => {
                    const oldBg = SRD_BACKGROUNDS.find((b) => b.id === bgId);
                    const newBg = SRD_BACKGROUNDS.find((b) => b.id === e.target.value);
                    setChosenSkills((s) => {
                      const withoutOld = oldBg ? s.filter((sk) => !oldBg.skills.includes(sk)) : s;
                      return newBg ? Array.from(new Set([...withoutOld, ...newBg.skills])) : withoutOld;
                    });
                    setBgId(e.target.value);
                    setProfsSeeded(false);
                  }}
                >
                  {SRD_BACKGROUNDS.map((b) => (
                    <option key={b.id} value={b.id}>{dn(b.nameZh, b.nameEn)}</option>
                  ))}
                  <option value="">{t.builder.custom}</option>
                </select>
              </label>
              {primaryClass && (
                <div>
                  <p className="wt-builder-hint">{t.builder.pickSkills}（{primaryClass.skillChoose}）</p>
                  <div className="wt-builder-skills">
                    {(() => {
                      // [] skillFrom means "choose any" (Bard) — list every skill,
                      // not zero checkboxes.
                      const classSkills = primaryClass.skillFrom.length ? primaryClass.skillFrom : SKILLS.map((s) => s.key);
                      const bg = SRD_BACKGROUNDS.find((b) => b.id === bgId);
                      const skillOptions = bg
                        ? [...classSkills, ...bg.skills.filter((sk) => !classSkills.includes(sk))]
                        : classSkills;
                      return skillOptions.map((sk) => {
                        const bgGranted = !!bg?.skills.includes(sk);
                        return (
                          <label key={sk}>
                            <input
                              type="checkbox"
                              aria-label={`skill ${sk}`}
                              checked={bgGranted || chosenSkills.includes(sk)}
                              disabled={bgGranted}
                              onChange={(e) => setChosenSkills((s) => (e.target.checked ? [...s, sk] : s.filter((x) => x !== sk)))}
                            />
                            {skillLabel(t, sk)}{bgGranted ? t.builder.bgGrantedTag : ""}
                          </label>
                        );
                      });
                    })()}
                  </div>
                </div>
              )}
            </fieldset>
          )}

          {current === "profs" && (
            <fieldset>
              <ProfPicker fieldKey="armor" label={t.builder.armor} options={ARMOR_PROF_OPTIONS} list={armorProfs} onChange={setArmorProfs} />
              <ProfPicker fieldKey="weapon" label={t.builder.weapons} options={WEAPON_PROF_OPTIONS} list={weaponProfs} onChange={setWeaponProfs} />
              <ProfPicker fieldKey="tool" label={t.builder.tools} options={TOOL_PROF_OPTIONS} list={toolProfs} onChange={setToolProfs} />
              <ProfPicker fieldKey="lang" label={t.builder.languages} options={LANGUAGE_OPTIONS} list={languageProfs} onChange={setLanguageProfs} />
              {(() => {
                const bg = SRD_BACKGROUNDS.find((b) => b.id === bgId);
                const fromRace = race?.languageChoice ?? 0;
                const fromBg = bg?.languages ?? 0;
                // Race's FIXED languages are already visible as chips — only
                // the free-choice counts (race + background) go in the hint.
                return fromRace + fromBg > 0 ? (
                  <p className="wt-builder-hint" aria-label="lang hint">{t.builder.langHint(fromRace, fromBg)}</p>
                ) : null;
              })()}
              <hr />
              <label>
                {t.builder.armorForAc}
                <select aria-label="armor select" value={armorId} onChange={(e) => setArmorId(e.target.value)}>
                  <option value="">{t.builder.unarmored}</option>
                  {SRD_ARMORS.filter((a) => a.cat !== "shield").map((a) => (
                    <option key={a.id} value={a.id}>{dn(a.nameZh, a.name)}（{profLabel(t, ARMOR_CAT_ZH[a.cat])}, {a.base}）</option>
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
                <li>HP {hp} · AC {ac.ac} · {t.builder.speed} {race ? race.speedFt : 30}{cc.ftSuffix}</li>
                <li>{ABILITY_KEYS.map((k) => `${abilityLabel(t, k)} ${finalAbilities.find((a) => a.key === k)!.score}`).join(" · ")}</li>
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

/**
 * A proficiency picker for the profs step: chips for the current list + a
 * dropdown to add from the SRD option table (or open a homebrew text slot).
 * The underlying state stays a plain string[] — this only changes how it's
 * edited, not what it holds (assemble()/toolsText derive from it unchanged).
 */
function ProfPicker({
  fieldKey,
  label,
  options,
  list,
  onChange,
}: {
  fieldKey: string;
  label: string;
  options: ProfOption[];
  list: string[];
  onChange: (list: string[]) => void;
}) {
  const t = useT();
  const dn = (zh: string, en: string) => t.terms.displayName(zh, en);
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");

  const addCustom = () => {
    const v = customText.trim();
    if (v) onChange([...list, v]);
    setCustomText("");
    setCustomOpen(false);
  };

  return (
    <div className="wt-builder-profpicker">
      <span className="wt-builder-collabel">{label}</span>
      <div className="wt-builder-chips">
        {list.map((item, i) => (
          <span key={i} className="wt-builder-chip">
            {item}
            <button
              type="button"
              aria-label={`remove ${fieldKey} ${i}`}
              onClick={() => onChange(list.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <select
        aria-label={`profs ${fieldKey} add`}
        value=""
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__custom") setCustomOpen(true);
          else if (v) onChange([...list, v]);
        }}
      >
        <option value="">{t.builder.addProf}</option>
        {options
          .filter((o) => !list.includes(dn(o.zh, o.en)))
          .map((o) => (
            <option key={o.zh} value={dn(o.zh, o.en)}>{dn(o.zh, o.en)}</option>
          ))}
        <option value="__custom">{t.builder.custom}</option>
      </select>
      {customOpen && (
        <span className="wt-builder-custominput">
          <input
            aria-label={`profs ${fieldKey} custom`}
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustom();
              }
            }}
          />
          <button type="button" aria-label={`profs ${fieldKey} custom add`} onClick={addCustom}>
            {t.builder.addWord}
          </button>
        </span>
      )}
    </div>
  );
}
