"use client";

import { useEffect, useMemo, useState } from "react";
import Identicon from "../../components/Identicon";
import { listAllCircles, cachedCircles, Circle } from "../../lib/solana";
import { fetchDailyReflection, Reflection, todayKey } from "../../lib/ipfs";
import { getLocalReflections, localReflectionFor } from "../../lib/foundation";
import { defaultReflectionFor, REFLECTION_KEY_SET } from "../../lib/reflections";
import { useT, useSettings } from "../../components/SettingsProvider";

// A single normalised shape the hero renders, whether the entry came from a
// Circle's published collection or the built-in dataset.
interface Display {
  title: string;
  quote: string;
  reflection: string;
  attribution: string; // author / reference line
  source: string;
  denomination?: string;
  step?: string;
  origin: "circle" | "builtin";
  nearest: boolean; // built-in fell back to the nearest day
}

const keyOf = (y: number, m: number, d: number) =>
  `${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * Break a quote into the clauses it was written in — one line each, after a
 * full stop, semicolon, colon or comma. An aphorism set as a single wrapped
 * paragraph reads as prose; set clause per clause it reads at the pace it was
 * meant to be read, which for these texts is the point.
 *
 * The punctuation stays at the end of its line (it belongs to the clause it
 * closes), and a split only happens where whitespace already followed — so
 * decimals, "e.g." and initials are left alone.
 */
function quoteLines(quote: string): string[] {
  return quote
    .split(/(?<=[.;:,])\s+/)
    .map((l) => l.trim())
    .filter(Boolean);
}

export default function Reflections() {
  const t = useT();
  const { lang } = useSettings();

  const [circles, setCircles] = useState<Circle[]>([]);
  const [sel, setSel] = useState<string>("");

  const now = useMemo(() => new Date(), []);
  const [selKey, setSelKey] = useState<string>(todayKey());
  // Calendar view: which month is on screen. Year is only used so weekday
  // columns line up with reality; reflections themselves are year-agnostic.
  const [calYear, setCalYear] = useState<number>(now.getFullYear());
  const [calMonth, setCalMonth] = useState<number>(now.getMonth());

  const [display, setDisplay] = useState<Display | null>(null);
  const [loading, setLoading] = useState(false);
  // The built-in dataset is fetched (frontend/public/reflections.json — it is
  // deliberately not in the bundle), so the very first resolution is async and
  // the hero has nothing to render yet. Two states rather than one, because
  // "still arriving" and "did not arrive" must not look the same to a reader.
  const [builtinPending, setBuiltinPending] = useState(true);
  const [builtinFailed, setBuiltinFailed] = useState(false);

  // Discover Circles that publish reflections (published CID or a locally
  // composed collection). The page works with none — it falls back to built-ins.
  useEffect(() => {
    const pickDaily = (cs: Circle[]) => {
      const withDaily = cs.filter(
        (c) => c.dailyReflectionsCid || Object.keys(getLocalReflections(c.circle)).length > 0
      );
      setCircles(withDaily);
      setSel((prev) => prev || (withDaily[0]?.pubkey ?? ""));
    };
    const cached = cachedCircles();
    if (cached.length) pickDaily(cached);
    listAllCircles().then(pickDaily).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve the reflection for the selected day: the chosen Circle's entry if it
  // has one, otherwise the built-in reflection (exact day or nearest).
  useEffect(() => {
    let cancelled = false;
    const key = selKey;
    const circle = circles.find((x) => x.pubkey === sel) || null;

    const asCircle = (r: Reflection): Display => ({
      title: r.title,
      quote: r.quote,
      reflection: r.reflection,
      attribution: r.source,
      source: r.source,
      origin: "circle",
      nearest: false,
    });
    const builtin = async (): Promise<Display | null> => {
      // Sourced texts are shown in the member's language where a translation
      // exists; English is the source of record and the fallback.
      const res = await defaultReflectionFor(key, lang);
      if (!res) return null;
      const e = res.entry;
      return {
        title: e.title,
        quote: e.quote,
        reflection: e.reflection,
        attribution: e.author,
        source: e.source,
        denomination: e.denomination,
        step: e.step,
        origin: "builtin",
        nearest: !res.exact,
      };
    };

    // Instant path first: a Circle's locally composed entry is synchronous.
    if (circle) {
      const local = localReflectionFor(circle.circle, key);
      if (local) {
        setDisplay(asCircle(local));
        setLoading(false);
        return;
      }
    }

    // Both remaining sources are async, and the Circle's entry outranks the
    // built-in whichever finishes first — without this flag a slow dataset
    // fetch could land after the IPFS entry and demote it.
    let upgraded = false;

    // Show the built-in as soon as it resolves so there's never a blank screen…
    setBuiltinPending(true);
    builtin()
      .then((d) => {
        if (cancelled || upgraded) return;
        setDisplay(d);
        setBuiltinPending(false);
        setBuiltinFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setBuiltinPending(false);
        setBuiltinFailed(true);
      });
    // …and, if the Circle has a remote collection, upgrade to its entry.
    if (circle?.dailyReflectionsCid) {
      setLoading(true);
      fetchDailyReflection(circle.dailyReflectionsCid, key)
        .then((r) => {
          if (cancelled) return;
          if (r) {
            upgraded = true;
            setDisplay(asCircle(r));
          }
          setLoading(false);
        })
        .catch(() => {
          if (!cancelled) setLoading(false);
        });
    } else {
      setLoading(false);
    }
    return () => {
      cancelled = true;
    };
  }, [selKey, sel, circles, lang]);

  const selCircle = circles.find((c) => c.pubkey === sel) || null;

  // The date shown under the title. selKey is a MM-DD; render it on the calendar
  // year so the weekday is meaningful, and localise the whole thing.
  const [selM, selD] = selKey.split("-").map((n) => parseInt(n, 10));
  const shownDate = new Date(calYear, selM - 1, selD);
  const longDate = (() => {
    try {
      return shownDate.toLocaleDateString(lang, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch {
      return shownDate.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      });
    }
  })();

  return (
    <>
      <h1>{t("reflections.title")}</h1>
      <p className="lede">{t("reflections.lede")}</p>

      {circles.length > 0 && (
        <div className="row" style={{ marginBottom: 16, alignItems: "center", gap: 10 }}>
          <Identicon seed={selCircle?.circle || sel} size={34} />
          <select
            aria-label={t("reflections.circlePickerLabel")}
            value={sel}
            onChange={(e) => setSel(e.target.value)}
          >
            {circles.map((c) => (
              <option key={c.pubkey} value={c.pubkey}>
                {c.name || t("reflections.circleFallback")} {c.city ? `· ${c.city}` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Never a blank hero: while the built-in dataset is on its way (and it is
          fetched, not bundled), say so; if it never arrives, say that instead of
          leaving the reader looking at an empty page. */}
      {!display && builtinPending && (
        <p className="muted sm" style={{ marginBottom: 16 }}>{t("reflections.loading")}</p>
      )}
      {!display && !builtinPending && builtinFailed && (
        <p className="muted sm" style={{ marginBottom: 16 }}>{t("reflections.loadFailed")}</p>
      )}

      {display && (
        <article className="card refl-hero">
          <div className="refl-badges">
            <span className={`badge ${display.origin === "circle" ? "refl-badge-circle" : "refl-badge-builtin"}`}>
              {display.origin === "circle" ? t("reflections.circleBadge") : t("reflections.builtinBadge")}
            </span>
            {display.denomination && <span className="badge refl-badge-denom">{display.denomination}</span>}
            {display.step && (
              <span className="badge refl-badge-step">
                {t("reflections.stepLabel")} {display.step}
              </span>
            )}
          </div>

          <h2 className="refl-title">{display.title}</h2>
          <div className="refl-date">{longDate}</div>

          <blockquote className="refl-quote">
            {quoteLines(display.quote).map((line, i, all) => (
              <span key={i} style={{ display: "block" }}>
                {i === 0 ? "“" : ""}
                {line}
                {i === all.length - 1 ? "”" : ""}
              </span>
            ))}
          </blockquote>
          {display.attribution && <div className="refl-attrib">— {display.attribution}</div>}

          {display.reflection && (
            <div className="refl-body">
              <h3 className="refl-body-h">{t("reflections.reflectionHeading")}</h3>
              <p>{display.reflection}</p>
            </div>
          )}

          {(display.source || display.nearest) && (
            <div className="refl-foot">
              {display.nearest && <div className="refl-nearest">{t("reflections.nearest")}</div>}
              {display.source && display.source !== display.attribution && (
                <div className="refl-source sm muted">
                  {t("reflections.sourceLabel")}: {display.source}
                </div>
              )}
            </div>
          )}
        </article>
      )}

      <Calendar
        year={calYear}
        month={calMonth}
        selKey={selKey}
        todayK={todayKey()}
        lang={lang}
        onPrev={() => {
          const m = calMonth - 1;
          if (m < 0) {
            setCalMonth(11);
            setCalYear(calYear - 1);
          } else setCalMonth(m);
        }}
        onNext={() => {
          const m = calMonth + 1;
          if (m > 11) {
            setCalMonth(0);
            setCalYear(calYear + 1);
          } else setCalMonth(m);
        }}
        onToday={() => {
          setCalYear(now.getFullYear());
          setCalMonth(now.getMonth());
          setSelKey(todayKey());
        }}
        onPick={(m, d) => setSelKey(keyOf(calYear, m, d))}
        labels={{
          heading: t("reflections.cal.heading"),
          prev: t("reflections.cal.prev"),
          next: t("reflections.cal.next"),
          today: t("reflections.cal.today"),
          hasEntry: t("reflections.cal.hasEntry"),
        }}
      />
      {loading && <p className="muted sm" style={{ marginTop: 10 }}>{t("reflections.fetching")}</p>}
    </>
  );
}

function Calendar(props: {
  year: number;
  month: number;
  selKey: string;
  todayK: string;
  lang: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onPick: (month: number, day: number) => void;
  labels: { heading: string; prev: string; next: string; today: string; hasEntry: string };
}) {
  const { year, month, selKey, todayK, lang, labels } = props;

  const monthName = (() => {
    try {
      return new Date(year, month, 1).toLocaleDateString(lang, { month: "long", year: "numeric" });
    } catch {
      return new Date(year, month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
    }
  })();

  // Localised, week-starting-Monday weekday initials.
  const weekdays = useMemo(() => {
    const out: string[] = [];
    // 2024-01-01 is a Monday.
    for (let i = 0; i < 7; i++) {
      const d = new Date(2024, 0, 1 + i);
      let lbl: string;
      try {
        lbl = d.toLocaleDateString(lang, { weekday: "short" });
      } catch {
        lbl = d.toLocaleDateString(undefined, { weekday: "short" });
      }
      out.push(lbl);
    }
    return out;
  }, [lang]);

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Leading blanks so day 1 lands under its weekday (Monday-first grid).
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // 0 = Monday
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const mm = String(month + 1).padStart(2, "0");

  return (
    <section className="card refl-cal" aria-label={labels.heading}>
      <div className="refl-cal-head">
        <h3 style={{ margin: 0 }}>{labels.heading}</h3>
        <div className="refl-cal-nav">
          <button className="btn btn-sm btn-ghost" onClick={props.onPrev} aria-label={labels.prev}>‹</button>
          <span className="refl-cal-month">{monthName}</span>
          <button className="btn btn-sm btn-ghost" onClick={props.onNext} aria-label={labels.next}>›</button>
          <button className="btn btn-sm" onClick={props.onToday}>{labels.today}</button>
        </div>
      </div>

      <div className="refl-cal-grid refl-cal-dow">
        {weekdays.map((w, i) => (
          <div key={i} className="refl-cal-dowcell">{w}</div>
        ))}
      </div>
      <div className="refl-cal-grid">
        {cells.map((d, i) => {
          if (d === null) return <div key={i} className="refl-cal-cell refl-cal-empty" />;
          const key = `${mm}-${String(d).padStart(2, "0")}`;
          const isToday = key === todayK;
          const isSel = key === selKey;
          const has = REFLECTION_KEY_SET.has(key);
          return (
            <button
              key={i}
              className={`refl-cal-cell${isSel ? " is-sel" : ""}${isToday ? " is-today" : ""}`}
              onClick={() => props.onPick(month, d)}
              aria-pressed={isSel}
              aria-label={has ? `${d} — ${labels.hasEntry}` : String(d)}
            >
              <span>{d}</span>
              {has && <span className="refl-cal-dot" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </section>
  );
}
