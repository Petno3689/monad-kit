import { formatEther } from 'viem';
import type { Account, Address } from 'viem';
import { publicClient } from '../chain';
import type { walletClientFor } from '../chain';
import { createTxQueue } from '../txQueue';

/** The ONE queue every game-key transaction goes through. */
export const txQueue = createTxQueue({
  getBlockNumber: () => publicClient.getBlockNumber(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});

/** Runs an action with a busy label; a returned string is shown as the success notice, a throw as the error. */
export type Run = (label: string, action: () => Promise<string | void>) => Promise<void>;

/** What the panels that sign with the game key need. */
export interface KeyContext {
  owner: Address;
  account: Account;
  walletClient: ReturnType<typeof walletClientFor>;
  gasPct: number;
  /** Whether the wallet is on Monad testnet (needed for anything the wallet itself sends). */
  onMonad: boolean;
  busy: boolean;
  run: Run;
  /** Shows a message in the notice bar. */
  say: (kind: 'ok' | 'error', text: string) => void;
  /** Re-read the game key's balance after a transaction. */
  refreshBalance: () => void;
}

/** Whole MON with up to 6 decimals, truncated. */
export function formatMon(wei: bigint): string {
  const [whole, fraction = ''] = formatEther(wei).split('.');
  const trimmed = fraction.slice(0, 6).replace(/0+$/, '');
  if (wei > 0n && whole === '0' && trimmed === '') return '<0.000001 MON';
  return `${whole}${trimmed ? `.${trimmed}` : ''} MON`;
}
