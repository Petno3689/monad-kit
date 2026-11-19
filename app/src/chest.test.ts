import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, toHex } from 'viem';
import type { Abi, Account, Address, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import chestGameAbi from './abi/chestGame.abi.json';
import {
  cancelAvailability,
  cancelChest,
  findCancelled,
  findOpened,
  findRequested,
  openChest,
  openCost,
  readBest,
  readBoard,
  readFee,
  readOpenQuote,
  readPending,
  requestFromBlock,
} from './chest';
import type { Pending } from './chest';

const abi = chestGameAbi as Abi;
const CHEST = '0xc0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0' as Address;
const SOURCE = '0x5050505050505050505050505050505050505050' as Address;
const PLAYER = '0x1111111111111111111111111111111111111111' as Address;
const OTHER = '0x2222222222222222222222222222222222222222' as Address;
const HASH = `0x${'ab'.repeat(32)}` as Hex;
const account = privateKeyToAccount(`0x${'11'.repeat(32)}`) as Account;

const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address;

interface ReadCall {
  address: Address;
  functionName: string;
  args?: readonly unknown[];
}

function fakeReader(handlers: Record<string, (args: readonly unknown[] | undefined) => unknown>) {
  const calls: ReadCall[] = [];
  const client = {
    readContract: async (call: ReadCall) => {
      calls.push(call);
      const handler = handlers[call.functionName];
      if (!handler) throw new Error(`unexpected read ${call.functionName}`);
      return handler(call.args);
    },
  };
  return { client: client as never, calls, raw: client };
}

describe('readFee', () => {
  it('reads the source from the chest, then the fee from the source', async () => {
    const { client, calls } = fakeReader({ randomSource: () => SOURCE, fee: () => 123n });
    expect(await readFee(client, CHEST)).toBe(123n);
    expect(calls.map((c) => [c.address, c.functionName])).toEqual([
      [CHEST, 'randomSource'],
      [SOURCE, 'fee'],
    ]);
  });
});

describe('readPending and readBest', () => {
  it('normalises the pendingOf tuple to bigints', async () => {
    const { client, calls } = fakeReader({ pendingOf: () => [true, 7n, 1000, 1030n, 1090n] });
    expect(await readPending(client, CHEST, PLAYER)).toEqual({
      active: true,
      requestId: 7n,
      committedAt: 1000n,
      playerAvailableAt: 1030n,
      outsiderAvailableAt: 1090n,
    });
    expect(calls[0].args).toEqual([PLAYER]);
  });

  it('normalises the bestOf struct to bigints', async () => {
    const { client } = fakeReader({ bestOf: () => ({ score: 4n, achievedAt: 99, entries: 3 }) });
    expect(await readBest(client, CHEST, PLAYER)).toEqual({ score: 4n, achievedAt: 99n, entries: 3n });
  });
});

describe('readBoard', () => {
  it('reads every page of 100 and sorts by score desc, then achievedAt asc', async () => {
    const total = 250;
    // insertion order: player i has score 1..5 cycling and achievedAt falling with i
    const all = Array.from({ length: total }, (_, i) => ({
      player: addr(i + 1),
      score: BigInt((i % 5) + 1),
      achievedAt: BigInt(10_000 - i),
    }));
    const { client, calls } = fakeReader({
      boardSize: () => BigInt(total),
      boardPage: (args) => {
        const [offset, limit] = args as [bigint, bigint];
        const page = all.slice(Number(offset), Number(offset + limit));
        return [page.map((e) => e.player), page.map((e) => ({ score: e.score, achievedAt: Number(e.achievedAt), entries: 1 }))];
      },
    });
    const board = await readBoard(client, CHEST);
    expect(calls.filter((c) => c.functionName === 'boardPage').map((c) => c.args)).toEqual([
      [0n, 100n],
      [100n, 100n],
      [200n, 100n],
    ]);
    expect(board).toHaveLength(total);
    for (let i = 1; i < board.length; i++) {
      const a = board[i - 1];
      const b = board[i];
      expect(a.score > b.score || (a.score === b.score && a.achievedAt <= b.achievedAt)).toBe(true);
    }
    // the first score-5 player to reach it is first: the one with the smallest achievedAt among score 5
    const fives = all.filter((e) => e.score === 5n).sort((x, y) => Number(x.achievedAt - y.achievedAt));
    expect(board[0].player).toBe(fives[0].player);
  });

  it('reads no page for an empty board', async () => {
    const { client, calls } = fakeReader({ boardSize: () => 0n });
    expect(await readBoard(client, CHEST)).toEqual([]);
    expect(calls.map((c) => c.functionName)).toEqual(['boardSize']);
  });

  it('keeps insertion order for equal score and time', async () => {
    const { client } = fakeReader({
      boardSize: () => 2n,
      boardPage: () => [
        [OTHER, PLAYER],
        [
          { score: 3n, achievedAt: 5, entries: 1 },
          { score: 3n, achievedAt: 5, entries: 1 },
        ],
      ],
    });
    expect((await readBoard(client, CHEST)).map((e) => e.player)).toEqual([OTHER, PLAYER]);
  });
});

describe('readOpenQuote and openCost', () => {
  const fees = { maxFeePerGas: 5n };

  it('uses the contract estimate when there is one', async () => {
    const { raw } = fakeReader({ randomSource: () => SOURCE, fee: () => 1_000n });
    const quote = await readOpenQuote(
      { ...raw, estimateContractGas: async () => 400_000n, estimateFeesPerGas: async () => fees } as never,
      CHEST,
      PLAYER,
      600_000n,
    );
    expect(quote).toEqual({ fee: 1_000n, gas: 400_000n, gasIsEstimate: true, maxFeePerGas: 5n });
    // limit = 400 000 × 120 % = 480 000; cost = fee + limit × maxFeePerGas
    expect(openCost(quote, 120)).toBe(1_000n + 480_000n * 5n);
  });

  it('falls back to the given gas when the estimate fails', async () => {
    const { raw } = fakeReader({ randomSource: () => SOURCE, fee: () => 1_000n });
    const quote = await readOpenQuote(
      {
        ...raw,
        estimateContractGas: async () => {
          throw new Error('insufficient funds');
        },
        estimateFeesPerGas: async () => fees,
      } as never,
      CHEST,
      PLAYER,
      600_000n,
    );
    expect(quote).toEqual({ fee: 1_000n, gas: 600_000n, gasIsEstimate: false, maxFeePerGas: 5n });
  });
});

function fakeTx() {
  const simulated: Record<string, unknown>[] = [];
  const written: Record<string, unknown>[] = [];
  const reads: string[] = [];
  const publicClient = {
    readContract: async (call: ReadCall) => {
      reads.push(call.functionName);
      return call.functionName === 'randomSource' ? SOURCE : 777n;
    },
    simulateContract: async (call: Record<string, unknown>) => {
      simulated.push(call);
      return { request: { ...call, simulated: true } };
    },
    estimateContractGas: async () => 100_000n,
    waitForTransactionReceipt: async () => ({ status: 'success', blockNumber: 42n }),
  };
  const walletClient = {
    writeContract: async (call: Record<string, unknown>) => {
      written.push(call);
      return HASH;
    },
  };
  return { publicClient: publicClient as never, walletClient: walletClient as never, simulated, written, reads };
}

describe('openChest and cancelChest', () => {
  it('open sends the fee read just before as the value', async () => {
    const { publicClient, walletClient, simulated, written, reads } = fakeTx();
    const result = await openChest({ publicClient, walletClient, account, chest: CHEST, gasMultiplierPct: 120 });
    expect(reads).toEqual(['randomSource', 'fee']);
    expect(result).toEqual({ hash: HASH, blockNumber: 42n, fee: 777n });
    expect(simulated[0]).toMatchObject({ address: CHEST, functionName: 'open', value: 777n });
    expect(written[0]).toMatchObject({ functionName: 'open', value: 777n, gas: 120_000n });
  });

  it('cancel calls cancel(player) with no value', async () => {
    const { publicClient, walletClient, simulated, written } = fakeTx();
    await cancelChest({ publicClient, walletClient, account, chest: CHEST, player: PLAYER, gasMultiplierPct: 100 });
    expect(simulated[0]).toMatchObject({ address: CHEST, functionName: 'cancel', args: [PLAYER], value: 0n });
    expect(written[0]).toMatchObject({ functionName: 'cancel', gas: 100_000n });
  });
});

describe('cancelAvailability', () => {
  const pending: Pending = {
    active: true,
    requestId: 1n,
    committedAt: 1_000n,
    playerAvailableAt: 1_030n,
    outsiderAvailableAt: 1_090n,
  };

  it('for the player: not allowed at availableAt, allowed one second later', () => {
    expect(cancelAvailability(1_029n, pending, true)).toEqual({ allowed: false, availableFromSec: 1_031n });
    expect(cancelAvailability(1_030n, pending, true)).toEqual({ allowed: false, availableFromSec: 1_031n });
    expect(cancelAvailability(1_031n, pending, true)).toEqual({ allowed: true, availableFromSec: 1_031n });
  });

  it('for an outsider: uses the later moment, with the same strict rule', () => {
    expect(cancelAvailability(1_090n, pending, false)).toEqual({ allowed: false, availableFromSec: 1_091n });
    expect(cancelAvailability(1_091n, pending, false)).toEqual({ allowed: true, availableFromSec: 1_091n });
  });

  it('is never allowed without a request', () => {
    expect(cancelAvailability(9_999n, { ...pending, active: false }, true)).toEqual({ allowed: false, availableFromSec: 0n });
  });
});

describe('requestFromBlock', () => {
  it('goes back by the age at 3 blocks per second plus a margin, never below 0', () => {
    expect(requestFromBlock(10_000n, 1_100n, 1_000n)).toBe(10_000n - (300n + 100n));
    expect(requestFromBlock(50n, 1_100n, 1_000n)).toBe(0n);
    expect(requestFromBlock(10_000n, 900n, 1_000n)).toBe(10_000n - 100n);
  });
});

describe('findOpened', () => {
  const topicsOf = (eventName: string, args: Record<string, unknown>) =>
    encodeEventTopics({ abi, eventName, args } as never) as Hex[];

  function rawLog(eventName: string, args: Record<string, unknown>, data: Hex, blockNumber: bigint) {
    return {
      address: CHEST,
      topics: topicsOf(eventName, args),
      data,
      blockNumber: toHex(blockNumber),
      logIndex: '0x0',
      transactionIndex: '0x0',
      transactionHash: HASH,
      blockHash: HASH,
      removed: false,
    };
  }

  const openedData = (rarity: number) => encodeAbiParameters([{ type: 'uint8' }], [rarity]);

  function fakeRpc(logs: ReturnType<typeof rawLog>[]) {
    const queries: { topics: unknown; fromBlock: string; toBlock: string }[] = [];
    const request = async ({ method, params }: { method: string; params?: readonly unknown[] }) => {
      expect(method).toBe('eth_getLogs');
      const q = (params as [{ topics: unknown; fromBlock: string; toBlock: string }])[0];
      queries.push(q);
      const from = BigInt(q.fromBlock);
      const to = BigInt(q.toBlock);
      return logs.filter((l) => BigInt(l.blockNumber) >= from && BigInt(l.blockNumber) <= to);
    };
    return { request, queries };
  }

  it('filters by [event, player, requestId] topics and decodes the rarity', async () => {
    const log = rawLog('ChestOpened', { player: PLAYER, requestId: 7n }, openedData(4), 150n);
    const { request, queries } = fakeRpc([log]);
    expect(await findOpened(request, CHEST, PLAYER, 7n, 100n, 180n)).toBe(4);
    expect(queries).toHaveLength(1);
    expect(queries[0].topics).toEqual(topicsOf('ChestOpened', { player: PLAYER, requestId: 7n }));
  });

  it('looks through every chunk of a long range', async () => {
    const log = rawLog('ChestOpened', { player: PLAYER, requestId: 7n }, openedData(2), 330n);
    const { request, queries } = fakeRpc([log]);
    expect(await findOpened(request, CHEST, PLAYER, 7n, 100n, 349n)).toBe(2);
    expect(queries).toHaveLength(3);
  });

  it('is null when the request did not open (no ChestOpened for it)', async () => {
    const other = rawLog('ChestOpened', { player: OTHER, requestId: 7n }, openedData(5), 150n);
    const cancelled = rawLog('ChestCancelled', { player: PLAYER, requestId: 7n, by: PLAYER }, '0x', 151n);
    const { request } = fakeRpc([other, cancelled]);
    // the fake ignores topics, so the player/request guard in findOpened is what rejects `other`
    expect(await findOpened(request, CHEST, PLAYER, 7n, 100n, 180n)).toBeNull();
  });
});

describe('findRequested and findCancelled', () => {
  const topicsOf = (eventName: string, args: Record<string, unknown>) =>
    encodeEventTopics({ abi, eventName, args } as never) as Hex[];
  // the query leaves out the trailing indexed arguments it does not filter on (encodeEventTopics pads them with null)
  const filterTopics = (eventName: string, args: Record<string, unknown>) =>
    topicsOf(eventName, args).filter((t) => t !== null);

  function rawLog(eventName: string, args: Record<string, unknown>, data: Hex, blockNumber: bigint, logIndex = 0) {
    return {
      address: CHEST,
      topics: topicsOf(eventName, args),
      data,
      blockNumber: toHex(blockNumber),
      logIndex: toHex(logIndex),
      transactionIndex: '0x0',
      transactionHash: HASH,
      blockHash: HASH,
      removed: false,
    };
  }

  const requested = (player: Address, id: bigint, block: bigint, logIndex = 0) =>
    rawLog('ChestRequested', { player, requestId: id }, encodeAbiParameters([{ type: 'uint256' }], [1n]), block, logIndex);

  function fakeRpc(logs: ReturnType<typeof rawLog>[]) {
    const queries: { topics: unknown; fromBlock: string; toBlock: string }[] = [];
    const request = async ({ params }: { method: string; params?: readonly unknown[] }) => {
      const q = (params as [{ topics: unknown; fromBlock: string; toBlock: string }])[0];
      queries.push(q);
      return logs.filter((l) => BigInt(l.blockNumber) >= BigInt(q.fromBlock) && BigInt(l.blockNumber) <= BigInt(q.toBlock));
    };
    return { request, queries };
  }

  it('findRequested filters by [event, player] and returns the last request id', async () => {
    const { request, queries } = fakeRpc([requested(PLAYER, 3n, 50n), requested(PLAYER, 9n, 50n, 1), requested(OTHER, 4n, 50n, 2)]);
    expect(await findRequested(request, CHEST, PLAYER, 50n, 50n)).toBe(9n);
    expect(queries[0].topics).toEqual(filterTopics('ChestRequested', { player: PLAYER }));
  });

  it('findRequested is null for an empty range', async () => {
    const { request } = fakeRpc([requested(PLAYER, 3n, 50n)]);
    expect(await findRequested(request, CHEST, PLAYER, 51n, 51n)).toBeNull();
  });

  const cancelled = (player: Address, id: bigint, block: bigint) =>
    rawLog('ChestCancelled', { player, requestId: id, by: player }, '0x', block);

  it('findCancelled filters by [event, player, requestId]', async () => {
    const { request, queries } = fakeRpc([cancelled(PLAYER, 7n, 60n)]);
    expect(await findCancelled(request, CHEST, PLAYER, 7n, 50n, 70n)).toBe(true);
    expect(queries[0].topics).toEqual(filterTopics('ChestCancelled', { player: PLAYER, requestId: 7n }));
  });

  it('findCancelled is false for another request, another player or an empty range', async () => {
    const { request } = fakeRpc([cancelled(PLAYER, 8n, 60n), cancelled(OTHER, 7n, 60n)]);
    expect(await findCancelled(request, CHEST, PLAYER, 7n, 50n, 70n)).toBe(false);
    expect(await findCancelled(request, CHEST, PLAYER, 8n, 61n, 70n)).toBe(false);
  });
});
