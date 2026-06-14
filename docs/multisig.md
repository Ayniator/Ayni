# Multisig on Solana — and why the Ayni treasury requires one

> **Tradition 7.** A Circle is self-supporting through its own contributions, and
> that money is held *in common* — never by one person. So Ayni does not let a
> Circle name a single wallet as its treasury steward: the steward **must be a
> multisig** (an m-of-n account where at least two key-holders must agree to
> move funds). This is enforced on-chain (`set_treasury_wallet`), not merely in
> the UI.

## What "multisig" means on Solana

There are a few ways to do multi-signature on Solana. Ayni uses the one that is
**native, account-level, and cheap to verify on-chain**: the **SPL Token
`Multisig` account**.

An SPL Token multisig is a fixed 355-byte account, owned by the SPL Token
program (or Token-2022), holding:

| Field            | Bytes | Meaning                                   |
|------------------|-------|-------------------------------------------|
| `m`              | 1     | required signatures (the threshold)       |
| `n`              | 1     | number of signers                         |
| `is_initialized` | 1     | initialized flag                          |
| `signers`        | 11×32 | up to 11 signer pubkeys (`n` of them used)|

A transaction that spends from / acts as this account is only valid if **at
least `m` of the `n` signers** sign it. Ayni requires **`m ≥ 2`** and `n ≥ m`
(no single-sig disguised as a multisig).

> Want a full smart-contract multisig with a proposal/approval UI, spending
> limits, and time-locks? Use **[Squads](https://squads.so)**. The on-chain
> requirement here is the minimal primitive; a Squads vault can also be used as
> long as the treasury account you register is an `m-of-n` multisig account
> Ayni can verify. The SPL Token multisig below is the simplest path.

## Make one — three ways

### 1. Solana CLI (`spl-token`)

```bash
# 2-of-3 multisig over three signer pubkeys
spl-token create-multisig 2 <SIGNER_1> <SIGNER_2> <SIGNER_3>
# → prints the multisig address. m=2, n=3.
```

### 2. Ayni ops script (no spl-token CLI needed)

```bash
# Payer = ~/.config/solana/aha-deployer.json by default; RPC_URL overridable.
node scripts/create-multisig.js 2 <SIGNER_1> <SIGNER_2> <SIGNER_3>
```

### 3. In the browser (the connected wallet pays)

```ts
import { createMultisigWithWallet } from "@/lib/multisig";
import { connection } from "@/lib/member";

const address = await createMultisigWithWallet(
  wallet,                       // the connected Wallet-Standard wallet
  connection(),
  [signer1, signer2, signer3],  // PublicKey[]
  2                             // threshold m
);
```

`lib/multisig.ts` also exports `isMultisig(connection, address)` →
`{ ok, m, n, signers, program, reason }`, used by the admin console to validate
an address *before* proposing it as the treasury wallet.

## Register it as the treasury steward

The treasury wallet is set through the Council's normal 4-of-7, time-locked,
contestable flow (so the move itself is also group-conscience):

1. A Council seat opens a **`SetTreasuryWallet`** proposal carrying the multisig
   address (the admin console rejects non-multisig addresses up front).
2. Four of seven seats approve; the contest window elapses.
3. Anyone calls **`set_treasury_wallet`**, passing the multisig account. The
   program re-checks on-chain that it is an initialized SPL/Token-2022 multisig
   with `m ≥ 2` before writing it into `TreasuryConfig`. A single-key address is
   rejected with `TreasuryNotMultisig`.

So even if the UI is bypassed, the chain will not record a single-signer
treasury steward.

## Notes & limits

- The check is performed at **apply time** (`set_treasury_wallet`), where the
  actual account state is visible; `propose` only records the pubkey, keeping it
  cheap. The applier must pass the multisig account.
- Token-2022 multisigs are accepted (their `Multisig` layout is byte-identical).
- This validates the **shape** of the steward account, not how the Circle later
  *uses* it. Donations still flow into the Circle treasury **PDA**; the multisig
  is the governed payout destination recorded in `TreasuryConfig` (the address
  shown in the directory/console and used for off-chain disbursement).
- Rotating the steward later is the same `SetTreasuryWallet` flow — and the new
  wallet must again be a multisig.
