import { describe, expect, it } from 'vitest';
import { BaseError, ExecutionRevertedError, HttpRequestError, InsufficientFundsError, type Account, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  GasEstimateUnavailableError,
  InsufficientBalanceError,
  NothingToWithdrawError,
  TRANSFER_GAS,
  TransferRejectedError,
  actionCost,
  canPay,
  estimateTransferGas,
  parseTopUp,
  planWithdraw,
  topUp,
  withdraw,
  withdrawAmount,
} from './funds';
import { TxReverted } from './tx';

const FROM = '0x1111111111111111111111111111111111111111' as Address;
const TO = '0x2222222222222222222222222222222222222222' as Address;
const OWNER = '0x3333333333333333333333333333333333333333' as Address;
const HASH = `0x${'ab'.repeat(32)}` as Hex;

describe('actionCost', () => {
  it('adds the fee and the gas limit at the max fee per gas', () => {
    expect(actionCost(1000n, 600_000n, 2n)).toBe(1000n + 600_000n * 2n);
  });
  it('is the fee alone at a zero fee per gas', () => {
    expect(actionCost(1000n, 600_000n, 0n)).toBe(1000n);
  });
});

describe('canPay', () => {
  const cost = actionCost(1000n, 600_000n, 2n);
  it('accepts a balance exactly equal to the cost', () => {
    expect(canPay(cost, cost)).toBe(true);
  });
  it('rejects a balance one wei short', () => {
    expect(canPay(cost - 1n, cost)).toBe(false);
  });
  it('accepts more than enough and rejects zero', () => {
    expect(canPay(cost + 1n, cost)).toBe(true);
    expect(canPay(0n, cost)).toBe(false);
  });
});

describe('withdrawAmount', () => {
  const reserve = TRANSFER_GAS * 5n;
  it('leaves exactly the transfer gas behind', () => {
    expect(withdrawAmount(reserve + 100n, 5n, TRANSFER_GAS)).toBe(100n);
  });
  it('is zero when the balance only covers the transfer gas', () => {
    expect(withdrawAmount(reserve, 5n, TRANSFER_GAS)).toBe(0n);
  });
  it('is zero, not negative, when the balance is below the transfer gas', () => {
    expect(withdrawAmount(reserve - 1n, 5n, TRANSFER_GAS)).toBe(0n);
    expect(withdrawAmount(0n, 5n, TRANSFER_GAS)).toBe(0n);
  });
  it('is the whole balance at a zero fee', () => {
    expect(withdrawAmount(77n, 0n, TRANSFER_GAS)).toBe(77n);
  });
  it('gives the same amount at 21 000 gas as the fixed-gas rule did', () => {
    expect(withdrawAmount(1_000_000n, 5n, 21_000n)).toBe(1_000_000n - 21_000n * 5n);
  });
  it('gives a smaller amount when the transfer needs more gas', () => {
    expect(withdrawAmount(1_000_000n, 5n, 50_000n)).toBe(1_000_000n - 50_000n * 5n);
    expect(withdrawAmount(1_000_000n, 5n, 50_000n)).toBeLessThan(withdrawAmount(1_000_000n, 5n, 21_000n));
  });
  it('is zero when the balance does not cover the larger gas cost', () => {
    expect(withdrawAmount(21_000n * 5n + 100n, 5n, 50_000n)).toBe(0n);
    expect(withdrawAmount(50_000n * 5n, 5n, 50_000n)).toBe(0n);
  });
});

describe('parseTopUp', () => {
  it('converts decimal MON to wei', () => {
    expect(parseTopUp('3')).toBe(3n * 10n ** 18n);
    expect(parseTopUp('0.5')).toBe(5n * 10n ** 17n);
    expect(parseTopUp(' 1.25 ')).toBe(125n * 10n ** 16n);
    expect(parseTopUp('.5')).toBe(5n * 10n ** 17n);
  });
  it('accepts exactly 18 decimals and the smallest amount', () => {
    expect(parseTopUp('0.000000000000000001')).toBe(1n);
  });
  it('rejects more than 18 decimals', () => {
    expect(parseTopUp('0.0000000000000000001')).toBeNull();
  });
  it('rejects empty and non-numeric input', () => {
    for (const bad of ['', '   ', 'abc', '1e3', '1,5', '0x10', '1.2.3', '.', '1 2']) {
      expect(parseTopUp(bad), bad).toBeNull();
    }
  });
  it('rejects zero and negative amounts', () => {
    for (const bad of ['0', '0.0', '-1', '-0.5']) expect(parseTopUp(bad), bad).toBeNull();
  });
});

interface FakeOptions {
  balance?: bigint;
  gas?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  estimateError?: unknown;
  receiptStatus?: 'success' | 'reverted';
}

