"use client";

// Settings → Security (Epic 8 / F65) — create the device passkey that unlocks
// the LOCAL keystore (lib/keystore.ts).
//
// LOCKED POSITION, stated to the member in plain words below: the passkey is a
// device-local unlock only. It is never the credential of record, it never
// gates recovery, and losing it never loses the identity — sponsor shard
// recovery (Epic 11, /recovery/setup) is the real safety net. Everything on
// this page is local: no fetch, no attestation sent anywhere.
//
// Strings are English inline on purpose — localisation happens later.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  KeystoreMode,
  createPasskey,
  keystoreAvailable,
  passkeyCreated,
  unlock,
} from "../../lib/keystore";
import {
  createWallet,
  embeddedWalletPublicKey,
  exportSecretKey,
  importSecretKey,
  removeEmbeddedWallet,
  toBase58,
} from "../../lib/embeddedWallet";
import { refreshEmbeddedWalletAccount } from "../../lib/embeddedWalletStandard";

const MODE_LABEL: Record<KeystoreMode, string> = {
  prf: "Passkey (PRF)",
  largeBlob: "Passkey (largeBlob)",
  local: "Local key (no passkey)",
};

const MODE_DETAIL: Record<KeystoreMode, string> = {
  prf:
    "Strongest mode. The encryption key is re-derived from your passkey each time you unlock — " +
    "it is never stored anywhere, and every unlock asks for your fingerprint, face, or device PIN.",
  largeBlob:
    "Your device's passkey does not support PRF, so a random secret is kept inside the passkey " +
    "credential itself (it travels and syncs with the passkey, not with this site's storage) and is " +
    "read back behind your fingerprint, face, or device PIN at unlock.",
  local:
    "This browser cannot use a passkey for key derivation, so the keystore uses a random, " +
    "non-exportable key kept in this browser's storage. Honest difference: there is no biometric " +
    "gate — anyone using this browser profile can use (though never extract) the key. Your data " +
    "still never leaves the device.",
};

