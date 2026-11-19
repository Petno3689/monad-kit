import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, pad, toHex, type Abi, type Address, type Hex } from 'viem';
import nameRegistryAbi from './abi/nameRegistry.abi.json';
import { decodeLogs, readLogsChunked, scanLogsBackward, type RpcLog } from './logs';

const ADDRESS = '0x00000000000000000000000000000000000000aa' as Address;
const HOLDER = '0x1111111111111111111111111111111111111111' as Address;
const TOPICS: (Hex | null)[] = [null, pad(HOLDER, { size: 32 })];

interface RawEntry {
  block: bigint;
  index: number;
  topics?: Hex[];
  data?: Hex;
}

/** A fake eth_getLogs over a fixed set of entries; records every requested range. */
function fakeRpc(entries: RawEntry[]) {
  const ranges: [bigint, bigint][] = [];
  const queries: unknown[] = [];
  const request = async ({ method, params }: { method: string; params?: readonly unknown[] }) => {
    expect(method).toBe('eth_getLogs');
    const q = (params as [{ fromBlock: Hex; toBlock: Hex }])[0];
    queries.push(q);
    const from = BigInt(q.fromBlock);
    const to = BigInt(q.toBlock);
    ranges.push([from, to]);
    return entries
      .filter((e) => e.block >= from && e.block <= to)
      .reverse() // deliberately out of order
      .map((e) => ({
        address: ADDRESS,
        topics: e.topics ?? TOPICS,
        data: e.data ?? '0x',
        blockNumber: toHex(e.block),
        logIndex: toHex(e.index),
        transactionIndex: '0x0',
        transactionHash: `0x${'00'.repeat(32)}`,
        blockHash: `0x${'11'.repeat(32)}`,
        removed: false,
      }));
  };
  return { request, ranges, queries };
}

const read = (rpc: ReturnType<typeof fakeRpc>, fromBlock: bigint, toBlock: bigint, chunkSize?: bigint) =>
  readLogsChunked({ request: rpc.request, address: ADDRESS, topics: TOPICS, fromBlock, toBlock, chunkSize });

describe('readLogsChunked', () => {
  it('reads exactly 100 blocks in one call', async () => {
    const rpc = fakeRpc([]);
    await read(rpc, 1000n, 1099n);
    expect(rpc.ranges).toEqual([[1000n, 1099n]]);
  });

  it('reads 101 blocks in two calls: 100 then 1', async () => {
    const rpc = fakeRpc([]);
    await read(rpc, 1000n, 1100n);
    expect(rpc.ranges).toEqual([
      [1000n, 1099n],
      [1100n, 1100n],
    ]);
  });

  it('reads 250 blocks in three calls: 100, 100, 50', async () => {
    const rpc = fakeRpc([]);
    await read(rpc, 0n, 249n);
    expect(rpc.ranges).toEqual([
      [0n, 99n],
      [100n, 199n],
      [200n, 249n],
    ]);
  });

  it('reads a single block when from equals to', async () => {
    const rpc = fakeRpc([]);
    await read(rpc, 42n, 42n);
    expect(rpc.ranges).toEqual([[42n, 42n]]);
  });

  it('makes no call when from is after to', async () => {
    const rpc = fakeRpc([]);
    expect(await read(rpc, 10n, 9n)).toEqual([]);
    expect(rpc.ranges).toHaveLength(0);
  });

  it('honours a custom chunk size and rejects a non-positive one', async () => {
    const rpc = fakeRpc([]);
    await read(rpc, 0n, 9n, 5n);
    expect(rpc.ranges).toEqual([
      [0n, 4n],
      [5n, 9n],
    ]);
    await expect(read(rpc, 0n, 9n, 0n)).rejects.toBeInstanceOf(RangeError);
  });

  it('sends the address, topics and hex block bounds', async () => {
    const rpc = fakeRpc([]);
    await read(rpc, 255n, 256n);
    expect(rpc.queries).toEqual([{ address: ADDRESS, topics: TOPICS, fromBlock: '0xff', toBlock: '0x100' }]);
  });

  it('returns logs with numeric fields, sorted by block then log index', async () => {
    const rpc = fakeRpc([
      { block: 150n, index: 1 },
      { block: 10n, index: 5 },
      { block: 150n, index: 0 },
      { block: 10n, index: 2 },
      { block: 120n, index: 9 },
    ]);
    const logs = await read(rpc, 0n, 199n);
    expect(logs.map((l) => [l.blockNumber, l.logIndex])).toEqual([
      [10n, 2],
      [10n, 5],
      [120n, 9],
      [150n, 0],
      [150n, 1],
    ]);
    expect(typeof logs[0].logIndex).toBe('number');
    expect(typeof logs[0].blockNumber).toBe('bigint');
  });
});

