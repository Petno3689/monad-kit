import { describe, expect, it } from 'vitest';
import { BaseError, ContractFunctionRevertedError, InsufficientFundsError } from 'viem';
import { describeError } from './errors';
import {
  GasEstimateUnavailableError,
  InsufficientBalanceError,
  NothingToWithdrawError,
  TransferRejectedError,
} from './funds';
import { NonDeterministicSignatureError } from './sessionKey';
import { TxReverted } from './tx';

function revertedWith(errorName: string, args: unknown[] = []) {
  const reverted = Object.assign(Object.create(ContractFunctionRevertedError.prototype) as ContractFunctionRevertedError, {
    data: { errorName, args },
  });
  return new BaseError('call failed', { cause: reverted });
}

describe('describeError', () => {
  it('names a rejected wallet request', () => {
    expect(describeError({ code: 4001 })).toBe('Request rejected');
  });

  it('names a contract revert, with its arguments when it has any', () => {
    expect(describeError(revertedWith('ChestPending'))).toBe('Reverted: ChestPending');
    expect(describeError(revertedWith('RequestNotTimedOut', [1_700_000_000n]))).toBe('Reverted: RequestNotTimedOut (1700000000)');
  });

  it('explains an unaffordable transaction', () => {
    const error = new BaseError('x', { cause: new InsufficientFundsError({ cause: new BaseError('y') }) });
    expect(describeError(error)).toBe('The game key cannot pay for this');
  });

  it('gives each funds error its own message', () => {
    const messages = [
      describeError(new NothingToWithdrawError()),
      describeError(new InsufficientBalanceError()),
      describeError(new TransferRejectedError()),
      describeError(new GasEstimateUnavailableError()),
      describeError(new NonDeterministicSignatureError()),
      describeError(new TxReverted(`0x${'ab'.repeat(32)}`, 1n, 1n)),
    ];
    expect(new Set(messages).size).toBe(messages.length);
    expect(messages[0]).toBe('Nothing to withdraw');
  });

  it('falls back to the message', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError('plain')).toBe('plain');
  });
});
