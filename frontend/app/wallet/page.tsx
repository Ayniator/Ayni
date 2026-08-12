"use client";

// /wallet (F87, Epic E12) — a full wallet surface for WHATEVER wallet is
// connected through wallet-adapter. The embedded "AHA Wallet" being built in
// parallel is just another entry in the wallet modal; nothing here special-
// cases it.
//
// Sections: Overview (address + QR receive), Send SOL, SPL tokens (legacy and
// Token-2022) with a manual-encoded transfer path, and an NFT gallery read
// from Metaplex metadata PDAs. All instruction byte layouts live in
// lib/walletUi.ts with the on-chain spec cited next to each encoding.
//
// English copy is inline for now — localised in a later i18n pass.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import QRCode from "qrcode";
import Identicon from "../../components/Identicon";
import { connection, explorerTx } from "../../lib/member";
import { CLUSTER } from "../../lib/solana";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAtaIdempotentIx,
  deriveAta,
  formatBaseUnits,
  formatSol,
  metadataPda,
  parseAmountToBaseUnits,
  parseNftMetadata,
  parsePublicKey,
  resolveAssetUrl,
  shortAddr,
  splTransferIx,
} from "../../lib/walletUi";

// Keep this much behind for the transaction fee when sending "everything".
const FEE_HEADROOM_LAMPORTS = 5000n;

// The wallet-adapter sendTransaction shape (kept loose so both legacy and
// versioned-capable adapters fit).
type SendTx = (tx: Transaction, conn: Connection) => Promise<string>;

interface TokenRow {
  account: string; // the token account (source for sends)
  mint: string;
  tokenProgram: string; // base58 — legacy or Token-2022
  amountRaw: string; // integer base units, as returned by the RPC
  decimals: number;
  uiAmount: string; // human display string
}

const isNftLike = (t: TokenRow) => t.decimals === 0 && t.amountRaw === "1";

// ---------------------------------------------------------------------------

