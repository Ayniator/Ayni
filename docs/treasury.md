# Ayni — treasury & soulbound membership token

## Self-supporting treasury (Tradition 7)

Each Circle has a treasury **PDA** (`seeds = ["treasury", circle]`) holding SOL:

- **`donate(amount)`** — anyone transfers SOL into the treasury. Micro-donations
  are practical at Solana fees.
- **`withdraw_treasury(amount)`** — authority-gated; the treasury PDA signs the
  transfer. In production the Circle `authority` is a **Squads/Realms governance
  PDA**, so the m-of-n (e.g. 4-of-7) that releases funds lives there — the same
  trusted-servant body, reusing audited multisig logic rather than reinventing it.

Outside contributions are simply not solicited; mission-restriction (Traditions
5/6) is a governance policy on what `withdraw_treasury` is used for, optionally
hardened later with a spend allowlist.

## Soulbound membership token (Token-2022)

The canonical membership record is the ZK-commitment-keyed `Membership` account.
For **wallet visibility / selective disclosure**, a Circle may also issue a
**Token-2022 NonTransferable** token:

- The mint is created out-of-band (spl-token CLI / setup script) with the
  **NonTransferable** extension and **mint authority = the Circle PDA**, then
  registered via **`set_membership_mint`**.
- **`mint_membership_token`** mints exactly one token to a member's Token-2022
  account, the Circle PDA signing as mint authority.

Non-transferable ⇒ it cannot be sold or moved (prevents commercialization).
Anonymity is preserved: the token is optional and the real record is the ZK
commitment, never a wallet.

> Status: treasury (donate/withdraw) is complete. The token path mints from a
> pre-created NonTransferable mint; creating that mint with the extension is a
> setup step (not yet a program instruction). Unbuilt — needs the toolchain.
