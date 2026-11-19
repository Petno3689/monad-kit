import { describe, expect, it } from 'vitest';
import type { Account, Address, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { NothingToWithdrawError } from './funds';
import { withdrawPlanned } from './plannedWithdraw';

const TO = '0x2222222222222222222222222222222222222222' as Address;
const HASH = `0x${'ab'.repeat(32)}` as Hex;
const account = privateKeyToAccount(`0x${'11'.repeat(32)}`) as Account;

function fakes(liveBalance: bigint, liveFee: bigint) {
  const sent: Record<string, unknown>[] = [];
  const client = {
    getBalance: async () => liveBalance,
    estimateFeesPerGas: async () => ({ maxFeePerGas: liveFee, maxPriorityFeePerGas: liveFee }),
    estimateGas: async () => 99_999n,
    waitForTransactionReceipt: async () => ({ status: 'success', blockNumber: 5n, gasUsed: 1n }),
  };
  const wallet = {
    sendTransaction: async (args: Record<string, unknown>) => {
      sent.push(args);
      return HASH;
    },
  };
  return { client: client as never, wallet: wallet as never, sent };
}

describe('withdrawPlanned', () => {
  it('sends exactly the confirmed plan even when the live balance, fee and gas moved', async () => {
    const plan = { value: 1_000n, gas: 21_000n, maxFeePerGas: 5n, maxPriorityFeePerGas: 2n };
    const { client, wallet, sent } = fakes(9_999_999n, 77n);
    expect(await withdrawPlanned(client, wallet, account, TO, plan)).toEqual({ hash: HASH, blockNumber: 5n });
    expect(sent).toEqual([{ account, to: TO, value: 1_000n, gas: 21_000n, maxFeePerGas: 5n, maxPriorityFeePerGas: 2n }]);
  });

  it('sends nothing for a zero plan', async () => {
    const plan = { value: 0n, gas: 21_000n, maxFeePerGas: 5n, maxPriorityFeePerGas: 2n };
    const { client, wallet, sent } = fakes(9_999_999n, 77n);
    await expect(withdrawPlanned(client, wallet, account, TO, plan)).rejects.toBeInstanceOf(NothingToWithdrawError);
    expect(sent).toHaveLength(0);
  });
});