function fakeClient(options: FakeOptions = {}) {
  const { balance = 10_000_000n, gas = 21_000n, maxFeePerGas = 5n, maxPriorityFeePerGas = 2n, estimateError, receiptStatus = 'success' } = options;
  const estimateArgs: unknown[] = [];
  const client = {
    getBalance: async () => balance,
    estimateFeesPerGas: async () => ({ maxFeePerGas, maxPriorityFeePerGas }),
    estimateGas: async (args: unknown) => {
      estimateArgs.push(args);
      if (estimateError) throw estimateError;
      return gas;
    },
    waitForTransactionReceipt: async () => ({ status: receiptStatus, blockNumber: 77n, gasUsed: 20_000n }),
  };
  return { client: client as never, estimateArgs };
}

function fakeWallet() {
  const sent: Record<string, unknown>[] = [];
  const wallet = {
    sendTransaction: async (args: Record<string, unknown>) => {
      sent.push(args);
      return HASH;
    },
  };
  return { wallet: wallet as never, sent };
}

const account = privateKeyToAccount(`0x${'11'.repeat(32)}`) as Account;

describe('estimateTransferGas', () => {
  it('estimates a one-wei transfer from the burner', async () => {
    const { client, estimateArgs } = fakeClient({ gas: 50_000n });
    expect(await estimateTransferGas(client, FROM, TO)).toBe(50_000n);
    expect(estimateArgs).toEqual([{ account: FROM, to: TO, value: 1n }]);
  });

  it('maps a revert to TransferRejectedError, keeping the cause', async () => {
    const cause = new BaseError('estimate failed', { cause: new ExecutionRevertedError({ message: 'execution reverted' }) });
    const { client } = fakeClient({ estimateError: cause });
    const error = await estimateTransferGas(client, FROM, TO).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransferRejectedError);
    expect((error as Error).message).toBe('the address rejects incoming MON transfers');
    expect((error as Error).cause).toBe(cause);
  });

  it('maps an insufficient-funds chain to InsufficientBalanceError, keeping the cause', async () => {
    const cause = new BaseError('estimate failed', {
      cause: new InsufficientFundsError({ cause: new BaseError('rejected by the node') }),
    });
    const { client } = fakeClient({ estimateError: cause });
    const error = await estimateTransferGas(client, FROM, TO).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InsufficientBalanceError);
    expect(error).not.toBeInstanceOf(GasEstimateUnavailableError);
    expect((error as Error).cause).toBe(cause);
  });

  it('maps a network failure to GasEstimateUnavailableError, not a rejection', async () => {
    const cause = new BaseError('estimate failed', { cause: new HttpRequestError({ url: 'https://rpc', body: {} }) });
    const { client } = fakeClient({ estimateError: cause });
    const error = await estimateTransferGas(client, FROM, TO).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GasEstimateUnavailableError);
    expect(error).not.toBeInstanceOf(TransferRejectedError);
    expect((error as Error).cause).toBe(cause);
  });

  it('maps a non-viem failure to GasEstimateUnavailableError', async () => {
    const cause = new TypeError('fetch failed');
    const { client } = fakeClient({ estimateError: cause });
    const error = await estimateTransferGas(client, FROM, TO).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GasEstimateUnavailableError);
    expect((error as Error).cause).toBe(cause);
  });
});

