# App theming (`.wt` scope) — zero-specificity base layer, controls inherit by default, opt out per-control

`src/warTable.css` themes everything inside a `.wt` scope with a base layer of zero-specificity element rules (`.wt :where(button)`, `.wt :where(input)`, `.wt :where(h1)`…, etc.) so every control **inherits the gothic Ritual Sigil look by default** — chamfered corners, violet-crimson theming, hover glow, disabled style, Noto Sans TC bold. Component-local rules win automatically (the base is specificity 0), so deliberately-shaped controls **opt out per-control** (e.g. resource pips that are precise squares/diamonds/circles use `clip-path: none` to keep their shape).

## Decision

The theming architecture is **"default theme + per-control opt-out,"** not "explicit theme per control." Every control inside `.wt` inherits the gothic theme unless it explicitly opts out. `:where()` (zero specificity) is the mechanism that makes inherit-by-default / opt-out work cleanly.

**Scope amendment (2026-07-13, PR #58): `.wt` is the app-wide theme scope, not a War-Table-only one.** The landing page — the first screen a DM sees, and the only one that had no UI at all (black Times New Roman on near-black, ~1.2:1 contrast) — joined the same base layer rather than getting styles of its own (`src/pages/Home.tsx:43`, `className="wt wt-home"`). It inherits the theme by entering the scope; its handful of `wt-home-*` rules are ordinary per-control specialization, not a second system. The file keeps its `warTable.css` name (renaming it is churn with no reader benefit), so treat the name as historical: the *scope* is `.wt`, and any new full-page surface joins it the same way.

## Why

This produces player-visible **visual cohesion**: every generic button (Kill/Remove/Save/claim/reroll/advance/etc.) looks like it belongs to one design system without each button being individually styled, while deliberately-shaped controls break out. The alternative — explicit styles per control — would either duplicate the theme everywhere (drift, inconsistency) or leave generic buttons unstyled (visual incohesion).

## Considered options

- **Explicit theme per control.** Rejected — duplicates the theme across every component and drifts; generic buttons end up unstyled.
- **A CSS-in-JS / styled-components layer.** Rejected — overkill at this scale, and the TTS tablet's old Chromium (ADR-0006) favors plain CSS.

## Standing constraint (footgun — in-code, not ADR-level)

Bare single-class button rules (`.foo`) can tie with `.wt :where(button)` and lose in the **minified production** CSS (dev hides it, which makes it nasty to debug). Use `button.classname` (element+class) for specificity-dependent button overrides. This is documented at the top of `warTable.css` and in the `warTable-css-specificity-gotcha` memory; it stays in-code as the source of truth, not duplicated here.

## Consequence for future work

New controls inside `.wt` get the gothic theme for free (inherit); only shape-specific controls need an explicit opt-out. A new full-page surface joins the scope (put `.wt` on its root) rather than bringing its own styles — that is what the landing page did. Do not introduce a competing theming layer alongside the `:where()` base. Keep the base rules at zero specificity so component-local overrides keep winning.

One consequence the i18n work (ADR-0016) inherits: `.wt` sets Noto Sans TC for both languages, and English text in the same containers runs longer than Chinese — the theme is the layer that has to absorb that, not each component.