export default function WalletPage() {
  const { publicKey, connected, sendTransaction } = useWallet();

  const [balance, setBalance] = useState<number | null>(null);
  const [tokens, setTokens] = useState<TokenRow[] | null>(null);
  const [loadError, setLoadError] = useState("");

  const refresh = useCallback(async () => {
    if (!publicKey) {
      setBalance(null);
      setTokens(null);
      return;
    }
    setLoadError("");
    const conn = connection();
    const [lamports, legacy, t22] = await Promise.allSettled([
      conn.getBalance(publicKey),
      conn.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_PROGRAM_ID }),
      conn.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_2022_PROGRAM_ID }),
    ]);

    if (lamports.status === "fulfilled") setBalance(lamports.value);

    const rows: TokenRow[] = [];
    let partial = false;
    for (const [settled, program] of [
      [legacy, TOKEN_PROGRAM_ID],
      [t22, TOKEN_2022_PROGRAM_ID],
    ] as const) {
      if (settled.status !== "fulfilled") {
        partial = true;
        continue;
      }
      for (const { pubkey, account } of settled.value.value) {
        try {
          const info = (account.data as any)?.parsed?.info;
          const ta = info?.tokenAmount;
          if (!info?.mint || !ta || typeof ta.amount !== "string") continue;
          if (ta.amount === "0") continue; // empty accounts are noise
          rows.push({
            account: pubkey.toBase58(),
            mint: String(info.mint),
            tokenProgram: program.toBase58(),
            amountRaw: ta.amount,
            decimals: Number(ta.decimals ?? 0),
            uiAmount: String(ta.uiAmountString ?? ta.uiAmount ?? ta.amount),
          });
        } catch {
          /* skip malformed rows, keep the rest */
        }
      }
    }
    setTokens(rows);
    if (lamports.status === "rejected" && legacy.status === "rejected" && t22.status === "rejected") {
      setLoadError("Could not reach the RPC endpoint. Balances shown may be stale — try again in a moment.");
    } else if (partial || lamports.status === "rejected") {
      setLoadError("Some balances could not be loaded (RPC hiccup). Pull refresh to retry.");
    }
  }, [publicKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const fungible = useMemo(() => (tokens ?? []).filter((t) => !isNftLike(t)), [tokens]);
  const nfts = useMemo(() => (tokens ?? []).filter(isNftLike), [tokens]);

  return (
    <>
      <h1>Wallet</h1>
      <p className="lede">
        Your connected wallet, in one place: receive, send SOL, and manage the
        tokens and NFTs it holds. Works with any wallet in the connect list.
      </p>

      {!connected || !publicKey ? (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>No wallet connected</h3>
          <p className="muted" style={{ margin: 0 }}>
            Use the wallet button in the top bar to connect. Any Solana wallet
            works — and once you create the embedded <strong>AHA Wallet</strong>{" "}
            in Settings → Wallet, it will appear in that same list.
          </p>
        </div>
      ) : (
        <>
          {loadError && <p className="error">{loadError}</p>}
          <div className="grid two" style={{ alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <OverviewCard publicKey={publicKey} balance={balance} />
              <SendSolCard
                publicKey={publicKey}
                balance={balance}
                sendTransaction={sendTransaction as SendTx}
                onSent={refresh}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <TokensCard
                owner={publicKey}
                tokens={tokens === null ? null : fungible}
                sendTransaction={sendTransaction as SendTx}
                onChanged={refresh}
              />
            </div>
          </div>
          <NftsCard
            owner={publicKey}
            nfts={tokens === null ? null : nfts}
            sendTransaction={sendTransaction as SendTx}
            onChanged={refresh}
          />
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Overview: address, balance, QR receive
// ---------------------------------------------------------------------------

function OverviewCard({ publicKey, balance }: { publicKey: PublicKey; balance: number | null }) {
  const addr = publicKey.toBase58();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [qrError, setQrError] = useState("");
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);

  // Draw the receive QR locally (same pattern as ShardSend): dark modules on a
  // white tile so it scans in dark theme too. Nothing leaves the device.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setQrError("");
    QRCode.toCanvas(canvas, addr, {
      errorCorrectionLevel: "M",
      margin: 3,
      width: 220,
      color: { dark: "#111111", light: "#ffffff" },
    }).catch(() => setQrError("Could not draw the QR code on this device."));
  }, [addr]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(addr);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setQrError("Copy failed — select the address text and copy it manually.");
    }
  }, [addr]);

  const share = useCallback(async () => {
    try {
      const nav = navigator as Navigator & { share?: (d: { text: string }) => Promise<void> };
      if (nav.share) {
        await nav.share({ text: addr });
      } else {
        await navigator.clipboard.writeText(addr);
      }
      setShared(true);
      setTimeout(() => setShared(false), 1600);
    } catch {
      /* user cancelled the share sheet — not an error */
    }
  }, [addr]);

  return (
    <div className="card">
      <div className="row">
        <Identicon seed={addr} size={46} />
        <div className="meta" style={{ flex: 1, minWidth: 0 }}>
          <div className="name">Overview</div>
          <div className="sub">
            {balance === null ? "…" : `${formatSol(balance)} SOL`} · {CLUSTER}
          </div>
        </div>
      </div>

      <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
        <code
          className="mono sm"
          style={{ wordBreak: "break-all", flex: 1, minWidth: 200, userSelect: "all" }}
          title={addr}
        >
          {addr}
        </code>
        <button className="btn btn-sm btn-ghost" onClick={copy}>
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>

      <h4 style={{ margin: "16px 0 6px" }}>Receive</h4>
      <p className="muted sm" style={{ marginTop: 0 }}>
        Show this QR to the sender, or share the address. Anything sent to it
        lands in this wallet.
      </p>
      {/* White tile behind the canvas so the QR scans in dark theme. */}
      <div
        style={{
          background: "#ffffff",
          borderRadius: 12,
          padding: 12,
          display: "flex",
          justifyContent: "center",
          maxWidth: 260,
        }}
      >
        <canvas
          ref={canvasRef}
          aria-label="QR code of your wallet address"
          style={{ width: "100%", maxWidth: 220, height: "auto" }}
        />
      </div>
      {qrError && <p className="muted sm" role="alert">{qrError}</p>}
      <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={share}>
        {shared ? "Address shared ✓" : "Share address"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Send SOL
// ---------------------------------------------------------------------------

function SendSolCard({
  publicKey,
  balance,
  sendTransaction,
  onSent,
}: {
  publicKey: PublicKey;
  balance: number | null;
  sendTransaction: SendTx;
  onSent: () => void;
}) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [review, setReview] = useState<{ dest: PublicKey; lamports: bigint } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sig, setSig] = useState("");

  function startReview() {
    setError("");
    setSig("");
    const dest = parsePublicKey(to);
    if (!dest) {
      setError("That recipient is not a valid Solana address.");
      return;
    }
    const lamports = parseAmountToBaseUnits(amount, 9);
    if (lamports === null || lamports <= 0n) {
      setError("Enter a positive SOL amount (up to 9 decimal places).");
      return;
    }
    if (balance !== null && lamports + FEE_HEADROOM_LAMPORTS > BigInt(balance)) {
      setError(
        `Amount exceeds your balance minus fee headroom (max ${formatSol(
          BigInt(balance) > FEE_HEADROOM_LAMPORTS ? BigInt(balance) - FEE_HEADROOM_LAMPORTS : 0n
        )} SOL).`
      );
      return;
    }
    setReview({ dest, lamports });
  }

  async function confirmSend() {
    if (!review) return;
    setBusy(true);
    setError("");
    try {
      const conn = connection();
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
      const tx = new Transaction({ feePayer: publicKey, blockhash, lastValidBlockHeight });
      tx.add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: review.dest,
          lamports: review.lamports,
        })
      );
      const signature = await sendTransaction(tx, conn);
      await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
      setSig(signature);
      setReview(null);
      setTo("");
      setAmount("");
      onSent();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Send SOL</h3>
      {!review ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input
            className="mono"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="Recipient address"
            aria-label="Recipient address"
          />
          <div className="row">
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.1"
              aria-label="Amount in SOL"
              style={{ flex: 1 }}
            />
            <span className="muted">SOL</span>
            <button className="btn" onClick={startReview} disabled={!to || !amount}>
              Review
            </button>
          </div>
          {balance !== null && (
            <p className="muted sm" style={{ margin: 0 }}>
              Available: {formatSol(balance)} SOL (a small fee, ~0.000005 SOL, is kept back).
            </p>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p className="muted sm" style={{ margin: 0 }}>You are about to send exactly:</p>
          <pre className="doc" style={{ margin: 0 }}>
            {formatBaseUnits(review.lamports, 9)} SOL{"\n"}
            from  {shortAddr(publicKey.toBase58())}{"\n"}
            to    {review.dest.toBase58()}
          </pre>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" onClick={confirmSend} disabled={busy}>
              {busy ? "Sending…" : "Confirm & send"}
            </button>
            <button className="btn btn-ghost" onClick={() => setReview(null)} disabled={busy}>
              Back
            </button>
          </div>
        </div>
      )}
      {error && <p className="error" style={{ marginBottom: 0 }}>{error}</p>}
      {sig && (
        <p className="ok-note" style={{ marginBottom: 0 }}>
          Sent ✓{" "}
          <a href={explorerTx(sig)} target="_blank" rel="noreferrer">
            View transaction
          </a>
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Token send (shared by the token list and the NFT gallery)
// ---------------------------------------------------------------------------

function SendTokenForm({
  token,
  owner,
  sendTransaction,
  fixedAmount,
  onDone,
}: {
  token: TokenRow;
  owner: PublicKey;
  sendTransaction: SendTx;
  /** When set (NFTs: "1"), the amount field is hidden and this is sent. */
  fixedAmount?: string;
  onDone: () => void;
}) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState(fixedAmount ?? "");
  const [review, setReview] = useState<{
    dest: PublicKey;
    destAta: PublicKey;
    needsCreate: boolean;
    baseUnits: bigint;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sig, setSig] = useState("");

  async function startReview() {
    setError("");
    setSig("");
    const dest = parsePublicKey(to);
    if (!dest) {
      setError("That recipient is not a valid Solana address.");
      return;
    }
    if (dest.toBase58() === token.account || dest.toBase58() === token.mint) {
      setError("Enter the recipient's WALLET address — their token account is derived automatically.");
      return;
    }
    const baseUnits = parseAmountToBaseUnits(fixedAmount ?? amount, token.decimals);
    if (baseUnits === null || baseUnits <= 0n) {
      setError(
        token.decimals === 0
          ? "Enter a positive whole number (this token has no decimal places)."
          : `Enter a positive amount with at most ${token.decimals} decimal places.`
      );
      return;
    }
    if (baseUnits > BigInt(token.amountRaw)) {
      setError(`Amount exceeds your balance of ${token.uiAmount}.`);
      return;
    }
    setBusy(true);
    try {
      const mint = new PublicKey(token.mint);
      const tokenProgram = new PublicKey(token.tokenProgram);
      const destAta = deriveAta(dest, mint, tokenProgram);
      // Existence check decides whether we prepend CreateIdempotent; the
      // instruction itself is idempotent, so a race with another creator is
      // still safe.
      const info = await connection().getAccountInfo(destAta);
      setReview({ dest, destAta, needsCreate: info === null, baseUnits });
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmSend() {
    if (!review) return;
    setBusy(true);
    setError("");
    try {
      const conn = connection();
      const mint = new PublicKey(token.mint);
      const tokenProgram = new PublicKey(token.tokenProgram);
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
      const tx = new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight });
      if (review.needsCreate) {
        tx.add(createAtaIdempotentIx(owner, review.destAta, review.dest, mint, tokenProgram));
      }
      tx.add(
        splTransferIx(new PublicKey(token.account), review.destAta, owner, review.baseUnits, tokenProgram)
      );
      const signature = await sendTransaction(tx, conn);
      await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
      setSig(signature);
      setReview(null);
      onDone();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
      {!review ? (
        <>
          <input
            className="mono"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="Recipient wallet address"
            aria-label="Recipient wallet address"
          />
          <div className="row" style={{ gap: 8 }}>
            {!fixedAmount && (
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={`Amount (max ${token.uiAmount})`}
                aria-label="Token amount"
                style={{ flex: 1 }}
              />
            )}
            <button className="btn btn-sm" onClick={startReview} disabled={busy || !to}>
              {busy ? "Checking…" : "Review"}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted sm" style={{ margin: 0 }}>You are about to send exactly:</p>
          <pre className="doc" style={{ margin: 0 }}>
            {formatBaseUnits(review.baseUnits, token.decimals)} of mint {shortAddr(token.mint)}{"\n"}
            to wallet     {review.dest.toBase58()}{"\n"}
            token account {review.destAta.toBase58()}
            {review.needsCreate
              ? "\n(does not exist yet — it will be created; you pay its ~0.002 SOL rent)"
              : ""}
          </pre>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-sm" onClick={confirmSend} disabled={busy}>
              {busy ? "Sending…" : "Confirm & send"}
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setReview(null)} disabled={busy}>
              Back
            </button>
          </div>
        </>
      )}
      {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
      {sig && (
        <p className="ok-note" style={{ margin: 0 }}>
          Sent ✓{" "}
          <a href={explorerTx(sig)} target="_blank" rel="noreferrer">
            View transaction
          </a>
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fungible tokens
// ---------------------------------------------------------------------------

function TokensCard({
  owner,
  tokens,
  sendTransaction,
  onChanged,
}: {
  owner: PublicKey;
  tokens: TokenRow[] | null;
  sendTransaction: SendTx;
  onChanged: () => void;
}) {
  const [sending, setSending] = useState<string | null>(null); // token account

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Tokens</h3>
      <p className="muted sm" style={{ marginTop: 0 }}>
        SPL tokens held by this wallet (legacy and Token-2022 programs).
      </p>
      {tokens === null && <p className="muted sm" style={{ margin: 0 }}>Loading token accounts…</p>}
      {tokens !== null && tokens.length === 0 && (
        <p className="muted sm" style={{ margin: 0 }}>No tokens found for this wallet.</p>
      )}
      {tokens?.map((t) => (
        <div key={t.account} style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
          <div className="row">
            <Identicon seed={t.mint} size={32} />
            <div className="meta" style={{ flex: 1, minWidth: 0 }}>
              <div className="name mono" title={t.mint}>{shortAddr(t.mint)}</div>
              <div className="sub">
                {t.uiAmount} · {t.decimals} decimals
                {t.tokenProgram === TOKEN_2022_PROGRAM_ID.toBase58() && (
                  <span className="badge badge-alt">Token-2022</span>
                )}
              </div>
            </div>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => setSending(sending === t.account ? null : t.account)}
            >
              {sending === t.account ? "Close" : "Send"}
            </button>
          </div>
          {sending === t.account && (
            <SendTokenForm token={t} owner={owner} sendTransaction={sendTransaction} onDone={onChanged} />
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NFTs
// ---------------------------------------------------------------------------

interface NftDisplay {
  name: string;
  symbol: string;
  uri: string;
  image?: string; // resolved image URL, once the metadata JSON is fetched
  imageFailed?: boolean;
}

function NftsCard({
  owner,
  nfts,
  sendTransaction,
  onChanged,
}: {
  owner: PublicKey;
  nfts: TokenRow[] | null;
  sendTransaction: SendTx;
  onChanged: () => void;
}) {
  const [metas, setMetas] = useState<Record<string, NftDisplay | null>>({});
  const [sending, setSending] = useState<string | null>(null); // token account
  const mints = useMemo(() => (nfts ?? []).map((n) => n.mint), [nfts]);
  const mintsKey = mints.join(",");

  // Fetch Metaplex metadata accounts in one batched RPC round (chunks of 100),
  // parse defensively, then fetch each URI's JSON for the image — every step
  // per-NFT try/catch so one bad account never blanks the gallery.
  useEffect(() => {
    if (mints.length === 0) return;
    let cancelled = false;
    (async () => {
      const conn = connection();
      for (let i = 0; i < mints.length; i += 100) {
        const chunk = mints.slice(i, i + 100);
        let infos: (Awaited<ReturnType<typeof conn.getAccountInfo>> | null)[] = [];
        try {
          infos = await conn.getMultipleAccountsInfo(
            chunk.map((m) => metadataPda(new PublicKey(m)))
          );
        } catch {
          continue; // RPC hiccup: leave these as "unknown", keep the rest
        }
        chunk.forEach((mint, j) => {
          const info = infos[j];
          const parsed = info?.data ? parseNftMetadata(new Uint8Array(info.data)) : null;
          if (cancelled) return;
          setMetas((p) => ({ ...p, [mint]: parsed ? { ...parsed } : null }));
          // Second hop: the off-chain JSON for the image.
          const jsonUrl = parsed ? resolveAssetUrl(parsed.uri) : "";
          if (!jsonUrl) return;
          fetch(jsonUrl)
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
            .then((j) => {
              if (cancelled) return;
              const image = typeof j?.image === "string" ? resolveAssetUrl(j.image) : "";
              setMetas((p) => {
                const cur = p[mint];
                return cur ? { ...p, [mint]: { ...cur, image, imageFailed: !image } } : p;
              });
            })
            .catch(() => {
              if (cancelled) return;
              setMetas((p) => {
                const cur = p[mint];
                return cur ? { ...p, [mint]: { ...cur, imageFailed: true } } : p;
              });
            });
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mintsKey]);

  if (nfts !== null && nfts.length === 0) return null; // nothing to show, keep the page quiet

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h3 style={{ marginTop: 0 }}>NFTs</h3>
      <p className="muted sm" style={{ marginTop: 0 }}>
        Tokens with a supply of exactly 1 and no decimals, with their Metaplex
        metadata where it exists.
      </p>
      {nfts === null && <p className="muted sm" style={{ margin: 0 }}>Loading…</p>}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          gap: 12,
        }}
      >
        {nfts?.map((n) => {
          const meta = metas[n.mint];
          return (
            <div key={n.account} className="card" style={{ marginBottom: 0, padding: 12 }}>
              <NftImage mint={n.mint} meta={meta} />
              <div className="name sm" style={{ marginTop: 8, fontWeight: 600 }}>
                {meta?.name || shortAddr(n.mint)}
              </div>
              <div className="sub mono" title={n.mint}>
                {shortAddr(n.mint)}
                {meta?.symbol ? ` · ${meta.symbol}` : ""}
              </div>
              <button
                className="btn btn-sm btn-ghost"
                style={{ marginTop: 8 }}
                onClick={() => setSending(sending === n.account ? null : n.account)}
              >
                {sending === n.account ? "Close" : "Send"}
              </button>
              {sending === n.account && (
                <SendTokenForm
                  token={n}
                  owner={owner}
                  sendTransaction={sendTransaction}
                  fixedAmount="1"
                  onDone={onChanged}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NftImage({ mint, meta }: { mint: string; meta: NftDisplay | null | undefined }) {
  const [broken, setBroken] = useState(false);
  const url = meta?.image && !meta.imageFailed && !broken ? meta.image : "";
  if (!url) {
    // Loading, no metadata, or broken image — a deterministic identicon keeps
    // the card recognisable either way.
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "12px 0" }}>
        <Identicon seed={mint} size={72} />
      </div>
    );
  }
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={url}
      alt={meta?.name || "NFT image"}
      loading="lazy"
      onError={() => setBroken(true)}
      style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", borderRadius: 10 }}
    />
  );
}
