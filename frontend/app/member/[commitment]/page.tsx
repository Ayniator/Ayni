"use client";

// The Quipu Page (Trust Platform Epic 4) — a member's trust page.
//
// Circle-name and region, the vouch-proof (naming no one), the rendered quipu,
// and — as the disclosure layer (Epic 5) lands — the presence line and one-line
// bio. The only "metric" is the one that matters: this person is real, vouched,
// and shows up. NO ratings, reviews, scores, follower counts, or tiers appear
// here — by construction (see lib/trustpage.ts, which never reads or computes
// any). A stranger's page is simply a bare page; nothing signals "hidden".

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import Identicon from "../../../components/Identicon";
import { useT } from "../../../components/SettingsProvider";
import QuipuNecklace from "../../../components/QuipuNecklace";
import { TrustPage, getTrustPage } from "../../../lib/trustpage";
import { getPresence, monthLabel } from "../../../lib/presence";
import { findMyMemberships } from "../../../lib/member";
import { Viewer, mayView, viewerOwns } from "../../../lib/visibility";
import { countryByCode } from "../../../lib/countries";

const day = (u: number) => (u ? new Date(u * 1000).toLocaleDateString(undefined, { year: "numeric", month: "long" }) : "");

export default function MemberPage() {
  const t = useT();
  const params = useParams();
  const { publicKey } = useWallet();
  const commitment = String(params?.commitment ?? "");
  const [page, setPage] = useState<TrustPage | null>(null);
  const [viewer, setViewer] = useState<Viewer>({ circles: new Set(), commitments: new Set() });
  // F59: the month this member last stood in circle, or null. Null renders
  // NOTHING — docs/presence.md §5: an absent record and a member who never
  // attested must look identical, so there is no "not yet attested" line.
  const [presenceMonth, setPresenceMonth] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    getTrustPage(commitment)
      .then((p) => {
        if (!live) return;
        setPage(p);
        // Read by DERIVATION from (circle, commitment) — never enumeration.
        if (p) getPresence(p.circle, commitment).then((m) => live && setPresenceMonth(m)).catch(() => {});
      })
      .catch(() => live && setPage(null))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [commitment]);

  useEffect(() => {
    // The viewer's context: which circles they belong to, and their own
    // commitments. An unconnected visitor is a member of nothing.
    if (!publicKey) { setViewer({ circles: new Set(), commitments: new Set() }); return; }
    let live = true;
    findMyMemberships(publicKey, [])
      .then((mine) => live && setViewer({
        circles: new Set(mine.map((m) => m.circle)),
        commitments: new Set(mine.map((m) => m.commitment)),
      }))
      .catch(() => {});
    return () => { live = false; };
  }, [publicKey]);

  if (loading) return <p className="muted">{t("member.loading")}</p>;
  // A page that doesn't resolve reads as a bare page — no "not found" alarm.
  if (!page) return (
    <div className="card">
      <div className="row">
        <Identicon seed={commitment} size={46} />
        <div className="meta"><div className="name">{t("member.aMember")}</div><div className="sub muted">{t("member.bareCord")}</div></div>
      </div>
    </div>
  );

  const country = countryByCode(page.region);
  const vouchLabel =
    page.vouched === "anonymous" ? t("member.vouchedAnonymous")
    : page.vouched === "named" ? t("member.vouchedNamed")
    : "";

  return (
    <>
      <div className="card">
        <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
          {/* The served avatar if this viewer holds its key, the neutral
              identicon otherwise. Same size, same position, no badge, no
              placeholder that says "hidden" — a member who never published one
              and a member whose avatar you may not open look identical. */}
          {page.avatar ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={page.avatar} alt="" width={56} height={56}
                 style={{ borderRadius: "50%", objectFit: "cover", border: "1px solid var(--border)" }} />
          ) : (
            <Identicon seed={page.commitment} size={56} />
          )}
          <div className="meta" style={{ flex: 1, minWidth: 0 }}>
            <div className="name" style={{ fontSize: 18 }}>{page.circleName}</div>
            <div className="sub muted">
              {country ? country.name : page.region || "—"}
              {page.provisional && <span className="badge" style={{ marginLeft: 8 }}>{t("member.provisional")}</span>}
            </div>
          </div>
        </div>
        {/* The one-line bio, rendered only when it actually decrypted. No
            heading and no empty slot when it did not: an absent line is the
            whole point, not a gap where something obviously used to be. */}
        {page.bio && <p style={{ margin: "10px 0 0", whiteSpace: "pre-wrap" }}>{page.bio}</p>}
        {vouchLabel && (
          <p className="ok-note" style={{ marginBottom: 0, marginTop: 10 }}>✓ {vouchLabel}</p>
        )}
      </div>

      {/* The quipu shows only to its audience. Hidden ≡ absent: a viewer outside
          the audience sees no quipu card and NO "hidden" indicator — identical
          to a member who simply has no cords. */}
      {(viewerOwns(page.commitment, viewer) || mayView(page.quipuTier, page.circle, page.commitment, viewer)) && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t("member.quipu")}</h3>
          <QuipuNecklace cords={page.cords} />
        </div>
      )}

      {/* Bio and avatar above come from the E5 encrypted profile object (F60
          Phase-2): ciphertext on chain, opened only by a viewer who holds the
          element key. Nothing here consults `mayView` — decryption IS the
          decision, so a patched client gains nothing by ignoring a flag. */}

      {/* F59 — the presence line: a month, or NOTHING. The earlier placeholder
          rendered a "not yet attested" card, which docs/presence.md §5 forbids:
          an absent record and a member who never attested must be
          indistinguishable, and a permanent empty card is a signal. The wording
          is the VOUCHING wording — two members attested the month; nobody
          verified attendance. */}
      {presenceMonth !== null && (
        <div className="card">
          <div className="sub muted">{t("member.presence")}</div>
          <p style={{ margin: "4px 0 0" }}>{monthLabel(presenceMonth)}</p>
        </div>
      )}

      <p className="muted sm">
        {t("member.memberSince")} {day(page.issuedAt)}. {t("member.onlyVouched")}
      </p>
    </>
  );
}