describe('scanLogsBackward', () => {
  const scan = (rpc: ReturnType<typeof fakeRpc>, extra: { maxChunks: number; stop: (c: RpcLog[]) => boolean }, from = 0n, to = 349n) =>
    scanLogsBackward({ request: rpc.request, address: ADDRESS, topics: TOPICS, fromBlock: from, toBlock: to, ...extra });

  it('reads newest chunk first and covers the whole range when never stopped', async () => {
    const rpc = fakeRpc([
      { block: 5n, index: 0 },
      { block: 305n, index: 0 },
    ]);
    const result = await scan(rpc, { maxChunks: 10, stop: () => false });
    expect(rpc.ranges).toEqual([
      [250n, 349n],
      [150n, 249n],
      [50n, 149n],
      [0n, 49n],
    ]);
    expect(result.stopped).toBe(false);
    expect(result.logs.map((l) => l.blockNumber)).toEqual([5n, 305n]);
  });

  it('stops after the first chunk for which stop is true and keeps that chunk', async () => {
    const rpc = fakeRpc([
      { block: 5n, index: 0 },
      { block: 160n, index: 0 },
      { block: 305n, index: 0 },
    ]);
    const result = await scan(rpc, { maxChunks: 10, stop: (chunk) => chunk.some((l) => l.blockNumber === 160n) });
    expect(rpc.ranges).toEqual([
      [250n, 349n],
      [150n, 249n],
    ]);
    expect(result.stopped).toBe(true);
    expect(result.logs.map((l) => l.blockNumber)).toEqual([160n, 305n]);
  });

  it('gives up after maxChunks without stopping', async () => {
    const rpc = fakeRpc([]);
    const result = await scan(rpc, { maxChunks: 2, stop: () => false });
    expect(rpc.ranges).toHaveLength(2);
    expect(result).toEqual({ logs: [], stopped: false });
  });

  it('passes each chunk sorted to stop', async () => {
    const rpc = fakeRpc([
      { block: 260n, index: 3 },
      { block: 260n, index: 1 },
    ]);
    const seen: [bigint, number][][] = [];
    await scan(rpc, { maxChunks: 1, stop: (c) => (seen.push(c.map((l) => [l.blockNumber, l.logIndex])), false) });
    expect(seen).toEqual([
      [
        [260n, 1],
        [260n, 3],
      ],
    ]);
  });

  it('ends at the lower bound with a short last chunk', async () => {
    const rpc = fakeRpc([]);
    await scan(rpc, { maxChunks: 10, stop: () => false }, 100n, 120n);
    expect(rpc.ranges).toEqual([[100n, 120n]]);
  });

  it('reads nothing when the range is empty', async () => {
    const rpc = fakeRpc([]);
    expect(await scan(rpc, { maxChunks: 10, stop: () => false }, 10n, 9n)).toEqual({ logs: [], stopped: false });
    expect(rpc.ranges).toHaveLength(0);
  });
});

describe('decodeLogs', () => {
  const abi = nameRegistryAbi as Abi;

  it('decodes known events and skips unknown ones', async () => {
    const setTopics = encodeEventTopics({ abi, eventName: 'NameSet', args: { holder: HOLDER } }) as Hex[];
    const clearedTopics = encodeEventTopics({ abi, eventName: 'NameCleared', args: { holder: HOLDER } }) as Hex[];
    const rpc = fakeRpc([
      { block: 7n, index: 0, topics: setTopics, data: encodeAbiParameters([{ type: 'string' }], ['neo']) },
      { block: 8n, index: 0, topics: clearedTopics },
      { block: 9n, index: 0, topics: [`0x${'ee'.repeat(32)}`] },
    ]);
    const logs = await read(rpc, 0n, 20n);
    expect(decodeLogs(abi, logs)).toEqual([
      { eventName: 'NameSet', args: { holder: HOLDER, name: 'neo' }, blockNumber: 7n, logIndex: 0 },
      { eventName: 'NameCleared', args: { holder: HOLDER }, blockNumber: 8n, logIndex: 0 },
    ]);
  });
});
