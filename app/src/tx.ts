import { BaseError, ContractFunctionRevertedError, InsufficientFundsError } from 'viem';
import type { Abi, Account, Address, Chain, Hex, PublicClient, Transport, WalletClient } from 'viem';

/** The transaction was included in a block and reverted: gas is charged, nothing happened. */
export class TxReverted extends Error {
  readonly hash: Hex;
  readonly gasLimit: bigint;
  readonly blockNumber: bigint;

  constructor(hash: Hex, gasLimit: bigint, blockNumber: bigint) {
    super(`Transaction ${hash} reverted`);
    this.name = 'TxReverted';
    this.hash = hash;
    this.gasLimit = gasLimit;
    this.blockNumber = blockNumber;
  }
}

export interface SendContractTxParams {
  publicClient: Pick<PublicClient, 'simulateContract' | 'estimateContractGas' | 'waitForTransactionReceipt'>;
  walletClient: Pick<WalletClient<Transport, Chain, Account>, 'writeContract'>;
  account: Account;
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
  /** 100–200: the gas limit as a percentage of the estimate. The UI default is 120. */
  gasMultiplierPct: number;
}

/**
 * Simulates, estimates, sends and waits for one contract call signed by `account`.
 *
 * Monad charges gas price × gas LIMIT, not gas used, so headroom above the estimate is paid
 * on every transaction. The limit is the estimate × `gasMultiplierPct` / 100; the default of
 * 120 % comes from the game this kit was extracted from, where over 26 real transactions
 * the needed gas was never more than 1.073 × the estimate.
 */
export async function sendContractTx({
  publicClient,
  walletClient,
  account,
  address,
  abi,
  functionName,
  args = [],
  value = 0n,
  gasMultiplierPct,
}: SendContractTxParams): Promise<{ hash: Hex; blockNumber: bigint }> {
  const call = { address, abi, account, functionName, args, value } as never;
  // Simulate first so a revert surfaces with the contract's own error, not a burned fee.
  const { request } = await publicClient.simulateContract(call);
  const gas = await publicClient.estimateContractGas(call);
  const gasLimit = (gas * BigInt(gasMultiplierPct)) / 100n;
  const hash = await walletClient.writeContract({ ...(request as object), gas: gasLimit } as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status === 'reverted') throw new TxReverted(hash, gasLimit, receipt.blockNumber);
  return { hash, blockNumber: receipt.blockNumber };
}

/** The custom error a call reverted with, if any: `{ name, args }`. */
export function revertOf(error: unknown): { name: string; args: readonly unknown[] } | null {
  if (!(error instanceof BaseError)) return null;
  const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
  if (reverted instanceof ContractFunctionRevertedError && reverted.data) {
    return { name: reverted.data.errorName, args: reverted.data.args ?? [] };
  }
  return null;
}

/** Whether a call failed because the sender cannot pay for it. */
export function isInsufficientFunds(error: unknown): boolean {
  return error instanceof BaseError && error.walk((e) => e instanceof InsufficientFundsError) !== null;
}
