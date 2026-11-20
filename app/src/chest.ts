import { encodeEventTopics, numberToHex, pad } from 'viem';
import type { Abi, Account, Address, Hex, PublicClient } from 'viem';
import type { Rarity } from '@shared/chestMath';
import chestGameAbi from './abi/chestGame.abi.json';
import randomSourceAbi from './abi/randomSource.abi.json';
import { actionCost } from './funds';
import type { Eip1193Request } from './funds';
import { decodeLogs, readLogsChunked } from './logs';
import { sendContractTx } from './tx';
import type { TxSender } from './tx';

const chestAbi = chestGameAbi as Abi;
const sourceAbi = randomSourceAbi as Abi;

export const BOARD_PAGE_SIZE = 100n;

/** The indefinite article for a word: 'an' before a vowel letter, else 'a'. */
export function articleFor(word: string): 'a' | 'an' {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

type Reader = Pick<PublicClient, 'readContract'>;

/** The current randomness fee: read from the chest's source every time, because it changes. */
export async function readFee(client: Reader, chest: Address): Promise<bigint> {
  const source = (await client.readContract({ address: chest, abi: chestAbi, functionName: 'randomSource' })) as Address;
  return (await client.readContract({ address: source, abi: sourceAbi, functionName: 'fee' })) as bigint;
}

export interface Pending {
  active: boolean;
  requestId: bigint;
  committedAt: bigint;
  playerAvailableAt: bigint;
  outsiderAvailableAt: bigint;
}

export async function readPending(client: Reader, chest: Address, player: Address): Promise<Pending> {
  const [active, requestId, committedAt, playerAvailableAt, outsiderAvailableAt] = (await client.readContract({
    address: chest,
    abi: chestAbi,
    functionName: 'pendingOf',
    args: [player],
  })) as readonly [boolean, bigint | number, bigint | number, bigint | number, bigint | number];
  return {
    active,
    requestId: BigInt(requestId),
    committedAt: BigInt(committedAt),
    playerAvailableAt: BigInt(playerAvailableAt),
    outsiderAvailableAt: BigInt(outsiderAvailableAt),
  };
}

export interface Best {
  score: bigint;
  achievedAt: bigint;
  entries: bigint;
}

type RawBest = { score: bigint | number; achievedAt: bigint | number; entries: bigint | number };

const toBest = (raw: RawBest): Best => ({ score: BigInt(raw.score), achievedAt: BigInt(raw.achievedAt), entries: BigInt(raw.entries) });

export async function readBest(client: Reader, chest: Address, player: Address): Promise<Best> {
  return toBest(
    (await client.readContract({ address: chest, abi: chestAbi, functionName: 'bestOf', args: [player] })) as RawBest,
  );
}

export interface BoardEntry extends Best {
  player: Address;
}

/** Highest score first; of equal scores, whoever reached it first. */
const byRank = (a: BoardEntry, b: BoardEntry) =>
  a.score !== b.score ? (a.score > b.score ? -1 : 1) : a.achievedAt === b.achievedAt ? 0 : a.achievedAt < b.achievedAt ? -1 : 1;

/** The whole board, read page by page and sorted by rank (the contract keeps insertion order). */
export async function readBoard(client: Reader, chest: Address): Promise<BoardEntry[]> {
  const size = BigInt((await client.readContract({ address: chest, abi: chestAbi, functionName: 'boardSize' })) as bigint);
  const entries: BoardEntry[] = [];
  for (let offset = 0n; offset < size; offset += BOARD_PAGE_SIZE) {
    const [players, bests] = (await client.readContract({
      address: chest,
      abi: chestAbi,
      functionName: 'boardPage',
      args: [offset, BOARD_PAGE_SIZE],
    })) as readonly [readonly Address[], readonly RawBest[]];
    players.forEach((player, i) => entries.push({ player, ...toBest(bests[i]) }));
  }
  return entries.sort(byRank);
}

export interface OpenQuote {
  fee: bigint;
  /** The estimated gas of `open`, or the fallback when it could not be estimated. */
  gas: bigint;
  gasIsEstimate: boolean;
  maxFeePerGas: bigint;
}

/**
 * What opening a chest would cost now. `open` cannot be estimated from a key that cannot pay
 * or that already has a request pending; then `fallbackGas` stands in and `gasIsEstimate` is false.
 */
export async function readOpenQuote(
  client: Pick<PublicClient, 'readContract' | 'estimateContractGas' | 'estimateFeesPerGas'>,
  chest: Address,
  player: Address,
  fallbackGas: bigint,
): Promise<OpenQuote> {
  const [fee, fees] = await Promise.all([readFee(client, chest), client.estimateFeesPerGas()]);
  try {
    const gas = await client.estimateContractGas({
      address: chest,
      abi: chestAbi,
      functionName: 'open',
      account: player,
      value: fee,
    } as never);
    return { fee, gas, gasIsEstimate: true, maxFeePerGas: fees.maxFeePerGas };
  } catch {
    return { fee, gas: fallbackGas, gasIsEstimate: false, maxFeePerGas: fees.maxFeePerGas };
  }
}

/** The up-front cost of one open: the fee plus the gas LIMIT (estimate × multiplier) at the max fee per gas. */
export function openCost(quote: OpenQuote, gasMultiplierPct: number): bigint {
  return actionCost(quote.fee, (quote.gas * BigInt(gasMultiplierPct)) / 100n, quote.maxFeePerGas);
}

interface TxDeps {
  publicClient: Pick<PublicClient, 'simulateContract' | 'estimateContractGas' | 'waitForTransactionReceipt'>;
  walletClient: TxSender;
  account: Account;
  chest: Address;
  gasMultiplierPct: number;
}

/** Opens a chest, sending the fee read just before as the value (the contract returns any excess). */
export async function openChest({
  publicClient,
  ...deps
}: TxDeps & { publicClient: TxDeps['publicClient'] & Reader }): Promise<{ hash: Hex; blockNumber: bigint; fee: bigint }> {
  const fee = await readFee(publicClient, deps.chest);
  const sent = await sendContractTx({
    publicClient,
    walletClient: deps.walletClient,
    account: deps.account,
    address: deps.chest,
    abi: chestAbi,
    functionName: 'open',
    value: fee,
    gasMultiplierPct: deps.gasMultiplierPct,
  });
  return { ...sent, fee };
}

/** Cancels `player`'s stuck request; the contract allows it only after the timeout. */
export function cancelChest({ publicClient, walletClient, account, chest, gasMultiplierPct, player }: TxDeps & { player: Address }) {
  return sendContractTx({
    publicClient,
    walletClient,
    account,
    address: chest,
    abi: chestAbi,
    functionName: 'cancel',
    args: [player],
    gasMultiplierPct,
  });
}

export interface CancelAvailability {
  allowed: boolean;
  /** The first second (unix) at which the cancel succeeds; 0 when there is no request. */
  availableFromSec: bigint;
}

/**
 * The contract's rule: a cancel succeeds strictly AFTER the availableAt moment (at it, it
 * reverts with RequestNotTimedOut(availableAt + 1)). `isPlayer` picks the player's or the outsider's moment.
 */
export function cancelAvailability(nowSec: bigint, pending: Pending, isPlayer: boolean): CancelAvailability {
  if (!pending.active) return { allowed: false, availableFromSec: 0n };
  const availableAt = isPlayer ? pending.playerAvailableAt : pending.outsiderAvailableAt;
  return { allowed: nowSec > availableAt, availableFromSec: availableAt + 1n };
}

// A request seen without knowing the block it was made in is searched for this far back:
// the age in seconds at a generous 3 blocks per second, plus a margin.
const BLOCKS_PER_SECOND_UPPER = 3n;
const LOOKBACK_MARGIN = 100n;

/** The block to start looking for the outcome of a request committed at `committedAt`. */
export function requestFromBlock(latestBlock: bigint, nowSec: bigint, committedAt: bigint): bigint {
  const ageSec = nowSec > committedAt ? nowSec - committedAt : 0n;
  const back = ageSec * BLOCKS_PER_SECOND_UPPER + LOOKBACK_MARGIN;
  return latestBlock > back ? latestBlock - back : 0n;
}

const word = (value: bigint) => numberToHex(value, { size: 32 });

/** The rarity a request ended with (ChestOpened for this player and request id), or null if it did not open. */
export async function findOpened(
  request: Eip1193Request,
  chest: Address,
  player: Address,
  requestId: bigint,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<Rarity | null> {
  const [selector] = encodeEventTopics({ abi: chestAbi, eventName: 'ChestOpened' });
  const logs = await readLogsChunked({
    request,
    address: chest,
    topics: [selector, pad(player.toLowerCase() as Hex, { size: 32 }), word(requestId)],
    fromBlock,
    toBlock,
  });
  for (const log of decodeLogs(chestAbi, logs)) {
    if (log.eventName !== 'ChestOpened') continue;
    if (BigInt(log.args.requestId as bigint) !== requestId) continue;
    if ((log.args.player as string).toLowerCase() !== player.toLowerCase()) continue;
    const rarity = Number(log.args.rarity);
    if (rarity >= 1 && rarity <= 5) return rarity as Rarity;
  }
  return null;
}

/** The id of `player`'s latest ChestRequested in [fromBlock, toBlock], or null when there is none. */
export async function findRequested(
  request: Eip1193Request,
  chest: Address,
  player: Address,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<bigint | null> {
  const [selector] = encodeEventTopics({ abi: chestAbi, eventName: 'ChestRequested' });
  const logs = await readLogsChunked({
    request,
    address: chest,
    topics: [selector, pad(player.toLowerCase() as Hex, { size: 32 })],
    fromBlock,
    toBlock,
  });
  let found: bigint | null = null;
  for (const log of decodeLogs(chestAbi, logs)) {
    if (log.eventName !== 'ChestRequested') continue;
    if ((log.args.player as string).toLowerCase() !== player.toLowerCase()) continue;
    found = BigInt(log.args.requestId as bigint);
  }
  return found;
}

/** Whether ChestCancelled exists for this player and request id in [fromBlock, toBlock]. */
export async function findCancelled(
  request: Eip1193Request,
  chest: Address,
  player: Address,
  requestId: bigint,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<boolean> {
  const [selector] = encodeEventTopics({ abi: chestAbi, eventName: 'ChestCancelled' });
  const logs = await readLogsChunked({
    request,
    address: chest,
    topics: [selector, pad(player.toLowerCase() as Hex, { size: 32 }), word(requestId)],
    fromBlock,
    toBlock,
  });
  return decodeLogs(chestAbi, logs).some(
    (log) =>
      log.eventName === 'ChestCancelled' &&
      BigInt(log.args.requestId as bigint) === requestId &&
      (log.args.player as string).toLowerCase() === player.toLowerCase(),
  );
}
