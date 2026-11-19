import { describe, expect, it } from 'vitest';
import { BaseError, ContractFunctionRevertedError, InsufficientFundsError, encodeErrorResult, type Abi, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import nameRegistryAbi from './abi/nameRegistry.abi.json';
import { TxReverted, isInsufficientFunds, revertOf, sendContractTx } from './tx';

const abi = nameRegistryAbi as Abi;
const ADDRESS = '0x00000000000000000000000000000000000000aa' as Address;
const HASH = `0x${'cd'.repeat(32)}` as Hex;
const account = privateKeyToAccount(`0x${'11'.repeat(32)}`);

function fakes(options: { estimate?: bigint; status?: 'success' | 'reverted'; simulateError?: unknown } = {}) {
  const { estimate = 100_000n, status = 'success', simulateError } = options;
  const order: string[] = [];
  const written: Record<string, unknown>[] = [];
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
  const walletClient = {
    writeContract: async (args: Record<string, unknown>) => {
      order.push('write');
      written.push(args);
      return HASH;
    },
  };
  return { publicClient: publicClient as never, walletClient: walletClient as never, order, written };
}

const base = { account, address: ADDRESS, abi, functionName: 'setName', args: ['neo'] };

describe('sendContractTx', () => {
  it('simulates, estimates, writes with estimate × pct / 100, then waits', async () => {
    const f = fakes({ estimate: 100_000n });
    const result = await sendContractTx({ ...base, publicClient: f.publicClient, walletClient: f.walletClient, gasMultiplierPct: 120 });
    expect(result).toEqual({ hash: HASH, blockNumber: 500n });
    expect(f.order).toEqual(['simulate', 'estimate', 'write', 'wait']);
    expect(f.written[0]).toMatchObject({ functionName: 'setName', gas: 120_000n });
  });

  it('rounds the gas limit down', async () => {
    const f = fakes({ estimate: 100_001n });
    await sendContractTx({ ...base, publicClient: f.publicClient, walletClient: f.walletClient, gasMultiplierPct: 150 });
    expect(f.written[0].gas).toBe(150_001n);
    const g = fakes({ estimate: 21_001n });
    await sendContractTx({ ...base, publicClient: g.publicClient, walletClient: g.walletClient, gasMultiplierPct: 120 });
    expect(g.written[0].gas).toBe(25_201n);
    const h = fakes({ estimate: 7n });
    await sendContractTx({ ...base, publicClient: h.publicClient, walletClient: h.walletClient, gasMultiplierPct: 120 });
    expect(h.written[0].gas).toBe(8n);
  });

  it('uses the estimate unchanged at 100 %', async () => {
    const f = fakes({ estimate: 55_555n });
    await sendContractTx({ ...base, publicClient: f.publicClient, walletClient: f.walletClient, gasMultiplierPct: 100 });
    expect(f.written[0].gas).toBe(55_555n);
  });

  it('throws TxReverted with the gas limit and block on a reverted receipt', async () => {
    const f = fakes({ estimate: 100_000n, status: 'reverted' });
    const error = await sendContractTx({ ...base, publicClient: f.publicClient, walletClient: f.walletClient, gasMultiplierPct: 120 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TxReverted);
    expect(error).toMatchObject({ hash: HASH, gasLimit: 120_000n, blockNumber: 500n });
  });

  it('stops before estimating or writing when the simulation fails', async () => {
    const failure = new Error('simulation failed');
    const f = fakes({ simulateError: failure });
    await expect(
      sendContractTx({ ...base, publicClient: f.publicClient, walletClient: f.walletClient, gasMultiplierPct: 120 }),
    ).rejects.toBe(failure);
    expect(f.order).toEqual(['simulate']);
    expect(f.written).toHaveLength(0);
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
