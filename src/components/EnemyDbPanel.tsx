import { useEffect, useState } from "react";
import type { EnemyFields, EnemyView } from "../../convex/enemies";
import { enemyMatchesQuery } from "../lib/enemySearch";
import { useT } from "../i18n";
import { abilityLabel } from "../i18n/terms";

/**
 * Enemy database panel (issue #6) — Backstage-only (the parent only renders it
 * for the DM; the backend gates every call by dmToken regardless). Browse the
 * seeded gothic bestiary + SRD monsters + custom entries, Spawn a template
 * into the battle, and edit/create homebrew entries. Real CoS content is
 * entered here locally and never shipped (PRD bottom line).
 *
 * Search + paging port the LibraryPicker pattern (363+ entries is too many
 * for a flat list). The five action blocks are edited as raw JSON textareas —
 * they must round-trip losslessly whatever shape the source used, so a
 * structured editor would only get in the way (DM authority, ADR-0002).
 */

const PAGE = 30;

type Source = "all" | "seed" | "srd" | "custom";

export type EnemyDbHandlers = {
  onSeed: () => void;
  onBackfill: () => void | Promise<unknown>;
  onSpawn: (enemyId: string, name: string) => void;
  onCreate: (fields: EnemyFields) => void | Promise<unknown>;
  onUpdate: (enemyId: string, fields: EnemyFields) => void | Promise<unknown>;
  onRemove: (enemyId: string) => void;
};

/** A blank custom template for the create form (+ statBlock-less instances). */
export function blankEnemy(): EnemyFields {
  return {
    source: "custom",
    nameZh: "",
    nameEn: "",
    symbol: "",
    role: "",
    themeTags: "",
    size: "中型",
    creatureType: "",
    temperament: "",
    threatTier: 1,
    ac: 10,
    hpMax: 10,
    hpFormula: "",
    speedText: "30呎",
    abilities: ["力量", "敏捷", "體質", "智力", "感知", "魅力"].map((key) => ({
      key,
      score: 10,
      mod: 0,
    })),
    saveBonuses: [],
    skills: [],
    senses: "",
    passivePerception: 10,
    languages: "",
    damageResistances: "",
    damageVulnerabilities: "",
    damageImmunities: "",
    conditionImmunities: "",
    traits: [],
    actions: [],
    bonusActions: [],
    reactions: [],
    legendaryActions: [],
    tactics: "",
    encounterNotes: "",
  };
}

