import { BaseError } from 'viem';
import {
  GasEstimateUnavailableError,
  InsufficientBalanceError,
  NothingToWithdrawError,
  TransferRejectedError,
} from './funds';
import { NonDeterministicSignatureError } from './sessionKey';
import { TxReverted, isInsufficientFunds, revertOf } from './tx';
import { isUserRejection } from './wallet';

/** A short, user-facing sentence for anything an action can throw. */
export function describeError(error: unknown): string {
  if (isUserRejection(error)) return 'Request rejected';
  if (error instanceof NothingToWithdrawError) return 'Nothing to withdraw';
  if (error instanceof InsufficientBalanceError) return 'The game key has too little MON to cover the transfer fee';
  if (error instanceof TransferRejectedError) return 'Your wallet address rejects incoming MON transfers';
  if (error instanceof GasEstimateUnavailableError) return 'Could not estimate the transfer gas (network problem), try again';
  if (error instanceof NonDeterministicSignatureError) {
    return 'This wallet signs the same message differently each time, so a game key cannot be recreated from it. Use another wallet.';
  }
  if (isInsufficientFunds(error)) return 'The game key cannot pay for this';
  const revert = revertOf(error);
  if (revert) return revert.args.length > 0 ? `Reverted: ${revert.name} (${revert.args.map(String).join(', ')})` : `Reverted: ${revert.name}`;
  if (error instanceof TxReverted) return 'The transaction was included but reverted (its gas was spent)';
  if (error instanceof BaseError) return error.shortMessage;
  return error instanceof Error ? error.message : String(error);
}
