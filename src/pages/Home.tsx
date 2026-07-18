import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../api";
import { useT } from "../i18n";
import { LanguageSwitch } from "../components/LanguageSwitch";
import { SOURCE_URL } from "../lib/source";

type Created = { playerToken: string; dmToken: string };
type CopyTarget = "player" | "dm";
type CopyStatus = { target: CopyTarget; succeeded: boolean } | null;

const RUNES = ["✦", "❖", "✧", "♦", "✶", "✦", "❖", "✧", "♦", "✶", "✦", "❖"];
const NAV_SECTIONS = ["b-flow", "b-roles", "b-features", "b-authority"] as const;

// Custom easing (not `scroll-behavior: smooth`) so long jumps take
// proportionally longer and land with breathing room below the fixed header.
function glideTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const HEADER = 72;
  const BREATHING = 26;
  const target = Math.max(0, el.getBoundingClientRect().top + window.scrollY - HEADER - BREATHING);
  const from = window.scrollY;
  const dist = target - from;
  if (Math.abs(dist) < 2) return;
  const dur = Math.min(1200, Math.max(550, Math.abs(dist) * 0.55));
  const t0 = performance.now();
  const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const step = (now: number) => {
    const p = Math.min(1, (now - t0) / dur);
    window.scrollTo(0, from + dist * ease(p));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Fades each `[data-rv]` section in on scroll-enter and back out on
// scroll-exit (either direction), so scrolling back up replays it. Skipped
// entirely under reduced motion, and no-ops if the browser (or jsdom in
// tests) lacks IntersectionObserver.
function useSectionReveal(containerRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    if (typeof IntersectionObserver === "undefined") return;
    if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const sections = root.querySelectorAll<HTMLElement>("[data-rv]");
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const el = entry.target as HTMLElement;
          if (entry.isIntersecting) {
            el.style.opacity = "1";
            el.style.transform = "none";
          } else {
            const below = entry.boundingClientRect.top > 0;
            el.style.opacity = "0";
            el.style.transform = below ? "translateY(30px)" : "translateY(-24px)";
          }
        });
      },
      { threshold: 0.1, rootMargin: "-4% 0px -4% 0px" },
    );
    sections.forEach((el) => {
      el.style.transition = "opacity 0.7s ease, transform 0.7s ease";
      if (el.getBoundingClientRect().top > window.innerHeight * 0.92) {
        el.style.opacity = "0";
        el.style.transform = "translateY(30px)";
      }
      io.observe(el);
    });
    return () => io.disconnect();
  }, [containerRef]);
}

/**
 * Landing page: a DM creates a Game and receives two URLs — a secret DM URL
 * (Backstage) and a shareable player URL (Frontstage). No login. "Summoning
 * Altar" design (docs/handoffs/design_handoff_home_altar).
 */
