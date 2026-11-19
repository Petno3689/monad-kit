import { useState } from 'react';
import type { EIP1193Provider } from 'viem';
import { publicClient } from '../chain';
import { parseTopUp, planWithdraw, topUp } from '../funds';
import type { WithdrawPlan } from '../funds';
import { withdrawPlanned } from '../plannedWithdraw';
import { toEip1193Request } from '../wallet';
import { formatMon, txQueue } from './shared';
import type { KeyContext } from './shared';

interface Props {
  ctx: KeyContext;
  provider: EIP1193Provider;
}

export function FundsPanel({ ctx, provider }: Props) {
  const { owner, account, walletClient, busy, run, say, onMonad, refreshBalance } = ctx;
  const [amount, setAmount] = useState('1');
  // The plan the user is asked to confirm; exactly this plan is sent.
  const [plan, setPlan] = useState<WithdrawPlan | null>(null);

  const doTopUp = () => {
    const value = parseTopUp(amount);
    if (value === null) {
      say('error', 'Enter an amount in MON, for example 0.5');
      return;
    }
    void run('Waiting for the wallet…', async () => {
      await topUp(toEip1193Request(provider), publicClient, owner, account.address, value);
      refreshBalance();
      return `Topped up ${formatMon(value)}`;
    });
  };

  const planIt = () => {
    void run('Planning the withdrawal…', async () => {
      const next = await planWithdraw(publicClient, account.address, owner);
      if (next.value === 0n) {
        setPlan(null);
        return 'Nothing to withdraw';
      }
      setPlan(next);
    });
  };

  const confirm = (confirmed: WithdrawPlan) => {
    void run('Withdrawing…', async () => {
      setPlan(null);
      const { blockNumber } = await txQueue.enqueue(() => withdrawPlanned(publicClient, walletClient, account, owner, confirmed));
      refreshBalance();
      return `Withdrew ${formatMon(confirmed.value)} (block ${blockNumber})`;
    });
  };

  return (
    <section>
      <h2>Funds</h2>
      <div className="row">
        <input value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Top-up amount in MON" inputMode="decimal" />
        <span>MON</span>
        <button onClick={doTopUp} disabled={busy || !onMonad}>
          Top up from wallet
        </button>
      </div>
      <div className="row">
        {plan === null ? (
          <button onClick={planIt} disabled={busy}>
            Withdraw to wallet…
          </button>
        ) : (
          <>
            <span>
              Withdraw <strong>{formatMon(plan.value)}</strong> to your wallet (the transfer fee is already deducted)?
            </span>
            <button onClick={() => confirm(plan)} disabled={busy}>
              Confirm
            </button>
            <button onClick={() => setPlan(null)} disabled={busy}>
              Cancel
            </button>
          </>
        )}
      </div>
    </section>
  );
}
