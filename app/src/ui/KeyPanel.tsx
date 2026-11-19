import { useState } from 'react';
import type { Address } from 'viem';
import { formatMon } from './shared';

interface Props {
  /** The game key's address, or null while locked. */
  address: Address | null;
  balance: bigint | undefined;
  gasPct: number;
  busy: boolean;
  onUnlock: () => void;
  onGasPct: (pct: number) => void;
  onCopyFailed: (address: Address) => void;
}

export function KeyPanel({ address, balance, gasPct, busy, onUnlock, onGasPct, onCopyFailed }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      onCopyFailed(address);
    }
  };

  if (!address) {
    return (
      <section>
        <h2>Game key</h2>
        <p>
          The game key is a separate address that plays for you, so the wallet does not ask to confirm every move. Unlocking asks your wallet to sign a
          message; the very first unlock asks twice, to check that the wallet signs the same way every time.
        </p>
        <button onClick={onUnlock} disabled={busy}>
          Unlock game key
        </button>
      </section>
    );
  }

  return (
    <section>
      <h2>Game key</h2>
      <p className="row">
        <code>{address}</code>
        <button onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </p>
      <p>Balance: {balance === undefined ? '…' : formatMon(balance)}</p>
      <label className="row">
        Gas limit multiplier: {gasPct} %
        <input type="range" min={100} max={200} step={5} value={gasPct} onChange={(e) => onGasPct(Number(e.target.value))} />
      </label>
    </section>
  );
}