export function EnemyDbPanel({
  enemies,
  onSeed,
  onBackfill,
  onSpawn,
  onCreate,
  onUpdate,
  onRemove,
}: { enemies: EnemyView[] | undefined } & EnemyDbHandlers) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<Source>("all");
  const [limit, setLimit] = useState(PAGE);
  // null = browsing; "new" = create form; otherwise the _id being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  // A destructive action gets a deliberate second click but never leaves a
  // stale confirmation armed while the DM works elsewhere.
  useEffect(() => {
    if (pendingDelete === null) return;
    const timeout = window.setTimeout(() => setPendingDelete(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [pendingDelete]);

  // Open a form for a target, clearing any stale save error from a prior edit.
  const openEditor = (target: string) => {
    setSaveError("");
    setEditing(target);
  };

  if (enemies === undefined) return <p>{t.common.loading}</p>;

  if (editing !== null) {
    let initial: EnemyFields;
    if (editing === "new") {
      initial = blankEnemy();
    } else {
      const doc = enemies.find((e) => e._id === editing);
      if (doc === undefined) {
        setEditing(null);
        return null;
      }
      // Strip Convex system fields — update's validator rejects extra keys, so
      // the raw EnemyView would fail silently (mirrors spawn's strip at
      // convex/enemies.ts:281-286). seedKey stays; the backend drops it.
      const { _id: _drop, _creationTime: _dropTime, ...fields } = doc;
      initial = fields;
    }
    return (
      <>
        {saveError && (
          <p style={{ color: "#d66" }}>{t.enemy.saveFailed(saveError)}</p>
        )}
        <EnemyForm
          initial={initial}
          onSave={async (fields) => {
            try {
              if (editing === "new") await onCreate(fields);
              else await onUpdate(editing, fields);
              setSaveError("");
              setEditing(null);
            } catch (e) {
              // Keep the form open so the DM's input isn't lost.
              setSaveError(e instanceof Error ? e.message : String(e));
            }
          }}
          onCancel={() => setEditing(null)}
        />
      </>
    );
  }

  // Seeded-but-unnamed templates (SRD shipped English-only) — drives the
  // one-time 補中文名 button, which self-hides once every row has a zh name.
  const missingZh = enemies.filter((e) => e.nameZh.trim() === "").length;

  const matches = enemies.filter((e) => {
    if (source !== "all" && e.source !== source) return false;
    return enemyMatchesQuery(e, query);
  });
  const shown = matches.slice(0, limit);

  return (
    <section aria-label="enemy database" className="wt-enemydb">
      <div className="wt-enemydb-controls">
        <select
          value={source}
          onChange={(e) => {
            setSource(e.target.value as Source);
            setLimit(PAGE);
          }}
          aria-label="enemy source filter"
        >
          <option value="all">{t.enemy.filterAll}</option>
          <option value="seed">{t.enemy.sourceSeedLong}</option>
          <option value="srd">SRD</option>
          <option value="custom">{t.enemy.sources.custom}</option>
        </select>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(PAGE);
          }}
          placeholder={t.enemy.searchPlaceholder}
          size={18}
          aria-label="enemy search"
        />
        <button onClick={() => openEditor("new")} aria-label="new custom enemy">
          {t.enemy.addCustom}
        </button>
        {enemies.length === 0 && (
          <button onClick={onSeed} aria-label="seed enemy database">
            {t.enemy.importSeed}
          </button>
        )}
        {missingZh > 0 && (
          <button onClick={() => onBackfill()} aria-label="fill chinese names">
            {t.enemy.backfillZh(missingZh)}
          </button>
        )}
        <em style={{ opacity: 0.7 }}>{t.enemy.countRows(matches.length)}</em>
      </div>
      <div className="wt-enemydb-list">
        {shown.length === 0 && <p style={{ opacity: 0.7 }}>{t.sheet.noMatches}</p>}
        {shown.map((e) => {
          const name = t.terms.displayName(e.nameZh, e.nameEn);
          const other = name === e.nameZh ? e.nameEn : e.nameZh;
          const fullName = other ? `${name} · ${other}` : name;
          const confirmingDelete = pendingDelete === e._id;
          return (
            <div key={e._id} className="wt-enemydb-row">
              <div className="wt-enemydb-summary">
                <button
                  className="wt-enemydb-spawn"
                  onClick={() => onSpawn(e._id, name)}
                  aria-label={`spawn ${name}`}
                >
                  {t.enemy.spawn}
                </button>
                <div className="wt-enemydb-details">
                  <strong className="wt-enemydb-name" title={fullName}>
                    {name}
                  </strong>
                  {other && (
                    <span className="wt-enemydb-name-en" title={other}>
                      {other}
                    </span>
                  )}
                  <em className="wt-enemydb-meta">
                    [{t.enemy.sources[e.source]}] T{e.threatTier} · AC{e.ac} · HP{e.hpMax}
                  </em>
                </div>
              </div>
              <div className="wt-enemydb-actions">
                <button onClick={() => openEditor(e._id)} aria-label={`edit ${name}`}>
                  ✎
                </button>
                <button
                  onClick={() => {
                    if (confirmingDelete) {
                      setPendingDelete(null);
                      onRemove(e._id);
                    } else {
                      setPendingDelete(e._id);
                    }
                  }}
                  onBlur={() => {
                    if (confirmingDelete) setPendingDelete(null);
                  }}
                  aria-label={
                    confirmingDelete ? `confirm delete ${name}` : `delete ${name}`
                  }
                >
                  {confirmingDelete ? t.enemy.confirmDelete : "✕"}
                </button>
              </div>
            </div>
          );
        })}
        {matches.length > limit && (
          <button onClick={() => setLimit(limit + PAGE)} aria-label="show more enemies">
            {t.enemy.showMoreRows(Math.min(PAGE, matches.length - limit))}
          </button>
        )}
      </div>
    </section>
  );
}

