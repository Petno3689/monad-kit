import { BaseError, ExecutionRevertedError, InsufficientFundsError, parseEther, toHex } from 'viem';
import type { Account, Address, Chain, Hex, PublicClient, Transport, WalletClient } from 'viem';
import { TxReverted } from './tx';

/** Gas of a plain value transfer to an address without code; the fallback before an estimate is known. */
export const TRANSFER_GAS = 21_000n;

/** What one action costs up front: its fee plus the gas LIMIT at `maxFeePerGas` (Monad charges the limit). */
export function actionCost(fee: bigint, gasLimit: bigint, maxFeePerGas: bigint): bigint {
  return fee + gasLimit * maxFeePerGas;
}

export function canPay(balance: bigint, cost: bigint): boolean {
  return balance >= cost;
}

/** Everything the burner can send away once it has paid for the transfer itself, at the estimated `gas`. */
export function withdrawAmount(balance: bigint, maxFeePerGas: bigint, gas: bigint): bigint {
  const amount = balance - gas * maxFeePerGas;
  return amount > 0n ? amount : 0n;
}

/** A decimal MON amount in wei, or null when the text is not a positive amount with at most 18 decimals. */
export function parseTopUp(input: string): bigint | null {
  const text = input.trim();
  if (!/^\d*\.?\d+$|^\d+\.$/.test(text)) return null;
  const [, fraction = ''] = text.split('.');
  if (fraction.length > 18) return null;
  try {
    const wei = parseEther(text);
    return wei > 0n ? wei : null;
  } catch {
    return null;
  }
}

/** The recipient's code reverted a test transfer: it does not accept incoming MON. */
export class TransferRejectedError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('the address rejects incoming MON transfers', options);
    this.name = 'TransferRejectedError';
  }
}

/** The sender has too little MON to cover the transfer, so the node refused to estimate it. */
export class InsufficientBalanceError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('the sender has too little MON to cover the transfer', options);
    this.name = 'InsufficientBalanceError';
  }
}

/** The gas estimate could not be obtained (network or RPC failure): the recipient is not to blame. */
export class GasEstimateUnavailableError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('could not estimate the transfer gas (network or RPC failure)', options);
    this.name = 'GasEstimateUnavailableError';
  }
}

export class NothingToWithdrawError extends Error {
  constructor() {
    super('Nothing to withdraw');
    this.name = 'NothingToWithdrawError';
  }
}

type FundsClient = Pick<PublicClient, 'getBalance' | 'estimateFeesPerGas' | 'estimateGas' | 'waitForTransactionReceipt'>;
type FundsWallet = Pick<WalletClient<Transport, Chain, Account>, 'sendTransaction'>;

/**
 * Gas a plain transfer of MON from `from` to `to` needs. A recipient with code (a smart wallet,
 * an EIP-7702 delegation) needs more than 21 000, and Monad charges the whole gas limit either way.
 * Throws InsufficientBalanceError when the sender cannot pay, TransferRejectedError when the
 * estimate reverts, GasEstimateUnavailableError on any other failure (network or RPC).
 */
export async function estimateTransferGas(
  client: Pick<PublicClient, 'estimateGas'>,
  from: Address,
  to: Address,
): Promise<bigint> {
  try {
    return await client.estimateGas({ account: from, to, value: 1n });
  } catch (error) {
    if (error instanceof BaseError) {
      if (error.walk((e) => e instanceof InsufficientFundsError) !== null) {
        throw new InsufficientBalanceError({ cause: error });
      }
      if (error.walk((e) => e instanceof ExecutionRevertedError) !== null) {
        throw new TransferRejectedError({ cause: error });
      }
    }
    throw new GasEstimateUnavailableError({ cause: error });
  }
}

export interface WithdrawPlan {
  value: bigint;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

/**
 * What a withdrawal from `from` to `to` would send. The UI shows THIS value and `withdraw`
 * sends THIS plan (same gas and fees), so the amount shown and the amount sent cannot differ.
 */
export async function planWithdraw(client: FundsClient, from: Address, to: Address): Promise<WithdrawPlan> {
  const [balance, fees] = await Promise.all([client.getBalance({ address: from }), client.estimateFeesPerGas()]);
  const { maxFeePerGas, maxPriorityFeePerGas } = fees;
  // A node refuses to estimate for a sender with nothing: there is nothing to withdraw anyway.
  if (balance === 0n) return { value: 0n, gas: TRANSFER_GAS, maxFeePerGas, maxPriorityFeePerGas };
  let gas: bigint;
  try {
    gas = await estimateTransferGas(client, from, to);
  } catch (error) {
    // A key holding only dust may be refused an estimate: that too means there is nothing to withdraw.
    if (error instanceof InsufficientBalanceError) return { value: 0n, gas: TRANSFER_GAS, maxFeePerGas, maxPriorityFeePerGas };
    throw error;
  }
  return { value: withdrawAmount(balance, maxFeePerGas, gas), gas, maxFeePerGas, maxPriorityFeePerGas };
}

/** Send the game key's whole balance, less the transfer's own gas, to `to`. */
export async function withdraw(
  client: FundsClient,
  wallet: FundsWallet,
  account: Account,
  to: Address,
): Promise<{ hash: Hex; blockNumber: bigint }> {
  const plan = await planWithdraw(client, account.address, to);
  if (plan.value === 0n) throw new NothingToWithdrawError();
  const hash = await wallet.sendTransaction({
    account,
    to,
    value: plan.value,
    gas: plan.gas,
    maxFeePerGas: plan.maxFeePerGas,
    maxPriorityFeePerGas: plan.maxPriorityFeePerGas,
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status === 'reverted') throw new TxReverted(hash, plan.gas, receipt.blockNumber);
  return { hash, blockNumber: receipt.blockNumber };
}

/** An EIP-1193 `request`, e.g. `window.ethereum.request`. */
export type Eip1193Request = (args: { method: string; params?: readonly unknown[] }) => Promise<unknown>;

/** Send `value` from the owner's wallet to the game key and wait for inclusion. */
export async function topUp(
  request: Eip1193Request,
  client: Pick<PublicClient, 'waitForTransactionReceipt'>,
  owner: Address,
  burner: Address,
  value: bigint,
): Promise<{ hash: Hex; blockNumber: bigint }> {
  const hash = (await request({
    method: 'eth_sendTransaction',
    params: [{ from: owner, to: burner, value: toHex(value) }],
  })) as Hex;
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status === 'reverted') throw new TxReverted(hash, receipt.gasUsed, receipt.blockNumber);
  return { hash, blockNumber: receipt.blockNumber };
}
