import { useCallback, useRef } from 'react';
import type { Address } from 'viem';
import { rarityName } from '@shared/chestMath';
import type { Rarity } from '@shared/chestMath';
import { publicClient } from '../chain';
import {
  articleFor,
  cancelAvailability,
  cancelChest,
  findCancelled,
  findOpened,
  findRequested,
  openChest,
  openCost,
  readOpenQuote,
  readPending,
  requestFromBlock,
} from '../chest';
import type { Pending } from '../chest';
import { OPEN_GAS_FALLBACK } from '../config';
import { canPay } from '../funds';
import type { Eip1193Request } from '../funds';
import { formatMon, txQueue } from './shared';
import type { KeyContext } from './shared';
import { useNowSec, usePoll } from './usePoll';

type Outcome = { kind: 'opened'; rarity: Rarity } | { kind: 'cancelled' } | { kind: 'unknown' };

interface ChestStatus {
  pending: Pending;
  outcome: Outcome | null;
}

const QUOTE_EVERY_MS = 10_000;
const IDLE_EVERY_MS = 10_000;
const PENDING_EVERY_MS = 3_000;
const LOOKUP_ATTEMPTS = 3;
const LOOKUP_RETRY_MS = 1_000;

// The contract checks the block timestamp, but a cancel is first simulated against the LATEST
// block, which can lag the browser clock: a click at availableAt + 1 by this clock can still
// revert with RequestNotTimedOut. So the button waits a few seconds longer than the exact rule.
const CANCEL_MARGIN_SEC = 3n;

// Poll fast only while a request is waiting for its word. Module-level: a stable identity.
const statusEvery = (status: ChestStatus) => (status.pending.active ? PENDING_EVERY_MS : IDLE_EVERY_MS);

const rpc: Eip1193Request = (args) => publicClient.request(args as never) as Promise<unknown>;

const nowSec = () => BigInt(Math.floor(Date.now() / 1000));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Props {
  ctx: KeyContext;
  chest: Address;
  balance: bigint | undefined;
}

/** Remount with a key derived from the game key address (unique among siblings): the watched request lives in refs. */
export function ChestPanel({ ctx, chest, balance }: Props) {
  const { account, walletClient, gasPct, busy, run, refreshBalance } = ctx;
  const player = account.address;
  // The request being waited for, and how the last one ended.
  const watch = useRef<{ requestId: bigint; fromBlock: bigint } | null>(null);
  const outcome = useRef<Outcome | null>(null);

  const loadQuote = useCallback(() => readOpenQuote(publicClient, chest, player, OPEN_GAS_FALLBACK), [chest, player]);
  const quote = usePoll(loadQuote, QUOTE_EVERY_MS).value;

  const loadStatus = useCallback(async (): Promise<ChestStatus> => {
    const pending = await readPending(publicClient, chest, player);
    if (pending.active) {
      outcome.current = null;
      if (watch.current?.requestId !== pending.requestId) {
        const latest = await publicClient.getBlockNumber();
        watch.current = { requestId: pending.requestId, fromBlock: requestFromBlock(latest, nowSec(), pending.committedAt) };
      }
    } else if (watch.current) {
      // The request is gone: ChestOpened or ChestCancelled says how. The log can trail the state a moment.
      const { requestId, fromBlock } = watch.current;
      let found: Outcome | null = null;
      for (let attempt = 0; attempt < LOOKUP_ATTEMPTS && found === null; attempt++) {
        if (attempt > 0) await sleep(LOOKUP_RETRY_MS);
        const latest = await publicClient.getBlockNumber();
        const rarity = await findOpened(rpc, chest, player, requestId, fromBlock, latest);
        if (rarity !== null) found = { kind: 'opened', rarity };
        else if (await findCancelled(rpc, chest, player, requestId, fromBlock, latest)) found = { kind: 'cancelled' };
      }
      outcome.current = found ?? { kind: 'unknown' };
      watch.current = null;
    }
    return { pending, outcome: outcome.current };
  }, [chest, player]);
  const status = usePoll(loadStatus, statusEvery);

  const now = useNowSec();
  const pending = status.value?.pending;
  const result = status.value?.outcome ?? null;
  const cost = quote ? openCost(quote, gasPct) : undefined;
  const affordable = cost !== undefined && balance !== undefined && canPay(balance, cost);
  const exact = pending?.active ? cancelAvailability(now, pending, true) : null;
  // The button's moment is availableAt + CANCEL_MARGIN_SEC; the exact rule starts at availableAt + 1.
  const cancelFrom = exact ? exact.availableFromSec + CANCEL_MARGIN_SEC - 1n : 0n;
  const cancel = exact ? { allowed: exact.allowed && now >= cancelFrom, from: cancelFrom } : null;

  const open = () =>
    void run('Opening the chest…', async () => {
      const { blockNumber } = await txQueue.enqueue(() =>
        openChest({ publicClient, walletClient, account, chest, gasMultiplierPct: gasPct }),
      );
      // The reveal can land before the next poll, so watch the request from the open's block,
      // before the status is read again.
      let requestId: bigint | null = null;
      for (let attempt = 0; attempt < LOOKUP_ATTEMPTS && requestId === null; attempt++) {
        if (attempt > 0) await sleep(LOOKUP_RETRY_MS);
        requestId = await findRequested(rpc, chest, player, blockNumber, blockNumber);
      }
      if (requestId !== null) {
        outcome.current = null;
        watch.current = { requestId, fromBlock: blockNumber };
      }
      status.refresh();
      refreshBalance();
    });

  const cancelRequest = () =>
    void run('Cancelling…', async () => {
      await txQueue.enqueue(() => cancelChest({ publicClient, walletClient, account, chest, player, gasMultiplierPct: gasPct }));
      status.refresh();
      refreshBalance();
      return 'Request cancelled';
    });

  const openDisabled = busy || pending === undefined || pending.active || !affordable;

  return (
    <section>
      <h2>Chest</h2>
      <p>
        Randomness fee: {quote ? formatMon(quote.fee) : '…'}. Up-front cost: {cost !== undefined ? formatMon(cost) : '…'}
        {quote && !quote.gasIsEstimate ? ' (gas is a rough figure: it could not be estimated)' : ''}.
      </p>
      <div className="row">
        <button onClick={open} disabled={openDisabled}>
          Open chest
        </button>
        {pending?.active ? <span>A request is pending.</span> : null}
        {!pending?.active && cost !== undefined && balance !== undefined && !affordable ? <span>The game key cannot pay for this.</span> : null}
      </div>
      {pending?.active && cancel ? (
        <div className="row">
          <span>
            Waiting for the random word (request #{pending.requestId.toString()}).{' '}
            {cancel.allowed ? 'It looks stuck: you can cancel it.' : `Cancel becomes available in ${(cancel.from - now).toString()} s.`}
          </span>
          <button onClick={cancelRequest} disabled={busy || !cancel.allowed}>
            Cancel
          </button>
        </div>
      ) : null}
      {result?.kind === 'opened' ? (
        <p className="result">
          You got {articleFor(rarityName(result.rarity))} <strong>{rarityName(result.rarity)}</strong> chest.
        </p>
      ) : null}
      {result?.kind === 'cancelled' ? <p className="result">The request was cancelled.</p> : null}
      {result?.kind === 'unknown' ? (
        <p className="result">The request has ended, but its result was not found in the logs. Check the score board.</p>
      ) : null}
    </section>
  );
}
