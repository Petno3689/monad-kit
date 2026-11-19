import { useCallback, useState } from 'react';
import type { Abi, Address } from 'viem';
import nameRegistryAbi from '../abi/nameRegistry.abi.json';
import { publicClient } from '../chain';
import { displayName, readNames, validateName } from '../names';
import { sendContractTx } from '../tx';
import { txQueue } from './shared';
import type { KeyContext } from './shared';
import { usePoll } from './usePoll';

const NAME_EVERY_MS = 10_000;

interface Props {
  ctx: KeyContext;
  registry: Address;
}

/** Remount with `key={game key address}`. The name belongs to the game key, the address that plays. */
export function NicknamePanel({ ctx, registry }: Props) {
  const { account, walletClient, gasPct, busy, run, say } = ctx;
  const [input, setInput] = useState('');

  const load = useCallback(
    async () => (await readNames(publicClient, registry, [account.address])).get(account.address.toLowerCase()) ?? '',
    [registry, account.address],
  );
  const current = usePoll(load, NAME_EVERY_MS);

  const send = (functionName: 'setName' | 'clearName', args: string[], done: string) =>
    void run(functionName === 'setName' ? 'Setting the nickname…' : 'Clearing the nickname…', async () => {
      await txQueue.enqueue(() =>
        sendContractTx({
          publicClient,
          walletClient,
          account,
          address: registry,
          abi: nameRegistryAbi as Abi,
          functionName,
          args,
          gasMultiplierPct: gasPct,
        }),
      );
      current.refresh();
      ctx.refreshBalance();
      return done;
    });

  const set = () => {
    const check = validateName(input);
    if (!check.ok) {
      say('error', check.reason);
      return;
    }
    send('setName', [check.name], `Nickname set to ${check.name}`);
  };

  return (
    <section>
      <h2>Nickname</h2>
      <p>Current: {current.value === undefined ? '…' : current.value === '' ? 'none' : displayName(current.value, account.address)}</p>
      <div className="row">
        <input value={input} onChange={(e) => setInput(e.target.value)} aria-label="Nickname" maxLength={40} placeholder="3–20 letters, digits, _ or -" />
        <button onClick={set} disabled={busy}>
          Set nickname
        </button>
        <button onClick={() => send('clearName', [], 'Nickname cleared')} disabled={busy || !current.value}>
          Clear
        </button>
      </div>
    </section>
  );
}
