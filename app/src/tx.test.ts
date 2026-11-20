import { describe, expect, it } from 'vitest';
import {
  BaseError,
  ContractFunctionRevertedError,
  HttpRequestError,
  InsufficientFundsError,
  RpcRequestError,
  WaitForTransactionReceiptTimeoutError,
  encodeErrorResult,
  encodeFunctionData,
  keccak256,
  type Abi,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import nameRegistryAbi from './abi/nameRegistry.abi.json';
import { LOST_ANSWER_WAIT_MS, TxReverted, isInsufficientFunds, revertOf, sendAndWait, sendContractTx } from './tx';

const abi = nameRegistryAbi as Abi;
const ADDRESS = '0x00000000000000000000000000000000000000aa' as Address;
const SERIALIZED = `0x02${'ef'.repeat(40)}` as Hex;
const HASH = keccak256(SERIALIZED);
const account = privateKeyToAccount(`0x${'11'.repeat(32)}`);

function fakeSender(order: string[], options: { sendError?: unknown; sentHash?: Hex } = {}) {
  const prepared: Record<string, unknown>[] = [];
  const walletClient = {
    prepareTransactionRequest: async (args: Record<string, unknown>) => {
      order.push('prepare');
      prepared.push(args);
      return args;
    },
    signTransaction: async () => {
      order.push('sign');
      return SERIALIZED;
    },
    sendRawTransaction: async () => {
      order.push('send');
      if (options.sendError) throw options.sendError;
      return options.sentHash ?? keccak256(SERIALIZED);
    },
  };
  return { walletClient, prepared };
}

function fakes(options: { estimate?: bigint; status?: 'success' | 'reverted'; simulateError?: unknown } = {}) {
  const { estimate = 100_000n, status = 'success', simulateError } = options;
  const order: string[] = [];
  const publicClient = {
    simulateContract: async () => {
      order.push('simulate');
      if (simulateError) throw simulateError;
      return { request: { address: ADDRESS, functionName: 'setName', args: ['neo'] } };
    },
    estimateContractGas: async () => {
      order.push('estimate');
      return estimate;
    },
    waitForTransactionReceipt: async () => {
      order.push('wait');
      return { status, blockNumber: 500n };
    },
  };
  const { walletClient, prepared } = fakeSender(order);
  return { publicClient: publicClient as never, walletClient: walletClient as never, order, prepared };
}

const base = { account, address: ADDRESS, abi, functionName: 'setName', args: ['neo'] };

describe('sendContractTx', () => {
  it('simulates, estimates, sends with estimate × pct / 100, then waits', async () => {
    const f = fakes({ estimate: 100_000n });
    const result = await sendContractTx({ ...base, publicClient: f.publicClient, walletClient: f.walletClient, gasMultiplierPct: 120 });
    expect(result).toEqual({ hash: keccak256(SERIALIZED), blockNumber: 500n });
    expect(f.order).toEqual(['simulate', 'estimate', 'prepare', 'sign', 'send', 'wait']);
    expect(f.prepared[0]).toMatchObject({ data: encodeFunctionData({ abi, functionName: 'setName', args: ['neo'] }), gas: 120_000n });
  });

  it('rounds the gas limit down', async () => {
    const f = fakes({ estimate: 100_001n });
    await sendContractTx({ ...base, publicClient: f.publicClient, walletClient: f.walletClient, gasMultiplierPct: 150 });
    expect(f.prepared[0].gas).toBe(150_001n);
    const g = fakes({ estimate: 21_001n });
    await sendContractTx({ ...base, publicClient: g.publicClient, walletClient: g.walletClient, gasMultiplierPct: 120 });
    expect(g.prepared[0].gas).toBe(25_201n);
    const h = fakes({ estimate: 7n });
    await sendContractTx({ ...base, publicClient: h.publicClient, walletClient: h.walletClient, gasMultiplierPct: 120 });
    expect(h.prepared[0].gas).toBe(8n);
  });

  it('uses the estimate unchanged at 100 %', async () => {
    const f = fakes({ estimate: 55_555n });
    await sendContractTx({ ...base, publicClient: f.publicClient, walletClient: f.walletClient, gasMultiplierPct: 100 });
    expect(f.prepared[0].gas).toBe(55_555n);
  });

  it('throws TxReverted with the gas limit and block on a reverted receipt', async () => {
    const f = fakes({ estimate: 100_000n, status: 'reverted' });
    const error = await sendContractTx({ ...base, publicClient: f.publicClient, walletClient: f.walletClient, gasMultiplierPct: 120 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TxReverted);
    expect(error).toMatchObject({ hash: keccak256(SERIALIZED), gasLimit: 120_000n, blockNumber: 500n });
  });

  it('stops before estimating or sending when the simulation fails', async () => {
    const failure = new Error('simulation failed');
    const f = fakes({ simulateError: failure });
    await expect(
      sendContractTx({ ...base, publicClient: f.publicClient, walletClient: f.walletClient, gasMultiplierPct: 120 }),
    ).rejects.toBe(failure);
    expect(f.order).toEqual(['simulate']);
    expect(f.prepared).toHaveLength(0);
  });
});

describe('sendAndWait', () => {
  const request = { account, to: ADDRESS, data: '0x1234' as Hex, value: 3n, gas: 90_000n };
  const lostAnswer = () => new HttpRequestError({ url: 'https://rpc', body: {} });

  function waiter(options: { status?: 'success' | 'reverted'; blockNumber?: bigint; waitError?: unknown } = {}) {
    const { status = 'success', blockNumber = 500n, waitError } = options;
    const waits: Record<string, unknown>[] = [];
    const publicClient = {
      waitForTransactionReceipt: async (args: Record<string, unknown>) => {
        waits.push(args);
        if (waitError) throw waitError;
        return { status, blockNumber };
      },
    };
    return { publicClient: publicClient as never, waits };
  }

  it('returns the local hash and block, waiting without a timeout', async () => {
    const order: string[] = [];
    const { walletClient, prepared } = fakeSender(order);
    const { publicClient, waits } = waiter({ blockNumber: 501n });
    const result = await sendAndWait({ publicClient, walletClient: walletClient as never, request });
    expect(result).toEqual({ hash: HASH, blockNumber: 501n });
    expect(order).toEqual(['prepare', 'sign', 'send']);
    expect(prepared).toEqual([request]);
    expect(waits).toEqual([{ hash: HASH }]);
  });

  it('recovers a lost answer: a receipt found by the hash within the wait is the result', async () => {
    const { walletClient } = fakeSender([], { sendError: lostAnswer() });
    const { publicClient, waits } = waiter({ blockNumber: 600n });
    const result = await sendAndWait({ publicClient, walletClient: walletClient as never, request, lostAnswerWaitMs: 1_234 });
    expect(result).toEqual({ hash: HASH, blockNumber: 600n });
    expect(waits).toEqual([{ hash: HASH, timeout: 1_234 }]);
  });

  it('waits LOST_ANSWER_WAIT_MS by default after a send error', async () => {
    const { walletClient } = fakeSender([], { sendError: lostAnswer() });
    const { publicClient, waits } = waiter();
    await sendAndWait({ publicClient, walletClient: walletClient as never, request });
    expect(waits).toEqual([{ hash: HASH, timeout: LOST_ANSWER_WAIT_MS }]);
  });

  it('throws the send error, not the timeout, when the transaction is not found', async () => {
    const sendError = lostAnswer();
    const timeout = new WaitForTransactionReceiptTimeoutError({ hash: HASH });
    const { walletClient } = fakeSender([], { sendError });
    const { publicClient } = waiter({ waitError: timeout });
    const error = await sendAndWait({ publicClient, walletClient: walletClient as never, request }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BaseError);
    expect((error as BaseError).walk((e) => e === sendError)).toBe(sendError);
    expect(error).not.toBe(timeout);
    expect((error as BaseError).walk((e) => e === timeout)).toBeNull();
  });

  it('keeps a node rejection recognisable as insufficient funds', async () => {
    const sendError = new RpcRequestError({
      url: 'https://rpc',
      body: {},
      error: { code: -32000, message: 'insufficient funds for gas * price + value' },
    });
    const { walletClient } = fakeSender([], { sendError });
    const { publicClient } = waiter({ waitError: new WaitForTransactionReceiptTimeoutError({ hash: HASH }) });
    const error = await sendAndWait({ publicClient, walletClient: walletClient as never, request }).catch((e: unknown) => e);
    expect(isInsufficientFunds(error)).toBe(true);
    expect((error as BaseError).walk((e) => e === sendError)).toBe(sendError);
  });

  it('throws TxReverted when the recovered receipt is reverted', async () => {
    const { walletClient } = fakeSender([], { sendError: lostAnswer() });
    const { publicClient } = waiter({ status: 'reverted', blockNumber: 700n });
    const error = await sendAndWait({ publicClient, walletClient: walletClient as never, request }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TxReverted);
    expect(error).toMatchObject({ hash: HASH, gasLimit: 90_000n, blockNumber: 700n });
  });

  it('throws, naming both hashes, when the node returns a different hash', async () => {
    const other = `0x${'99'.repeat(32)}` as Hex;
    const { walletClient } = fakeSender([], { sentHash: other });
    const { publicClient, waits } = waiter();
    const error = await sendAndWait({ publicClient, walletClient: walletClient as never, request }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(other);
    expect((error as Error).message).toContain(HASH);
    expect(waits).toHaveLength(0);
  });
});

describe('revertOf', () => {
  it('reads the custom error out of a viem error chain', () => {
    const data = encodeErrorResult({ abi, errorName: 'NameTaken' });
    const reverted = new ContractFunctionRevertedError({ abi, functionName: 'setName', data });
    const error = new BaseError('call failed', { cause: reverted });
    expect(revertOf(error)).toEqual({ name: 'NameTaken', args: [] });
  });

  it('is null for a viem error that is not a contract revert', () => {
    expect(revertOf(new BaseError('network down'))).toBeNull();
  });

  it('is null for a non-viem error and for non-errors', () => {
    expect(revertOf(new Error('boom'))).toBeNull();
    expect(revertOf('boom')).toBeNull();
    expect(revertOf(null)).toBeNull();
  });
});

describe('isInsufficientFunds', () => {
  it('finds InsufficientFundsError anywhere in the chain', () => {
    const error = new BaseError('send failed', { cause: new InsufficientFundsError({ cause: new BaseError('x') }) });
    expect(isInsufficientFunds(error)).toBe(true);
  });

  it('is false for other errors', () => {
    expect(isInsufficientFunds(new BaseError('other'))).toBe(false);
    expect(isInsufficientFunds(new Error('insufficient funds'))).toBe(false);
  });
});
