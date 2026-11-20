import { BaseError, ContractFunctionRevertedError, InsufficientFundsError, encodeFunctionData, keccak256 } from 'viem';
import type { Abi, Account, Address, Chain, Hex, PublicClient, TransactionReceipt, Transport, WalletClient } from 'viem';
import { getTransactionError } from 'viem/utils';

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

/**
 * How long to look for a transaction by its hash after eth_sendRawTransaction failed. viem 2.58
 * sends it with `retryCount: 0`, so a lost answer is an immediate error although the node may
 * have accepted the transaction. The public Monad RPC answers from several nodes, and the one
 * answering the check may not see a just-accepted transaction yet: so the check waits for a
 * receipt instead of calling getTransaction once. Monad blocks are about 400 ms.
 */
export const LOST_ANSWER_WAIT_MS = 15_000;

/** The wallet methods needed to sign locally and send the raw transaction. */
export type TxSender = Pick<WalletClient<Transport, Chain, Account>, 'prepareTransactionRequest' | 'signTransaction' | 'sendRawTransaction'>;

export interface SendRequest {
  account: Account;
  to: Address;
  data?: Hex;
  value?: bigint;
  gas: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}

export interface SendAndWaitParams {
  publicClient: Pick<PublicClient, 'waitForTransactionReceipt'>;
  walletClient: TxSender;
  request: SendRequest;
  lostAnswerWaitMs?: number;
}

/**
 * Prepares, signs locally, sends and waits for one transaction. The hash is known before the
 * send, so when the send fails (the answer may be lost while the node accepted it) the
 * transaction is looked for by that hash for up to `lostAnswerWaitMs`. Found: it is the result.
 * Not found: the send error is thrown, never the timeout. A reverted receipt throws TxReverted.
 */
export async function sendAndWait({
  publicClient,
  walletClient,
  request,
  lostAnswerWaitMs = LOST_ANSWER_WAIT_MS,
}: SendAndWaitParams): Promise<{ hash: Hex; blockNumber: bigint }> {
  const { account } = request;
  const prepared = await walletClient.prepareTransactionRequest(request);
  const serializedTransaction = await walletClient.signTransaction(prepared);
  const hash = keccak256(serializedTransaction);
  const receipt = await (async (): Promise<TransactionReceipt> => {
    let sent: Hex;
    try {
      sent = await walletClient.sendRawTransaction({ serializedTransaction });
    } catch (sendError) {
      try {
        return await publicClient.waitForTransactionReceipt({ hash, timeout: lostAnswerWaitMs });
      } catch {
        throw getTransactionError(sendError as BaseError, { ...prepared, account });
      }
    }
    if (sent.toLowerCase() !== hash.toLowerCase()) {
      throw new Error(`The node returned hash ${sent}, but the signed transaction has hash ${hash}`);
    }
    return publicClient.waitForTransactionReceipt({ hash });
  })();
  if (receipt.status === 'reverted') throw new TxReverted(hash, request.gas, receipt.blockNumber);
  return { hash, blockNumber: receipt.blockNumber };
}

export interface SendContractTxParams {
  publicClient: Pick<PublicClient, 'simulateContract' | 'estimateContractGas' | 'waitForTransactionReceipt'>;
  walletClient: TxSender;
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
 * Simulates, estimates, then sends and waits for one contract call signed by `account`
 * through `sendAndWait` (signed locally, so a lost send answer is recovered by the hash).
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
  await publicClient.simulateContract(call);
  const gas = await publicClient.estimateContractGas(call);
  const gasLimit = (gas * BigInt(gasMultiplierPct)) / 100n;
  const data = encodeFunctionData({ abi, functionName, args });
  return sendAndWait({ publicClient, walletClient, request: { account, to: address, data, value, gas: gasLimit } });
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
