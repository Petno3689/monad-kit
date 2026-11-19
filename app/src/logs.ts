import { parseEventLogs, toHex } from 'viem';
import type { Abi, Address, Hex } from 'viem';
import type { Eip1193Request } from './funds';

// The public RPC accepts eth_getLogs over 101 blocks and answers 413 to 1000.
export const LOG_CHUNK_SIZE = 100n;

/** A log with its numeric fields parsed; the rest is as the RPC returned it. */
export interface RpcLog {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: bigint;
  logIndex: number;
  transactionIndex: number;
  transactionHash: Hex;
  blockHash: Hex;
  removed: boolean;
}

export type LogTopics = (Hex | Hex[] | null)[];

export interface LogQuery {
  request: Eip1193Request;
  address: Address;
  topics: LogTopics;
  fromBlock: bigint;
  toBlock: bigint;
  chunkSize?: bigint;
}

const byPosition = (a: RpcLog, b: RpcLog) =>
  a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1;

type RawRpcLog = Omit<RpcLog, 'blockNumber' | 'logIndex' | 'transactionIndex'> & {
  blockNumber: Hex;
  logIndex: Hex;
  transactionIndex: Hex;
};

async function readChunk(
  { request, address, topics }: Pick<LogQuery, 'request' | 'address' | 'topics'>,
  from: bigint,
  to: bigint,
): Promise<RpcLog[]> {
  const raw = (await request({
    method: 'eth_getLogs',
    params: [{ address, topics, fromBlock: toHex(from), toBlock: toHex(to) }],
  })) as RawRpcLog[];
  return raw
    .map((l) => ({
      ...l,
      blockNumber: BigInt(l.blockNumber),
      logIndex: Number(l.logIndex),
      transactionIndex: Number(l.transactionIndex),
    }))
    .sort(byPosition);
}

function assertChunkSize(chunkSize: bigint) {
  if (chunkSize < 1n) throw new RangeError('chunkSize must be at least 1');
}

/**
 * Every log in [fromBlock, toBlock] (inclusive), read in chunks of at most `chunkSize`
 * blocks, one after another, sorted by block number then log index.
 */
export async function readLogsChunked({ chunkSize = LOG_CHUNK_SIZE, ...query }: LogQuery): Promise<RpcLog[]> {
  assertChunkSize(chunkSize);
  const out: RpcLog[] = [];
  for (let from = query.fromBlock; from <= query.toBlock; from += chunkSize) {
    const to = from + chunkSize - 1n < query.toBlock ? from + chunkSize - 1n : query.toBlock;
    out.push(...(await readChunk(query, from, to)));
  }
  return out.sort(byPosition);
}

export interface BackwardScan extends LogQuery {
  maxChunks: number;
  /** Called with each chunk's logs, newest chunk first; true ends the scan after that chunk. */
  stop: (chunk: RpcLog[]) => boolean;
}

/**
 * Scans [fromBlock, toBlock] backward in chunks, newest first, at most `maxChunks`. The scan
 * ends after the first chunk for which `stop` returns true. Returns the logs of the chunks
 * read (in block order) and whether `stop` fired.
 */
export async function scanLogsBackward({
  chunkSize = LOG_CHUNK_SIZE,
  maxChunks,
  stop,
  ...query
}: BackwardScan): Promise<{ logs: RpcLog[]; stopped: boolean }> {
  assertChunkSize(chunkSize);
  const chunks: RpcLog[][] = [];
  let stopped = false;
  let to = query.toBlock;
  for (let n = 0; n < maxChunks && to >= query.fromBlock; n++) {
    const from = to - chunkSize + 1n > query.fromBlock ? to - chunkSize + 1n : query.fromBlock;
    const chunk = await readChunk(query, from, to);
    chunks.unshift(chunk);
    if (stop(chunk)) {
      stopped = true;
      break;
    }
    to = from - 1n;
  }
  return { logs: chunks.flat(), stopped };
}

export interface DecodedLog {
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: bigint;
  logIndex: number;
}

/** The logs of `abi`'s events, decoded; logs of other events are skipped. */
export function decodeLogs(abi: Abi, logs: RpcLog[]): DecodedLog[] {
  const parsed = parseEventLogs({ abi, logs } as never) as unknown as {
    eventName: string;
    args?: Record<string, unknown>;
    blockNumber: bigint;
    logIndex: number;
  }[];
  return parsed.map((l) => ({ eventName: l.eventName, args: l.args ?? {}, blockNumber: l.blockNumber, logIndex: l.logIndex }));
}