/** One labeled inline field. Shared with the on-field EnemyEditorWindow. */
export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "inline-flex", gap: "0.2em", alignItems: "center" }}>
      <span style={{ opacity: 0.8 }}>{label}</span>
      {children}
    </label>
  );
}

/**
 * The template editor. Holds the FULL fields object so anything the form
 * doesn't surface (saveBonuses/skills/symbol/role/…) round-trips untouched —
 * editing a seeded entry must never silently drop data. Also reused by the
 * on-field enemy editor window (EnemyEditorWindow) to edit a spawned
 * instance's statBlock with the identical UI.
 */
export function EnemyForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: EnemyFields;
  onSave: (fields: EnemyFields) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [f, setF] = useState<EnemyFields>(initial);
  // The five action blocks as editable JSON text; parsed on save.
  const [blocks, setBlocks] = useState<Record<string, string>>({
    traits: JSON.stringify(initial.traits, null, 1),
    actions: JSON.stringify(initial.actions, null, 1),
    bonusActions: JSON.stringify(initial.bonusActions, null, 1),
    reactions: JSON.stringify(initial.reactions, null, 1),
    legendaryActions: JSON.stringify(initial.legendaryActions, null, 1),
  });
  const [error, setError] = useState("");

  const set = (patch: Partial<EnemyFields>) => setF({ ...f, ...patch });
  const num = (s: string) => (Number.isNaN(Number(s)) ? 0 : Number(s));

  const save = () => {
    const parsed: Partial<EnemyFields> = {};
    for (const key of Object.keys(blocks)) {
      try {
        const arr = JSON.parse(blocks[key] || "[]");
        if (!Array.isArray(arr)) throw new Error(t.enemy.mustBeJsonArray);
        (parsed as any)[key] = arr;
      } catch (e) {
        setError(`${key}: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
    }
    onSave({ ...f, ...parsed });
  };

  const blockLabel: Record<string, string> = t.enemy.blockLabels;

  return (
    <section aria-label="enemy editor" style={{ display: "flex", flexDirection: "column", gap: "0.35em" }}>
      <div style={{ display: "flex", gap: "0.5em", flexWrap: "wrap" }}>
        <Field label={t.enemy.nameZhField}>
          <input
            value={f.nameZh}
            onChange={(e) => set({ nameZh: e.target.value })}
            size={12}
            aria-label="enemy name zh"
          />
        </Field>
        <Field label={t.enemy.nameEnField}>
          <input
            value={f.nameEn}
            onChange={(e) => set({ nameEn: e.target.value })}
            size={14}
            aria-label="enemy name en"
          />
        </Field>
        <Field label={t.enemy.threatTier}>
          <input
            value={f.threatTier}
            onChange={(e) => set({ threatTier: num(e.target.value) })}
            size={2}
            aria-label="enemy threat tier"
          />
        </Field>
      </div>
      <div style={{ display: "flex", gap: "0.5em", flexWrap: "wrap" }}>
        <Field label="AC">
          <input
            value={f.ac}
            onChange={(e) => set({ ac: num(e.target.value) })}
            size={2}
            aria-label="enemy ac"
          />
        </Field>
        <Field label="HP">
          <input
            value={f.hpMax}
            onChange={(e) => set({ hpMax: num(e.target.value) })}
            size={3}
            aria-label="enemy hp max"
          />
        </Field>
        <Field label={t.enemy.hpDice}>
          <input
            value={f.hpFormula}
            onChange={(e) => set({ hpFormula: e.target.value })}
            size={6}
            aria-label="enemy hp formula"
          />
        </Field>
        <Field label={t.enemy.speed}>
          <input
            value={f.speedText}
            onChange={(e) => set({ speedText: e.target.value })}
            size={8}
            aria-label="enemy speed"
          />
        </Field>
        <Field label={t.enemy.size}>
          <input
            value={f.size}
            onChange={(e) => set({ size: e.target.value })}
            size={4}
            aria-label="enemy size"
          />
        </Field>
        <Field label={t.enemy.creatureType}>
          <input
            value={f.creatureType}
            onChange={(e) => set({ creatureType: e.target.value })}
            size={5}
            aria-label="enemy creature type"
          />
        </Field>
      </div>
      <div style={{ display: "flex", gap: "0.5em", flexWrap: "wrap" }}>
        {f.abilities.map((a, i) => (
          <Field key={a.key} label={abilityLabel(t, a.key)}>
            <input
              value={a.score}
              onChange={(e) => {
                const score = num(e.target.value);
                const abilities = f.abilities.map((row, j) =>
                  j === i
                    ? { ...row, score, mod: Math.floor((score - 10) / 2) }
                    : row,
                );
                set({ abilities });
              }}
              size={2}
              aria-label={`enemy ability ${a.key}`}
            />
          </Field>
        ))}
      </div>
      <div style={{ display: "flex", gap: "0.5em", flexWrap: "wrap" }}>
        <Field label={t.enemy.senses}>
          <input
            value={f.senses}
            onChange={(e) => set({ senses: e.target.value })}
            size={14}
            aria-label="enemy senses"
          />
        </Field>
        <Field label={t.enemy.passivePerception}>
          <input
            value={f.passivePerception}
            onChange={(e) => set({ passivePerception: num(e.target.value) })}
            size={2}
            aria-label="enemy passive perception"
          />
        </Field>
        <Field label={t.enemy.languages}>
          <input
            value={f.languages}
            onChange={(e) => set({ languages: e.target.value })}
            size={10}
            aria-label="enemy languages"
          />
        </Field>
      </div>
      <div style={{ display: "flex", gap: "0.5em", flexWrap: "wrap" }}>
        <Field label={t.sheet.resist}>
          <input
            value={f.damageResistances}
            onChange={(e) => set({ damageResistances: e.target.value })}
            size={10}
            aria-label="enemy resistances"
          />
        </Field>
        <Field label={t.sheet.vuln}>
          <input
            value={f.damageVulnerabilities}
            onChange={(e) => set({ damageVulnerabilities: e.target.value })}
            size={8}
            aria-label="enemy vulnerabilities"
          />
        </Field>
        <Field label={t.sheet.immune}>
          <input
            value={f.damageImmunities}
            onChange={(e) => set({ damageImmunities: e.target.value })}
            size={8}
            aria-label="enemy damage immunities"
          />
        </Field>
        <Field label={t.enemy.conditionImmune}>
          <input
            value={f.conditionImmunities}
            onChange={(e) => set({ conditionImmunities: e.target.value })}
            size={8}
            aria-label="enemy condition immunities"
          />
        </Field>
      </div>
      {Object.keys(blocks).map((key) => (
        <details key={key} open={key === "actions"}>
          <summary>
            {blockLabel[key]} {t.enemy.jsonEachItem}{" "}
            <code>{"{"}"name":"咬擊","kind":"melee_attack","to_hit":4,"damage":"2d4+2 穿刺"{"}"}</code>
            ）
          </summary>
          <textarea
            value={blocks[key]}
            onChange={(e) => setBlocks({ ...blocks, [key]: e.target.value })}
            rows={4}
            style={{ width: "100%", fontFamily: "monospace" }}
            aria-label={`enemy ${key} json`}
          />
        </details>
      ))}
      <Field label={t.enemy.tactics}>
        <input
          value={f.tactics}
          onChange={(e) => set({ tactics: e.target.value })}
          style={{ flex: 1 }}
          aria-label="enemy tactics"
        />
      </Field>
      <Field label={t.enemy.encounterNotes}>
        <input
          value={f.encounterNotes}
          onChange={(e) => set({ encounterNotes: e.target.value })}
          style={{ flex: 1 }}
          aria-label="enemy encounter notes"
        />
      </Field>
      {error && <p style={{ color: "#d66" }}>{t.enemy.jsonError(error)}</p>}
      <div>
        <button onClick={save} aria-label="save enemy">
          {t.common.save}
        </button>{" "}
        <button onClick={onCancel} aria-label="cancel enemy edit">
          {t.common.cancel}
        </button>
      </div>
    </section>
  );
}
