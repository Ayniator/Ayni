AHA Trust Platform — Product Backlog
Version 0.1 — August 2026 — Working draft for the Ascend Team
> **Amendment v0.2 (2026-08-10, per ElectaZ):** Epic 1 refined — the two sponsors
> are now asymmetric: the **main sponsor (parrain)** may be any member in good
> standing, while the **second attestation must come from one of the Circle's
> seven trusted servants** (a Council seat holder). Epic 1 below carries the
> amended text; everything else is the faithful extraction of the v0.1 .docx.

# 0. Guiding Principle
“The chain proves, the device knows, the circle sees.” Public infrastructure holds only anonymous proofs; relationships live encrypted on the member’s device; faces and stories are disclosed deliberately, person by person. Nothing comparative, nothing aggregated, nothing a newcomer lacks in a way that ranks them. Trust must be verifiable in ten seconds before you meet a stranger — but through vouching and presence, never through ratings.
## Epic 0 — The Faucet — First Gas for the Neophyte
Goal: Each circle operates a faucet that grants a newly admitted member a small fraction of SOL, one single time, so they can pay their first transaction fees. Activated only by the newcomer’s parrain, monitored by the circle’s treasurer, refilled only by circle vote.
User stories:
- As a parrain, I can activate the faucet exactly once for the neophyte I sponsor; no one else can trigger a grant for them.
- As a neophyte, I receive one grant, one time, ever — enforced on-chain via a nullifier tied to my identity commitment, so uniqueness is proven without revealing who I am.
- As the treasurer, I am the only role able to modify the grant amount, within the absolute on-chain maximum.
- As the treasurer, I can see the remaining balance of the faucet jar at any time, and call a circle vote to refill it from the treasury.
- As the treasurer, I can review every faucet transaction with the one-time pseudonymous codes of parrain and neophyte — codes, never identities, and this ledger lives encrypted off-chain, visible to the treasurer role alone.
Analysis:
- Minimum viable grant (estimate): a fresh Solana wallet needs the rent-exempt minimum (≈0.0009 SOL) plus transaction fees (0.000005 SOL each). A grant of 0.0015–0.002 SOL funds account creation plus well over one hundred transactions — roughly USD 0.20–0.30 at recent prices. Recommended default: 0.0015 SOL.
- Absolute maximum: the equivalent of USD 0.25, set at the top-circle level and enforced by the on-chain program itself, not by the UI — the treasurer adjusts within it, never above it. Since SOL/USD moves, the cap is stored in lamports and revised at each equinox by top-circle vote rather than tracked by a live price oracle (an oracle is an attack surface the faucet does not need).
- Abuse resistance: one-grant-per-identity-commitment via nullifier (a member who re-applies is refused by the program, not by policy); activation requires a valid parrain attestation; per-circle jar caps the blast radius — a compromised faucet loses one jar, not the treasury; refill requires a vote, so drains are noticed at circle scale.
- Hack resistance: the jar is a program-derived account with the cap, the one-shot rule, and the parrain-attestation check enforced in the program; treasurer authority is a role key that can be rotated by circle vote; the program should be audited and fuzzed before mainnet (fold into Sentinel Layer C).
- Anonymity tension — flagged honestly: (a) a treasurer ledger linking parrain and neophyte is a recorded sponsor edge, which Epic 2 exists to prevent; therefore the ledger must use one-time codes meaningless outside the treasurer’s encrypted view, never names, wallets, or membership commitments. (b) On a public chain, every wallet the faucet funds is visibly marked as fellowship-adjacent to any outside observer. Mitigations: uniform grant size, randomized disbursement timing, and — the cleaner alternative worth deciding in Epic 10 — a fee-payer/relayer model where the circle pays gas on the neophyte’s behalf and no SOL transfer to their wallet ever appears on chain.
- Traditions check: the faucet is circle-level mutual aid (T7, self-supporting circles); the vote-to-refill keeps the treasurer a trusted servant, not a governor (T2, T9).
Effort: Medium — the program is small but must be audit-grade; the treasurer view and vote flow are straightforward.
Depends on: Epic 1 (parrain attestation), Epic 2 (nullifiers) for the anonymous form; a pilot version can use named-pilot attestations. First epic in build order: nothing else on chain works for a new member until they can pay gas.
## Epic 1 — Two-Sponsor Admission *(amended v0.2)*
Goal: Every member enters through two attestations from people who have met them in person — one from their **main sponsor (parrain)**, who may be any member in good standing, and one from a **trusted servant**: any holder of one of the Circle’s seven service roles (the Council seats). Sponsorship is the fellowship’s proof of humanity and its Sybil resistance; the servant’s co-attestation anchors every admission in the Circle’s service structure.
User stories:
- As a newcomer, I am admitted when my parrain and one of the Circle’s seven trusted servants have both attested for me, without either name being recorded anywhere visible.
- As a parrain (any member in good standing), I can attest for the newcomer I sponsor with one action after meeting them in a circle.
- As a trusted servant (any of the seven seats), I can co-attest a newcomer’s admission with one action — as a service function, not a worthiness screen; and I cannot be the same person as the parrain.
- As a circle, we can verify a visiting member holds a valid admission without learning who sponsored them.
Analysis:
- Human vouching is how AA solved trust for ninety years; bots do not attend ceremonies.
- The asymmetric pair strengthens Sybil resistance beyond two free-choice sponsors: forging an admission now requires capturing a **service role**, and seats are circle-elected (anonymous ballot, F28) and rotatable — collusion must go through the group conscience. It also matches lived onboarding (Epic 9): the parrain attests live; the servant’s co-attestation arrives asynchronously, and until it does the newcomer is a provisional member.
- **Distinct-persons rule:** a parrain who also holds a seat cannot self-co-attest; the two attestations must come from two different memberships, enforced in the program.
- The sponsor relationship keeps its ceremonial expression: the parrain ties the quipu knot, not the wearer.
- Anonymity note for the ZK form (Epic 2): the vouch-proof becomes two proofs — "a member in good standing attested" (anonymity set: the whole membership) and "a trusted servant attested" (anonymity set: the 7 seats). Seven is a small set; the proof must name the *role class*, never the seat index, and seat rotation over time further blurs it. This is an accepted, honest trade: the servant edge is what makes admissions legible to the circle’s structure.
- Continuity with what is built: the Scribe-Secretary-gated `issue_membership` (F4) is already a seat attestation — Epic 1 generalizes it to any-of-7 and adds the parrain’s attestation beside it, rather than replacing the model.
- Recovery synergy (Epic 8): "recover through my two sponsors" becomes parrain + any current holder of a service role — more robust than a named second person, because the role persists even when its holder rotates out.
- Traditions check: consistent with Tradition 3 (only requirement is the desire to ask the question) — sponsorship verifies humanity, it does not screen worthiness; the servant co-attests as a **trusted servant, not a governor** (T2), and the service structure remains directly responsible to those it serves (T9).
Effort: Medium — the flow is simple; the anonymity of it depends on Epic 2.
Depends on: Epic 2 (ZK vouch-proofs) for the anonymous form; a named interim version could ship earlier for pilot circles. Seat elections (F28, shipped) give the servant attestation its legitimacy.
## Epic 2 — Zero-Knowledge Vouch-Proofs
Goal: Prove “this member was vouched by two members in good standing” cryptographically, revealing nothing about who the sponsors are.
User stories:
- As a member, my page carries a verifiable vouch-proof that names no one.
- As anyone in the fellowship, I can verify a vouch-proof in seconds without walking any graph.
- As a sponsor, my attestation can never be extracted, subpoenaed, or mined from public data.
Analysis:
- Semaphore (existing ZK group-membership protocol) covers most of this off the shelf: prove membership of a group without revealing which member you are.
- The trust graph exists mathematically (Sybil resistance intact) but no one can map the fellowship — this is the technical embodiment of Tradition 12.
- Open question folded into Epic 10: whether the proof anchor lives on Solana, another chain, or a simpler append-only log.
Effort: Large — months, not weeks. The single biggest technical investment in the backlog.
Depends on: Epic 10 decisions (infrastructure, quantum resistance).
## Epic 3 — The Quipu — Physical Necklace
Goal: A knotted-cord milestone system: one pendant cord per step completed, colored by the step’s alchemical stage, with the date encoded as Inca-style knot clusters.
User stories:
- As a member, I receive a cord in the step’s alchemical color when I complete a step, tied by my sponsor as the closing act of the ceremony.
- As a member, I can learn to read knot-dates through a one-page guide shared inside the fellowship.
- As a newcomer, I wear the bare necklace cord — a beginning, not an absence.
Analysis:
- Pre-algorithmic record-keeping: memory in fiber, legible only to taught hands — a mystery worn in public, which suits Tradition 11 (attraction, not promotion).
- Colors follow the alchemical sequence already mapped in the Emerald correspondence table: nigredo black (Steps 1–2), albedo white (middle steps), citrinitas yellow (≈8–9), rubedo red (10–12); exact mapping to be finalized against the table.
- Milestones are binary and personal — you walked it or you have not. Nothing to compare or game.
Effort: Small — the color mapping is an afternoon; the knot-date scheme and reading guide are a short document.
Depends on: Emerald correspondence table (exists; needs the color column confirmed).
## Epic 4 — The Quipu Page (Trust Page)
Goal: Each member’s digital page: circle-name and region, vouch-proof, rendered quipu, service history, presence attestation, and a one-line bio — with no ratings, reviews, scores, or counts anywhere.
User stories:
- As a member, my page shows my quipu as it hangs — cords and knot-dates, never a fraction or progress bar.
- As a member, my service is listed with dates (hosted the equinox fire, drummed for the descents) and never summed into a total.
- As a member, my presence line (“last stood in circle: March 2026”) is attested by ZK proof from the circle, not by a named witness.
- As a member, I write one free-text line — my answer-in-progress to “Who do you think you are?” — rewritable anytime.
Analysis:
- Replaces the rating mechanic of marketplace platforms with the only metric that matters: this person is real, vouched, and shows up in rooms with other humans.
- Deliberately absent: ratings, reviews, comments about the person, follower counts, comparisons, verification tiers.
- Traditions check: nothing on the page lets personalities creep ahead of principles (Tradition 12).
Effort: Medium — straightforward front-end once Epics 2 and 5 exist.
Depends on: Epic 2 (vouch-proof), Epic 5 (visibility), Epic 3 (quipu data model).
## Epic 5 — Per-Element Visibility Settings
Goal: Each member controls, per element (avatar, quipu, bio), who may see it: all members, my circle, or chosen ones.
User stories:
- As a member, I set visibility independently for my avatar, my quipu, and my bio.
- As a member, everything defaults to “my circle” on day one; opening up is a deliberate act.
- As a viewer, I cannot tell that something is hidden from me — a stranger’s view is simply a bare page.
Analysis:
- Defaults matter more than options: the protective default gives disclosure social meaning, like being told a name in a first-names-only program.
- “No locked-door indicators” keeps a newcomer’s sparse page and a private elder’s page identical — quietly egalitarian.
- Circle-level visibility requires ZK membership proof (Semaphore again) or it quietly rebuilds the social map Epic 2 hid.
- Nothing is ever visible to the public internet — “all members” is the widest audience that exists.
Effort: Medium — the policy engine is simple; the private circle-membership check inherits Epic 2’s machinery.
Depends on: Epic 2.
## Epic 6 — Avatar / Stone-Mark
Goal: Each member creates a symbolic avatar — ideally the digitized stone-mark from the Cavern Ceremony (the personal sign in the equilateral triangle) — disclosed only under Epic 5’s rules.
User stories:
- As a member, I can upload or draw my stone-mark as my avatar.
- As a member, my avatar is visible only to the audience I chose — never by default, never publicly.
Analysis:
- Ties the digital identity directly to the Step One ceremony: the mark was made in the cavern, at candlelight, before it ever appears on a screen.
- A symbolic mark rather than a face keeps even the “all members” setting anonymity-compatible.
Effort: Small.
Depends on: Epic 5.
## Epic 7 — Encrypted Messaging
Goal: Member-to-member messages, end-to-end encrypted, sealed-sender, entirely off chain — no record anywhere of who wrote to whom, or when.
User stories:
- As a member, I can message another member; neither content nor metadata is recorded on any server or ledger.
- As a member, my trust list (whom I have marked as trusted) lives client-side encrypted; keys never leave my device.
Analysis:
- Blockchains are the wrong tool for messages — everything written there is public forever. Signal-protocol messaging alongside the proof layer is the right split.
- The trust list on a public ledger would be a social graph waiting to be mined; therefore it never touches the chain.
Effort: Large — sealed-sender metadata protection is serious engineering; evaluate building on existing Signal-protocol libraries versus integrating an existing service.
Depends on: Independent of the chain work; can proceed in parallel.
## Epic 8 — Authentication — Passkeys
Goal: Login via WebAuthn/passkeys: the phone’s biometric sensor verifies locally; the fingerprint never leaves the device; the server receives only a cryptographic attestation.
User stories:
- As a member, I sign in with my device’s biometrics without any biometric data being transmitted or stored server-side.
- As a member, I can recover access through my two sponsors (social recovery) rather than through email or phone.
Analysis:
- Answers the original “can the web app get your fingerprint” question the privacy-respecting way: attestation, not biometrics.
- Sponsor-based social recovery keeps even account recovery inside the human trust model.
- Phone-number registration remains an open decision (Epic 10): cheap bot friction, but a deanonymization vector and an exclusion risk.
Effort: Small–Medium — WebAuthn is well-trodden; social recovery adds design work.
Depends on: Epic 1 (for social recovery).
## Epic 9 — Graphical Onboarding — From Nothing to Member
Goal: A guided, visual, stepper-based flow (1 → 2 → 3, with arrows) that takes a vouched newcomer from an empty phone to a live member page — very simple, well explained, and fast: target under ten minutes end to end.
User stories:
- As a newcomer, I see the whole journey as three big illustrated steps with arrows — 1 Wallet → 2 Vouch → 3 Face — one action per screen, plain language, my position always visible.
- As a newcomer, step 1 walks me through downloading a wallet manager on my mobile (direct store links), creating my address, and backing up my seed phrase with a clear, unskippable warning — then I log into the onboarding program by signing a message with my new address (no password, nothing to remember).
- As a main sponsor (parrain), in step 2 I sign the approval of my support from my own device, and then choose: fund the neophyte’s gas from my own wallet, or activate the circle faucet for them (Epic 0) — one tap either way.
- As a newcomer, in step 3 I add my profile picture, which is cartoonised on my device — recognisably me, beautified, but explicitly non-anthropometric — write my private bio (visible to members only, per my visibility settings), fill the few necessary fields (circle-name, region, home circle), and see my empty quipu: a bare necklace cord, presented as a beginning, not an absence.
- As a provisional member (one attestation), I have a live page and a usable faucet grant, but I cannot vote, cannot hold any of the seven lead roles, and cannot see any other member’s data until my second sponsor confirms — and the interface tells me this plainly, as a threshold, not a punishment.
- As a newcomer, when I finish, my member page is live and I know exactly what happens next: my second sponsor’s attestation, and the path toward Step One of the twelve.
Analysis:
- Cartoonisation runs entirely client-side (on-device model): the raw photograph never leaves the phone and is deleted the moment the cartoon is generated. The result must be stylised enough to defeat face-recognition matching while staying recognisable to humans who already know the person — a face for the circle, not a biometric for a database. Sentinel gets an explicit assertion: no original photograph in any storage, upload, or log.
- Two sponsors are required for admission (Epic 1) but only the main sponsor is needed live during onboarding; the second attestation arrives asynchronously. Until it does, the newcomer is a provisional member — a strictly limited status: page exists, quipu empty, faucet grant usable, but a provisional member cannot vote in any circle decision, cannot hold any of the seven lead roles (trusted-servant positions of the circle), and cannot see other members’ data — no avatars, bios, quipus, or pages, whatever those members’ visibility settings say. The glass is one-way by design: the circle can see the newcomer, the newcomer cannot yet browse the circle — membership’s privileges begin when the second sponsor confirms. Enforced structurally, not cosmetically: the provisional identity commitment simply is not in the full-membership Semaphore group, so every members-only proof fails by construction rather than by a UI rule.
- Three macro-steps, not twelve micro-steps: Wallet → Vouch → Face. Everything else (visibility tuning, avatar redraw, second device) is deliberately postponed to after first login — onboarding does the minimum that makes membership real.
- All Epic 5 protective defaults apply from the first second: bio and avatar default to “my circle”; nothing is ever public-internet visible; the newcomer opens up later, deliberately.
- Wallet-manager choice — the suggested wallets are five, all non-custodial: Phantom, Solflare, Glow, Trust Wallet, and Jupiter Mobile, with deep links per platform. Never a single vendor (T6), and displayed in a random order on every page load so no wallet enjoys a permanent first position. The shuffle happens client-side, uniformly, and is never correlated with the user’s identity. The list itself lives in a config file (docs/wallets.json) reviewed at each equinox — wallets get discontinued or compromised, and the recommendation must be able to follow reality without a code change.
- Traditions check: the flow embodies sponsorship as the door (T3 — the only requirement remains the desire to ask the question; the form collects no worthiness data), and the sponsor’s fund-or-faucet choice keeps first gas an act of personal welcome or circle mutual aid (T7).
Effort: Medium — the flow itself is simple; the client-side cartoonisation model is the main technical piece.
Depends on: Epic 0 (faucet), Epic 1 (attestations), Epic 5 (visibility defaults), Epic 6 (avatar storage), Epic 8 (wallet-signature login). Last in build order by design: it stitches the others together.
## Epic 10 — Open Decisions (to be resolved before build)
- Chain or no chain: is Solana needed at all, or does a simpler append-only transparency log anchor the ZK proofs with less complexity? The chain holds only proofs and quipu milestones in any case.
- Quantum resistance: nothing on Solana today is quantum-resistant (Ed25519). If it matters, plan post-quantum signatures (hash-based schemes) at the proof layer — and decide when: now, or as a documented migration path.
- Phone-number registration: keep, drop, or make optional — weigh bot friction against Tradition 12 and accessibility.
- Interim vs. final admission: ship a named-sponsor pilot before ZK is ready, or hold for full anonymity from day one?
- Faucet vs. fee-payer relayer: grant SOL to the neophyte’s wallet (Epic 0 as specified) or have the circle pay gas on their behalf so no funding transfer is ever visible on chain — the relayer is more anonymous; the faucet is simpler and more legible to the circle.
- Governance of the software itself: AHA is never to become a company or an app-as-product (Traditions 6–9). Who stewards the code? Likely answer: open source, maintained by trusted servants, a service committee “directly responsible to those they serve.”
## Epic 11 — Sponsor Recovery — Two-of-Three Key Shards *(added v0.2, per ElectaZ)*
Goal: A member who loses their device recovers their identity through the two humans who admitted them — Shamir 2-of-3 secret sharing over the member's **master secret** (the secret from which both the Solana keypair and the Semaphore identity commitment derive). One shard stays with the member, one goes to each of their two sponsors. Any two reconstruct; any one reconstructs nothing.
User stories:
- As a member, I hold one of three shards of my own master secret; my two sponsors each hold one; losing my device does not lose my identity.
- As a member with my own shard, I recover **immediately** by combining it with one sponsor's shard — the fast path is the honest path, no waiting.
- As two sponsors acting together (member's shard lost), we can restore the member's identity, but only after a **challenge window** (7 days working default) during which the member's existing device can cancel and burn the shards.
- As a member on the handover screen, I am told plainly — there, not in a help article — that my two sponsors acting together can reconstruct my secret without me.
- As a provisional member (only one sponsor), I am told during onboarding, before I finish, that sponsor recovery is not available to me — no valid 2-of-3 split exists with one sponsor.
- As a member, after any recovery that consumed a sponsor shard, after a key rotation, or after a shard-holder is replaced, all three shards are burned and re-issued; a stale shard never lingers looking like protection.
Analysis:
- **Recovery is a purely local event.** The reconstructed secret is bit-identical to the original, so recovery emits **nothing on chain** — no key rotation, no commitment change, no Merkle root republication, no transaction. That unobservability is the entire point of the scheme; any design that emits a recovery event on the anchor is wrong. (Contrast the existing on-chain recovery: F9–F11 rebind the *owner wallet* via a Council 4-of-7 vote or guardian co-sign, which is a visible migration. Epic 11 recovers the *secret itself*, invisibly — the two are complementary, not the same.)
- **Shards at rest reveal nothing.** A shard on a sponsor's device is an opaque blob encrypted under a key the sponsor does not hold, indexed by a one-time code the member supplies at recovery. The custodian's storage contains no name, address, public key, identity commitment, or admission-correlated timestamp, and exposes **no enumeration path** — no list, count, iteration, or debug view. A sponsor asked in person obviously learns who they are helping; that is the ceremony. Nothing at rest, seized, or subpoenaed may reveal it. This is the `ShardCustody` interface's whole reason to exist — implement against it exactly, including its omissions.
- **Handover is in-person only.** Device-to-device at a circle meeting (QR or NFC). A shard must never appear in a request body, server relay, cloud backup, or log — built so there is *no network code path a shard could take*, not a path promised-not-to-be-used.
- **The passkey is a device-local unlock**, never the credential of record, and never gates recovery on its own.
- **Sharding uses a vetted, constant-time Shamir library** — no hand-written field arithmetic — and is property-tested: any two of three reconstruct exactly, any one yields nothing, a corrupted shard fails loudly rather than returning garbage.
- Traditions check: recovery flows through the two humans who vouched for the member (T3, human trust) and produces no minable record (T12). The member-cancellation-and-burn keeps the member sovereign over their own identity, not the sponsors.
Prerequisites (do not assume these exist — they must be authored first): a **unified master-secret derivation** from which both the wallet and the Semaphore commitment derive (today the wallet is an external non-custodial wallet and the commitment is `Poseidon(secret)` kept on device — they are independent); the **`ShardCustody` interface** itself; and the CLAUDE.md **locked positions** on credential-of-record, recovery, and shard handling the build prompt references.
Open decisions (raise, do not pick quietly): the **challenge-window length** (7-day default — confirm the value and that it is configurable but never client-shortenable) and the **shard-transfer medium** (QR vs NFC vs both).
Effort: Large — the sharding core is small and library-backed, but the custody model, the two recovery flows with their timing/cancellation, the re-sharding lifecycle, and the no-enumeration/no-network guarantees are the real work, and each needs an adversarial (Sentinel Layer F) assertion.
Depends on: Epic 1 (two sponsors must exist), Epic 8 (passkey device-local unlock, sponsor-bound recovery framing). Independent of the chain work — by design it touches the chain not at all.
# Sequencing & Dependencies
| Phase | Contents | Effort | Blocks |
| Phase 0 | Epic 10 decisions; quipu color mapping from Emerald table; reading guide | Days | Everything |
| Phase 1 | Epic 0 (faucet — first in build order); Epic 3 (physical quipu); Epic 1 pilot (named sponsors, small circles); Epic 8 (passkeys) | Weeks | Phase 2 |
| Phase 2 | Epic 2 (ZK vouch-proofs); Epic 7 (messaging) in parallel | Months | Phase 3 |
| Phase 3 | Epic 5 (visibility), Epic 6 (avatar), Epic 4 (trust page), Epic 9 (graphical onboarding — last, stitches the others together) | Weeks | Launch |


# Traditions Audit
Every backlog item checked against the Twelve Traditions. This audit is a living gate: any new backlog item must pass it before entering a build phase.
| Item | Finding | Verdict |
| Karma / rating scores | A ranking algorithm applied to people; personalities before principles. | Rejected (T11, T12) |
| Named sponsor display | Deanonymizes the vouch graph. | Rejected → replaced by ZK proof (T12) |
| Two-sponsor admission | Verifies humanity, not worthiness; only requirement remains the desire to ask. | Pass (T3) |
| Quipu milestones | Binary, personal, non-comparative; a mystery worn, not promoted. | Pass (T11, T12) |
| Service listed, never summed | No totals, no tiers, no leaderboard. | Pass (T12) |
| Protective visibility defaults | Anonymity is the default state; disclosure is deliberate. | Pass (T12) |
| Off-chain trust list & messages | No minable social graph; no permanent public record of relationships. | Pass (T12) |
| Faucet (one-time, parrain-activated, capped) | Circle-level mutual aid; vote-gated refill keeps the treasurer a servant, not a governor. | Pass (T2, T7, T9) |
| Treasurer faucet ledger | Links parrain and neophyte — a recorded sponsor edge unless reduced to one-time codes in an encrypted, treasurer-only view. | Conditional pass (T12) — codes only, off-chain |
| Faucet on-chain visibility | Funded wallets are publicly marked as fellowship-adjacent to outside observers. | Open (T12) — relayer alternative, Epic 10 |
| Onboarding cartoonised avatar | Recognisable to the circle, useless to face recognition; raw photo never leaves the device. | Pass (T12) — client-side only |
| Phone-number requirement | Bot friction vs. deanonymization and exclusion. | Open (T3, T12) — Epic 10 |
| Software stewardship | Must never become a company, product, or profit center. | Open (T6–T9) — Epic 10 |