describe('planWithdraw and withdraw', () => {
  it('plans the balance less gas × maxFeePerGas, with the estimated gas and fees', async () => {
    const { client } = fakeClient({ balance: 1_000_000n, gas: 50_000n, maxFeePerGas: 5n, maxPriorityFeePerGas: 3n });
    expect(await planWithdraw(client, FROM, TO)).toEqual({
      value: 1_000_000n - 50_000n * 5n,
      gas: 50_000n,
      maxFeePerGas: 5n,
      maxPriorityFeePerGas: 3n,
    });
  });

  it('sends exactly the planned value, gas and fees', async () => {
    const options = { balance: 1_000_000n, gas: 50_000n, maxFeePerGas: 5n, maxPriorityFeePerGas: 3n };
    const plan = await planWithdraw(fakeClient(options).client, account.address, TO);
    const { client } = fakeClient(options);
    const { wallet, sent } = fakeWallet();
    const result = await withdraw(client, wallet, account, TO);
    expect(result).toEqual({ hash: HASH, blockNumber: 77n });
    expect(sent).toEqual([
      { account, to: TO, value: plan.value, gas: 50_000n, maxFeePerGas: 5n, maxPriorityFeePerGas: 3n },
    ]);
    // value + gas limit at maxFeePerGas spends the whole balance, no more
    expect(plan.value + plan.gas * plan.maxFeePerGas).toBe(1_000_000n);
  });

  it('plans a zero value without estimating gas at a zero balance', async () => {
    const { client, estimateArgs } = fakeClient({ balance: 0n, maxFeePerGas: 5n, maxPriorityFeePerGas: 3n });
    expect(await planWithdraw(client, FROM, TO)).toEqual({
      value: 0n,
      gas: TRANSFER_GAS,
      maxFeePerGas: 5n,
      maxPriorityFeePerGas: 3n,
    });
    expect(estimateArgs).toHaveLength(0);
  });

  it('throws NothingToWithdrawError even when the node would refuse to estimate for an empty sender', async () => {
    const estimateError = new BaseError('estimate failed', { cause: new InsufficientFundsError({ cause: new BaseError('x') }) });
    const { client, estimateArgs } = fakeClient({ balance: 0n, estimateError });
    const { wallet, sent } = fakeWallet();
    await expect(withdraw(client, wallet, account, TO)).rejects.toBeInstanceOf(NothingToWithdrawError);
    expect(estimateArgs).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('plans a zero value when a dust balance is refused an estimate, so withdraw has nothing to withdraw', async () => {
    const estimateError = new BaseError('estimate failed', { cause: new InsufficientFundsError({ cause: new BaseError('x') }) });
    const { client } = fakeClient({ balance: 5n, maxFeePerGas: 5n, maxPriorityFeePerGas: 3n, estimateError });
    expect(await planWithdraw(client, FROM, TO)).toEqual({
      value: 0n,
      gas: TRANSFER_GAS,
      maxFeePerGas: 5n,
      maxPriorityFeePerGas: 3n,
    });
    const { wallet, sent } = fakeWallet();
    await expect(withdraw(client, wallet, account, TO)).rejects.toBeInstanceOf(NothingToWithdrawError);
    expect(sent).toHaveLength(0);
  });

  it('still propagates a revert of the estimate as TransferRejectedError', async () => {
    const estimateError = new BaseError('estimate failed', { cause: new ExecutionRevertedError({ message: 'execution reverted' }) });
    const { client } = fakeClient({ balance: 1_000_000n, estimateError });
    await expect(planWithdraw(client, FROM, TO)).rejects.toBeInstanceOf(TransferRejectedError);
  });

  it('throws NothingToWithdrawError and sends nothing at a zero balance', async () => {
    const { client } = fakeClient({ balance: 0n });
    const { wallet, sent } = fakeWallet();
    await expect(withdraw(client, wallet, account, TO)).rejects.toBeInstanceOf(NothingToWithdrawError);
    expect(sent).toHaveLength(0);
  });

  it('throws NothingToWithdrawError when the balance only covers the gas', async () => {
    const { client } = fakeClient({ balance: 21_000n * 5n, gas: 21_000n, maxFeePerGas: 5n });
    const { wallet, sent } = fakeWallet();
    await expect(withdraw(client, wallet, account, TO)).rejects.toBeInstanceOf(NothingToWithdrawError);
    expect(sent).toHaveLength(0);
  });

  it('sends nothing when the transfer estimate fails', async () => {
    const { client } = fakeClient({ estimateError: new TypeError('offline') });
    const { wallet, sent } = fakeWallet();
    await expect(withdraw(client, wallet, account, TO)).rejects.toBeInstanceOf(GasEstimateUnavailableError);
    expect(sent).toHaveLength(0);
  });

  it('throws TxReverted with the planned gas on a reverted receipt', async () => {
    const { client } = fakeClient({ receiptStatus: 'reverted', gas: 50_000n });
    const { wallet } = fakeWallet();
    const error = await withdraw(client, wallet, account, TO).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TxReverted);
    expect(error).toMatchObject({ hash: HASH, gasLimit: 50_000n, blockNumber: 77n });
  });
});

describe('topUp', () => {
  it('sends eth_sendTransaction from the owner and waits for the receipt', async () => {
    const calls: { method: string; params?: readonly unknown[] }[] = [];
    const request = async (args: { method: string; params?: readonly unknown[] }) => {
      calls.push(args);
      return HASH;
    };
    const { client } = fakeClient();
    const result = await topUp(request, client, OWNER, FROM, 255n);
    expect(result).toEqual({ hash: HASH, blockNumber: 77n });
    expect(calls).toEqual([{ method: 'eth_sendTransaction', params: [{ from: OWNER, to: FROM, value: '0xff' }] }]);
  });

  it('throws TxReverted on a reverted receipt', async () => {
    const { client } = fakeClient({ receiptStatus: 'reverted' });
    const error = await topUp(async () => HASH, client, OWNER, FROM, 1n).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TxReverted);
    expect(error).toMatchObject({ hash: HASH, gasLimit: 20_000n, blockNumber: 77n });
  });

  it('does not wait when the wallet rejects', async () => {
    const { client } = fakeClient();
    const request = async (): Promise<unknown> => {
      throw Object.assign(new Error('User rejected'), { code: 4001 });
    };
    await expect(topUp(request, client, OWNER, FROM, 1n)).rejects.toMatchObject({ code: 4001 });
  });
});
