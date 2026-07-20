import { useState } from "react";
import { useT } from "../i18n";
import type { ProfOption } from "../lib/srdContent";

/**
 * A proficiency picker: chips for the current list + a dropdown to add from
 * an SRD option table (or open a homebrew text slot). Shared by the builder's
 * profs step and the card's 熟練 page — the underlying state stays a plain
 * string[] either way, this only changes how it's edited.
 */
export function ProfPicker({
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
