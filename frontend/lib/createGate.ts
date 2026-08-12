// Who may create a Circle, and can they afford it (F92).
//
// Two preconditions, checked before the creation wizard is shown at all:
//
// 1. SPONSOR VALIDATION. A newcomer is admitted in two asymmetric steps (Epic 2,
//    lib/admission.ts): the parrain attests, and only then does a trusted
//    servant CONFIRM, which closes the `ProvisionalMember` marker and folds the
//    commitment into the votable set. Until that confirmation lands the person
//    is provisional — vouched for, but not yet a full member of anything. A
//    Circle founded by someone in that state would seat an unvalidated member on
//    a 7-seat Council, so creation waits for the sponsor's validation to
//    complete. The check is therefore: does this wallet hold at least one ACTIVE
//    membership with NO provisional marker?
//
// 2. RENT. `initialize_circle` + `initialize_member_tree` create two PDAs that
//    must be rent-exempt, and the member tree is the expensive one (20 levels of
//    filled subtrees). A wallet that cannot cover both gets a bare "Transfer:
//    insufficient lamports" from the runtime halfway through the wizard, after
//    the member has filled in seven seats. Better to say so on arrival.
//
// Privacy note: both checks read only the connected wallet's own accounts and
// derived PDAs. Nothing here is written, published, or sent anywhere, and no
// other member's status is queried.

import { PublicKey } from "@solana/web3.js";
import { CircleInfo, connection, findMyMemberships } from "./member";
import { provisionalPda } from "./admission";

const COUNCIL_SEATS = 7;
const MERKLE_MAX_DEPTH = 20;

/** `Circle::SPACE` — mirrored from programs/ayni/src/state.rs. */
export const CIRCLE_SPACE =
  8 + 32 + (32 * COUNCIL_SEATS + 1 + 8) + 8 + 8 + 1 + 32 + 32 + (4 + 32) + 1;

/** `MemberTree::SPACE` — mirrored from programs/ayni/src/state.rs. */
export const MEMBER_TREE_SPACE = 8 + 32 + 1 + 8 + 32 + 32 * MERKLE_MAX_DEPTH + 1;

/**
 * Headroom over the two rent-exemptions: the transaction fees for the wizard's
 * own two instructions plus the optional follow-ups it may send (country,
 * meetings, profile, the open-membership marker, the founder's own membership),
 * each of which can itself open a small PDA.
 */
export const CREATE_FEE_HEADROOM_LAMPORTS = 30_000_000; // 0.03 SOL

export interface CreateEligibility {
  /** Holds an active membership that a trusted servant has confirmed. */
  validated: boolean;
  /** Holds any membership at all (an unvalidated newcomer vs a stranger). */
  hasMembership: boolean;
  /** Lamports the wallet holds. */
  balance: number;
  /** Lamports the wizard needs, rent + headroom. */
  required: number;
  funded: boolean;
  /** Both gates open. */
  ok: boolean;
}

export const solOf = (lamports: number): string => (lamports / 1e9).toFixed(3);

/**
 * Check both preconditions for the connected wallet.
 *
 * Fails OPEN on an RPC error for the funding half only (an unreachable node
 * must not lock a funded member out of founding a Circle — the runtime will
 * still refuse an underfunded transaction). The sponsor half fails CLOSED: if we
 * cannot establish that the member is confirmed, we do not let them through,
 * because that is the check with a governance consequence.
 */
export async function checkCreateEligibility(
  owner: PublicKey,
  circles: CircleInfo[]
): Promise<CreateEligibility> {
  const conn = connection();

  const mine = await findMyMemberships(owner, circles).catch(() => []);
  const active = mine.filter((m) => m.active);

  // A provisional marker present ⇒ attested but NOT yet confirmed by a trusted
  // servant. Absent ⇒ a full member. One confirmed membership is enough.
  let validated = false;
  if (active.length) {
    const markers = active.map((m) =>
      provisionalPda(new PublicKey(m.circle), Uint8Array.from(
        (m.commitment.match(/.{1,2}/g) ?? []).map((b) => parseInt(b, 16))
      ))
    );
    const infos = await conn.getMultipleAccountsInfo(markers).catch(() => null);
    // No answer ⇒ cannot establish confirmation ⇒ stay closed.
    validated = infos ? infos.some((info) => info === null) : false;
  }

  let balance = 0;
  let required =
    CREATE_FEE_HEADROOM_LAMPORTS + 2 * 3_000_000; // fallback if rent lookups fail
  let funded = true;
  try {
    const [bal, rentCircle, rentTree] = await Promise.all([
      conn.getBalance(owner),
      conn.getMinimumBalanceForRentExemption(CIRCLE_SPACE),
      conn.getMinimumBalanceForRentExemption(MEMBER_TREE_SPACE),
    ]);
    balance = bal;
    required = rentCircle + rentTree + CREATE_FEE_HEADROOM_LAMPORTS;
    funded = bal >= required;
  } catch {
    funded = true; // fail open — see the doc comment
  }

  return {
    validated,
    hasMembership: mine.length > 0,
    balance,
    required,
    funded,
    ok: validated && funded,
  };
}
