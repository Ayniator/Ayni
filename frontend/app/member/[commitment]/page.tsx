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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    getTrustPage(commitment)
      .then((p) => live && setPage(p))
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
          <Identicon seed={page.commitment} size={56} />
          <div className="meta" style={{ flex: 1, minWidth: 0 }}>
            <div className="name" style={{ fontSize: 18 }}>{page.circleName}</div>
            <div className="sub muted">
              {country ? country.name : page.region || "—"}
              {page.provisional && <span className="badge" style={{ marginLeft: 8 }}>{t("member.provisional")}</span>}
            </div>
          </div>
        </div>
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

      {/* The stone-mark avatar is served from the E5 encrypted profile object
          (F60) — not yet built, so a visitor sees the neutral silhouette (a bare
          triangle, never a lock). The audience is the avatar tier; when the
          served object lands, a permitted viewer gets the real mark here. */}

      {/* Presence + bio arrive with the disclosure layer (Epic 5 / F59). Shown
          as not-yet-attested rather than faked — the repo's honest-degradation
          rule. */}
      <div className="card">
        <div className="sub muted">{t("member.presence")}</div>
        <p className="muted" style={{ margin: "4px 0 0" }}>
          {t("member.presenceNotWired")}
        </p>
      </div>

      <p className="muted sm">
        {t("member.memberSince")} {day(page.issuedAt)}. {t("member.onlyVouched")}
      </p>
    </>
  );
}