export default function SecuritySettingsPage() {
  const [mode, setMode] = useState<KeystoreMode | null>(null);
  const [created, setCreated] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [m, c] = await Promise.all([keystoreAvailable(), passkeyCreated()]);
      setMode(m);
      setCreated(c);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const onCreate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await createPasskey("AHA member");
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const onTestUnlock = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await unlock(); // local-only: derives the key, touches no data
      setUnlocked(true);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <>
      <h1>Security</h1>
      <p className="lede">
        A passkey on this device can lock your local, private data (like your
        trust list) behind your fingerprint, face, or device PIN.
      </p>

      <section className="card">
        <div className="row">
          <div className="meta">
            <div className="name">Device keystore</div>
            <div className="sub">
              {created === null || mode === null
                ? "Checking what this device supports…"
                : created
                  ? `Set up on this device — mode: ${MODE_LABEL[mode]}.`
                  : `Not set up yet. This device would get: ${MODE_LABEL[mode]} (estimate — the exact mode is settled when the passkey is created).`}
            </div>
          </div>
          {mode !== null && (
            <span className={"pill" + (mode === "local" ? " pill-dim" : "")}>{MODE_LABEL[mode]}</span>
          )}
        </div>

        {mode !== null && <p className="muted sm">{MODE_DETAIL[mode]}</p>}

        {created === false && (
          <button className="btn" onClick={onCreate} disabled={busy}>
            {busy ? "Waiting for your device…" : "Create passkey"}
          </button>
        )}
        {created === true && !unlocked && (
          <button className="btn btn-ghost btn-sm" onClick={onTestUnlock} disabled={busy}>
            {busy ? "Waiting for your device…" : "Test unlock"}
          </button>
        )}
        {unlocked && <p className="muted sm">Unlocked — the keystore works on this device.</p>}
        {error && <p className="muted sm" role="alert">{error}</p>}
      </section>

      <EmbeddedWalletSection keystoreReady={created === true} />

      <section className="card">
        <div className="name">What this passkey is — and is not</div>
        <p className="muted sm">
          This passkey is a <strong>device-local unlock only</strong>. It is not
          your identity and it never takes part in recovery: your identity is
          the master secret your Solana key and membership commitment both come
          from, and nothing about this passkey is sent to any server or written
          to the chain. If you lose this passkey you lose nothing permanent —
          the data it protects here (your private trust list) can simply be
          re-created in the app, and your identity itself is protected by the
          real safety net: sponsor shard recovery
          {" "}(<Link href="/recovery/setup">set it up here</Link>).
        </p>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Epic 12 · F86 — the embedded "AHA Wallet"
//
// This is the ONLY surface that creates, imports, exports or destroys the
// embedded key: connecting through the wallet modal deliberately never creates
// one (lib/embeddedWalletStandard.ts). Everything here is local — the secret is
// sealed by the keystore above and never leaves the device.
// ---------------------------------------------------------------------------

function EmbeddedWalletSection({ keystoreReady }: { keystoreReady: boolean }) {
  const [address, setAddress] = useState<string | null>(null);
  const [ready, setReady] = useState(false); // client-side read done (no SSR mismatch)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [importValue, setImportValue] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    setAddress(embeddedWalletPublicKey());
    setReady(true);
  }, []);

  const after = useCallback((pub: string | null) => {
    setAddress(pub);
    refreshEmbeddedWalletAccount(); // let the connect modal see the change now
  }, []);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const onCreate = useCallback(
    () =>
      run(async () => {
        const { publicKey, created } = await createWallet();
        after(publicKey);
        setNotice(
          created
            ? "Wallet created. Export a backup below before you rely on it."
            : "This device already had a sealed wallet — it was kept, not replaced."
        );
      }),
    [after, run]
  );

  const onImport = useCallback(
    () =>
      run(async () => {
        const { publicKey } = await importSecretKey(importValue);
        setImportValue("");
        setShowImport(false);
        after(publicKey);
        setNotice("Wallet imported.");
      }),
    [after, importValue, run]
  );

  const onExport = useCallback(
    () =>
      run(async () => {
        const bytes = await exportSecretKey();
        const b58 = toBase58(bytes);
        bytes.fill(0); // our byte copy is gone; the string below is not wipeable
        setSecret(b58);
      }),
    [run]
  );

  const onRemove = useCallback(
    () =>
      run(async () => {
        await removeEmbeddedWallet();
        setConfirmRemove(false);
        setSecret(null);
        after(null);
        setNotice("Wallet removed from this device.");
      }),
    [after, run]
  );

  return (
    <section className="card">
      <div className="row">
        <div className="meta">
          <div className="name">AHA Wallet (this device)</div>
          <div className="sub">
            {!ready
              ? "Checking this device…"
              : address
                ? `Ready — ${address.slice(0, 6)}…${address.slice(-6)}`
                : "Not created yet."}
          </div>
        </div>
        {ready && address && <span className="pill">Ready</span>}
      </div>

      <p className="muted sm">
        A Solana wallet built into the app. The key is generated here, sealed by
        the device keystore above, and never sent anywhere — no extension, no
        seed phrase to type on a website, no custodian. Once it exists it shows
        up as <strong>AHA Wallet</strong> in the connect button at the top of
        every page, alongside whichever other wallets you have installed.
        {/* F67 / T6 (no endorsements): this sentence used to name Phantom and
            Solflare, in that fixed order — the same permanent-first-position
            defect F67 removed from /create, just on a quieter page. The vetted
            five live in docs/wallets.json and are shuffled by WalletChooser;
            no wallet gets named here. */}
      </p>

      {ready && !address && (
        <>
          <p className="muted sm">
            Until master-secret recovery covers it, this key is independent
            randomness: <strong>export the backup and keep it safe</strong>, or
            losing this device loses the key. Your identity and your membership
            are a different thing entirely — those are protected by sponsor
            shard recovery, not by this wallet.
          </p>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" onClick={onCreate} disabled={busy}>
              {busy ? "Working…" : keystoreReady ? "Create AHA Wallet" : "Create AHA Wallet (sets up the keystore)"}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setShowImport((v) => !v)}
              disabled={busy}
            >
              {showImport ? "Cancel import" : "Import a secret key"}
            </button>
          </div>
          {showImport && (
            <div style={{ marginTop: 10 }}>
              <label className="muted sm" htmlFor="aha-import-key">
                Paste a base58 secret key (64-byte key or 32-byte seed). It is
                sealed locally and never transmitted.
              </label>
              <input
                id="aha-import-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={importValue}
                onChange={(e) => setImportValue(e.target.value)}
                style={{ width: "100%", marginTop: 6 }}
              />
              <button
                className="btn btn-sm"
                onClick={onImport}
                disabled={busy || importValue.trim().length === 0}
                style={{ marginTop: 8 }}
              >
                {busy ? "Working…" : "Import"}
              </button>
            </div>
          )}
        </>
      )}

      {ready && address && (
        <>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={onExport} disabled={busy}>
              {busy ? "Working…" : "Show secret key (backup)"}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setConfirmRemove((v) => !v)}
              disabled={busy}
            >
              {confirmRemove ? "Keep wallet" : "Remove from this device"}
            </button>
          </div>

          {secret && (
            <div style={{ marginTop: 10 }}>
              <p className="muted sm" role="alert">
                This is the whole wallet. Anyone who reads it can spend from it.
                Write it down offline — never paste it into a message, a photo,
                or another website.
              </p>
              <code
                style={{ display: "block", wordBreak: "break-all", fontSize: 12 }}
              >
                {secret}
              </code>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setSecret(null)}
                style={{ marginTop: 8 }}
              >
                Hide
              </button>
            </div>
          )}

          {confirmRemove && (
            <div style={{ marginTop: 10 }}>
              <p className="muted sm" role="alert">
                Removing deletes the sealed key from this device. Without the
                backup above it cannot be brought back, and anything the wallet
                holds is gone. Did you export it?
              </p>
              <button className="btn btn-sm" onClick={onRemove} disabled={busy}>
                {busy ? "Working…" : "Yes — remove it"}
              </button>
            </div>
          )}
        </>
      )}

      {notice && <p className="muted sm">{notice}</p>}
      {error && <p className="muted sm" role="alert">{error}</p>}
    </section>
  );
}
