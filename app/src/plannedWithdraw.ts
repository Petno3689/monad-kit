import type { Account, Address, Hex } from 'viem';
import { withdraw } from './funds';
import type { WithdrawPlan } from './funds';

type WithdrawClient = Parameters<typeof withdraw>[0];
type WithdrawWallet = Parameters<typeof withdraw>[1];

/**
 * Sends exactly `plan` (the one the user confirmed) through `withdraw`. `withdraw` plans again
 * on its own, so it is handed a view of the chain frozen at the plan: the balance the plan
 * was made from, its fees and its gas. The value, gas and fees sent are then the confirmed
 * ones; if the real balance has since dropped, the node refuses the transaction rather than
 * sending a different amount.
 */
export function withdrawPlanned(
  client: WithdrawClient,
  wallet: WithdrawWallet,
  account: Account,
  to: Address,
  plan: WithdrawPlan,
): Promise<{ hash: Hex; blockNumber: bigint }> {
  const frozen = {
    getBalance: async () => plan.value + plan.gas * plan.maxFeePerGas,
    estimateFeesPerGas: async () => ({ maxFeePerGas: plan.maxFeePerGas, maxPriorityFeePerGas: plan.maxPriorityFeePerGas }),
    estimateGas: async () => plan.gas,
    waitForTransactionReceipt: client.waitForTransactionReceipt.bind(client),
  } as unknown as WithdrawClient;
  return withdraw(frozen, wallet, account, to);
}