export function Home() {
  const t = useT();
  const create = useMutation(api.games.create);
  // Demo-only copy must wait for the backend PLAYGROUND_MODE gate. Undefined
  // while loading is intentionally treated as private/self-hosted: no guessing.
  const deployment = useQuery(api.games.getDeploymentMode, {}) as
    | { playgroundMode: boolean }
    | undefined;
  const [created, setCreated] = useState<Created | null>(null);
  const [busy, setBusy] = useState(false);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>(null);
  const [openFeature, setOpenFeature] = useState(0);
  const mainRef = useRef<HTMLElement | null>(null);
  useSectionReveal(mainRef);

  const origin = window.location.origin;
  const playerUrl =
    created === null ? "" : `${origin}/play/${created.playerToken}`;
  const dmUrl =
    created === null
      ? ""
      : `${origin}/dm/${created.playerToken}/${created.dmToken}`;

  const copyUrl = async (target: CopyTarget, url: string) => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(url);
      setCopyStatus({ target, succeeded: true });
    } catch {
      setCopyStatus({ target, succeeded: false });
    }
  };

  const createGame = async () => {
    setBusy(true);
    try {
      // Ritual acceleration must run at least ~1.2s even if the mutation
      // resolves instantly, so the magic circle's flare reads as intentional.
      const [result] = await Promise.all([
        create({}) as Promise<Created>,
        new Promise((resolve) => setTimeout(resolve, 1200)),
      ]);
      setCreated(result);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="wt wt-home-altar" ref={mainRef}>
      <header className="wt-altar-bar">
        <span className="wt-altar-bar-mark">❖ WAR TABLE 5E</span>
        <nav className="wt-altar-bar-nav" aria-label={t.home.journeyTitle}>
          {([
            [NAV_SECTIONS[0], t.home.navFlow],
            [NAV_SECTIONS[1], t.home.navRoles],
            [NAV_SECTIONS[2], t.home.navFeatures],
            [NAV_SECTIONS[3], t.home.navAuthority],
          ] as const).map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              onClick={(e) => {
                e.preventDefault();
                glideTo(id);
              }}
            >
              {label}
            </a>
          ))}
        </nav>
        <LanguageSwitch className="wt-altar-bar-lang" />
      </header>

      <section className="wt-altar-hero">
        <p className="wt-altar-eyebrow">{t.home.eyebrow}</p>
        <h1 className="wt-altar-title">
          <span>{t.home.titleLine1}</span>
          <wbr />
          <span>{t.home.titleLine2}</span>
        </h1>
        <p className="wt-altar-lede">
          {t.home.lede}
          <br />
          <span>{t.home.noLogin}</span>
        </p>

        <div className={`wt-altar-circle${busy ? " wt-altar-fast" : ""}`}>
          <div className="wt-altar-ring-outer" />
          <div className="wt-altar-ring-ticks" />
          <div className="wt-altar-ring-sweep" />
          <div className="wt-altar-ring-plain" />
          <div className="wt-altar-ring-star">
            <div className="wt-altar-star-a" />
            <div className="wt-altar-star-b" />
          </div>
          <div className="wt-altar-ring-glow" />
          <div className="wt-altar-ring-runes">
            {RUNES.map((ch, i) => (
              <span
                key={i}
                style={{ transform: `translate(-50%, -50%) rotate(${i * 30}deg) translateY(-9.6em)` }}
              >
                {ch}
              </span>
            ))}
          </div>
          <div className="wt-altar-ring-inner-dashed" />
          <div className={`wt-altar-center${busy ? " wt-altar-flaring" : ""}`}>
            {created === null ? (
              <button
                className="wt-altar-cta"
                disabled={busy}
                onClick={() => void createGame()}
              >
                <span className="wt-altar-cta-glyph" aria-hidden="true">✦</span>
                {busy ? t.home.creating : t.home.createGame}
              </button>
            ) : (
              <span className="wt-altar-center-glyph">❖</span>
            )}
          </div>
        </div>

        {created === null && (
          <>
            <strong className="wt-altar-linkmodel">{t.home.linkModel}</strong>
            {deployment?.playgroundMode === true && (
              <aside className="wt-altar-playground" role="note">
                <strong>{t.home.playgroundTitle}</strong>
                <p>{t.home.playgroundBanner}</p>
              </aside>
            )}
          </>
        )}

        {created !== null && (
          <div className="wt-altar-result">
            <p role="status" className="wt-altar-result-status">
              {t.home.created}
            </p>
            <div className="wt-altar-cards">
              <section aria-labelledby="player-url-title" className="wt-altar-card">
                <div>
                  <h3 id="player-url-title">🛡 {t.home.playerUrlTitle}</h3>
                  <a href={playerUrl}>{playerUrl}</a>
                </div>
                <button
                  className="wt-altar-card-copy"
                  onClick={() => void copyUrl("player", playerUrl)}
                  aria-label={t.home.copyPlayerAria}
                  aria-live="polite"
                >
                  {copyStatus?.target === "player"
                    ? copyStatus.succeeded
                      ? t.home.copied
                      : t.home.copyFailed
                    : t.home.copy}
                </button>
              </section>

              <section
                aria-labelledby="dm-url-title"
                className="wt-altar-card wt-altar-card-dm"
              >
                <div>
                  <h3 id="dm-url-title">🗝 {t.home.dmUrlTitle}</h3>
                  <a href={dmUrl}>{dmUrl}</a>
                </div>
                <button
                  className="wt-altar-card-copy"
                  onClick={() => void copyUrl("dm", dmUrl)}
                  aria-label={t.home.copyDmAria}
                  aria-live="polite"
                >
                  {copyStatus?.target === "dm"
                    ? copyStatus.succeeded
                      ? t.home.copied
                      : t.home.copyFailed
                    : t.home.copy}
                </button>
                <p className="wt-altar-card-secrecy">
                  <strong>{t.home.secrecyLabel}</strong>
                  {t.home.secrecyWarning}
                </p>
              </section>
            </div>
          </div>
        )}
      </section>

      <section id="b-flow" data-rv="1" className="wt-altar-section">
        <span aria-hidden="true" className="wt-altar-numeral">I</span>
        <p className="wt-altar-kicker">{t.home.fieldProcedure}</p>
        <h2>{t.home.journeyTitle}</h2>
        <ol className="wt-altar-journey">
          {t.home.journey.map((step) => (
            <li key={step.label}>
              <span>{step.label}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="wt-altar-note">{t.home.loopLede}</p>
        <ul className="wt-altar-chips">
          {t.home.combatLoop.map((step) => (
            <li key={step.label}>
              <span title={step.body}>
                {step.label} · {step.title}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section id="b-roles" data-rv="1" className="wt-altar-section">
        <span aria-hidden="true" className="wt-altar-numeral">II</span>
        <p className="wt-altar-kicker">{t.home.accessModel}</p>
        <h2>{t.home.rolesTitle}</h2>
        <div className="wt-altar-roles">
          <article>
            <span>🛡 PLAYER · FRONTSTAGE</span>
            <h3>{t.home.playerRoleTitle}</h3>
            <p>{t.home.playerRoleBody}</p>
            <strong>{t.home.playerTrust}</strong>
          </article>
          <article className="wt-altar-role-dm">
            <span>🗝 DM · BACKSTAGE</span>
            <h3>{t.home.dmRoleTitle}</h3>
            <p>{t.home.dmRoleBody}</p>
          </article>
        </div>
      </section>

      <section id="b-features" data-rv="1" className="wt-altar-section">
        <span aria-hidden="true" className="wt-altar-numeral">III</span>
        <p className="wt-altar-kicker">{t.home.toolkitIndex}</p>
        <h2>{t.home.featuresTitle}</h2>
        <p className="wt-altar-accordion-hint">{t.home.accordionHint}</p>
        <div className="wt-altar-accordion">
          {t.home.features.map((feature, i) => (
            <div
              key={feature.title}
              className={`wt-altar-accordion-row${openFeature === i ? " is-open" : ""}`}
            >
              <button
                type="button"
                className="wt-altar-accordion-trigger"
                aria-expanded={openFeature === i}
                onClick={() => setOpenFeature(openFeature === i ? -1 : i)}
              >
                <span className="wt-altar-accordion-chevron" aria-hidden="true">❖</span>
                <b>{feature.title}</b>
              </button>
              <div className="wt-altar-accordion-body">
                <p>{feature.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="b-authority" data-rv="1" className="wt-altar-section">
        <span aria-hidden="true" className="wt-altar-numeral">IV</span>
        <p className="wt-altar-kicker">{t.home.tableAuthority}</p>
        <h2>{t.home.manualTitle}</h2>
        <p className="wt-altar-manual-body">{t.home.manualBody}</p>
        <div className="wt-altar-authority-grid">
          <article>
            <h3>{t.home.realtimeTitle}</h3>
            <p>{t.home.realtimeBody}</p>
          </article>
          <article>
            <h3>{t.home.limitsTitle}</h3>
            <p>{t.home.limitsBody}</p>
          </article>
        </div>
        <footer className="wt-altar-footer">
          <span>{t.home.licenseNote}</span>
          <a href={SOURCE_URL} target="_blank" rel="noreferrer noopener">
            {t.home.sourceLink}
          </a>
        </footer>
      </section>
    </main>
  );
}
