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
import Identicon from "../../../components/Identicon";
import QuipuNecklace from "../../../components/QuipuNecklace";
import { TrustPage, getTrustPage } from "../../../lib/trustpage";
import { countryByCode } from "../../../lib/countries";

const day = (u: number) => (u ? new Date(u * 1000).toLocaleDateString(undefined, { year: "numeric", month: "long" }) : "");

export default function MemberPage() {
  const params = useParams();
  const commitment = String(params?.commitment ?? "");
  const [page, setPage] = useState<TrustPage | null>(null);
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

  if (loading) return <p className="muted">Reading the cords…</p>;
  // A page that doesn't resolve reads as a bare page — no "not found" alarm.
  if (!page) return (
    <div className="card">
      <div className="row">
        <Identicon seed={commitment} size={46} />
        <div className="meta"><div className="name">A member</div><div className="sub muted">bare cord</div></div>
      </div>
    </div>
  );

  const country = countryByCode(page.region);
  const vouchLabel =
    page.vouched === "anonymous" ? "Vouched — by two members in good standing (naming no one)"
    : page.vouched === "named" ? "Vouched — two-sponsor admission"
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
              {page.provisional && <span className="badge" style={{ marginLeft: 8 }}>provisional</span>}
            </div>
          </div>
        </div>
        {vouchLabel && (
          <p className="ok-note" style={{ marginBottom: 0, marginTop: 10 }}>✓ {vouchLabel}</p>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Quipu</h3>
        <QuipuNecklace cords={page.cords} />
      </div>

      {/* Presence + bio arrive with the disclosure layer (Epic 5 / F59). Shown
          as not-yet-attested rather than faked — the repo's honest-degradation
          rule. */}
      <div className="card">
        <div className="sub muted">Presence</div>
        <p className="muted" style={{ margin: "4px 0 0" }}>
          Presence attestation (“last stood in circle …”) is not yet wired — it
          needs the ZK presence proof (F59).
        </p>
      </div>

      <p className="muted sm">
        Member since {day(page.issuedAt)}. This page shows only what is vouched
        and shown — never a rating, a score, or a count.
      </p>
    </>
  );
}
