import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Address, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { monadTestnet, publicClient, walletClientFor } from './chain';
import {
  CHEST_GAME_ADDRESS,
  DEFAULT_GAS_MULTIPLIER_PCT,
  KEY_STORE_PREFIX,
  NAME_REGISTRY_ADDRESS,
  SESSION_MESSAGE,
} from './config';
import { describeError } from './errors';
import { displayName } from './names';
import { adoptBurner, createKeyStore, unlockSessionKey } from './sessionKey';
import type { MaybeStorage } from './sessionKey';
import {
  chainIdOf,
  currentAccounts,
  getInjectedProvider,
  onWalletEvents,
  personalSign,
  requestAccounts,
  revokePermissions,
  switchToMonad,
} from './wallet';
import { BoardPanel } from './ui/BoardPanel';
import { ChestPanel } from './ui/ChestPanel';
import { FundsPanel } from './ui/FundsPanel';
import { KeyPanel } from './ui/KeyPanel';
import { NicknamePanel } from './ui/NicknamePanel';
import type { KeyContext, Run } from './ui/shared';
import { usePoll } from './ui/usePoll';

const keyStore = createKeyStore(KEY_STORE_PREFIX);
const DISCONNECTED_FLAG = `${KEY_STORE_PREFIX}:disconnected`;
const BALANCE_EVERY_MS = 10_000;

function browserStorage(kind: 'localStorage' | 'sessionStorage'): MaybeStorage {
  try {
    return window[kind];
  } catch {
    return null;
  }
}

// After "Disconnect" the page must not silently reconnect on reload, even if the wallet kept the permission.
function readDisconnected(): boolean {
  try {
    return browserStorage('localStorage')?.getItem(DISCONNECTED_FLAG) === 'true';
  } catch {
    return false;
  }
}

function writeDisconnected(on: boolean) {
  try {
    if (on) browserStorage('localStorage')?.setItem(DISCONNECTED_FLAG, 'true');
    else browserStorage('localStorage')?.removeItem(DISCONNECTED_FLAG);
  } catch {
    // storage denied: the flag lives for this page only
  }
}

interface Notice {
  kind: 'ok' | 'error';
  text: string;
}

export default function App() {
  const [provider] = useState(getInjectedProvider);
  const [owner, setOwner] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [unlocked, setUnlocked] = useState<{ owner: Address; key: Hex } | null>(null);
  const [gasEdit, setGasEdit] = useState<{ address: Address; pct: number } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const busy = busyLabel !== null;
  const ownerRef = useRef<Address | null>(null);

  useEffect(() => {
    ownerRef.current = owner;
  }, [owner]);

  useEffect(() => {
    if (!provider) return;
    let cancelled = false;
    void (async () => {
      try {
        const [accounts, id] = await Promise.all([currentAccounts(provider), chainIdOf(provider)]);
        if (cancelled) return;
        if (!readDisconnected()) setOwner(accounts[0] ?? null);
        setChainId(id);
      } catch {
        // the wallet is not answering: the page stays disconnected
      }
    })();
    const unsubscribe = onWalletEvents(provider, {
      accountsChanged: (accounts) => {
        if (!readDisconnected()) setOwner(accounts[0] ?? null);
      },
      chainChanged: setChainId,
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [provider]);

  const run = useCallback<Run>(async (label, action) => {
    setBusyLabel(label);
    setNotice(null);
    try {
      const done = await action();
      if (done) setNotice({ kind: 'ok', text: done });
    } catch (error) {
      setNotice({ kind: 'error', text: describeError(error) });
    } finally {
      setBusyLabel(null);
    }
  }, []);

  const say = useCallback((kind: Notice['kind'], text: string) => setNotice({ kind, text }), []);

  const key = useMemo(() => {
    if (!owner) return null;
    if (unlocked?.owner === owner) return unlocked.key;
    return keyStore.loadKey(browserStorage('sessionStorage'), owner);
  }, [owner, unlocked]);
  const account = useMemo(() => (key ? privateKeyToAccount(key) : null), [key]);
  const walletClient = useMemo(() => (account ? walletClientFor(account) : null), [account]);
  const keyAddress = account?.address ?? null;

  const loadBalance = useMemo(
    () => (keyAddress ? () => publicClient.getBalance({ address: keyAddress }) : null),
    [keyAddress],
  );
  const balance = usePoll(loadBalance, BALANCE_EVERY_MS);

  const gasPct = !keyAddress
    ? DEFAULT_GAS_MULTIPLIER_PCT
    : gasEdit?.address === keyAddress
      ? gasEdit.pct
      : keyStore.getGasMultiplierPct(browserStorage('localStorage'), keyAddress);

  const setGasPct = (pct: number) => {
    if (!keyAddress) return;
    keyStore.setGasMultiplierPct(browserStorage('localStorage'), keyAddress, pct);
    setGasEdit({ address: keyAddress, pct: keyStore.getGasMultiplierPct(browserStorage('localStorage'), keyAddress) });
  };

  const connect = () => {
    if (!provider) return;
    void run('Connecting…', async () => {
      const accounts = await requestAccounts(provider);
      writeDisconnected(false);
      setOwner(accounts[0] ?? null);
      setChainId(await chainIdOf(provider));
    });
  };

  const disconnect = () => {
    if (!provider) return;
    // The key goes first: the wallet may keep the revoke request open indefinitely.
    writeDisconnected(true);
    if (owner) keyStore.clearKey(browserStorage('sessionStorage'), owner);
    setUnlocked(null);
    setOwner(null);
    void revokePermissions(provider);
  };

  const switchChain = () => {
    if (!provider) return;
    void run('Switching the network…', async () => {
      setChainId(await switchToMonad(provider));
    });
  };

  const unlock = () => {
    if (!provider || !owner) return;
    void run('Waiting for the wallet signature…', async () => {
      const session = browserStorage('sessionStorage');
      const local = browserStorage('localStorage');
      const result = await unlockSessionKey({
        owner,
        message: SESSION_MESSAGE,
        sign: (message) => personalSign(provider, message, owner),
        store: keyStore,
        session,
        local,
      });
      // The wallet may have switched accounts while its prompt was open.
      if (ownerRef.current !== owner) return;
      if (result.status === 'mismatch') {
        const accept = window.confirm(
          `This wallet now produces a different game key than this browser remembered.\n\n` +
            `Remembered: ${result.expected}\nNew: ${result.burner}\n\n` +
            `MON sent to the remembered key stays there and is not reachable from the new one. Use the new key?`,
        );
        if (!accept) return 'Game key not changed';
        adoptBurner({ owner, key: result.key, store: keyStore, session, local });
      }
      setUnlocked({ owner, key: result.key });
    });
  };

  const ctx: KeyContext | null =
    owner && account && walletClient
      ? {
          owner,
          account,
          walletClient,
          gasPct,
          onMonad: chainId === monadTestnet.id,
          busy,
          run,
          say,
          refreshBalance: balance.refresh,
        }
      : null;

  const onMonad = chainId === monadTestnet.id;

  return (
    <main>
      <h1>monad-kit demo</h1>

      {notice ? (
        <p className={`notice ${notice.kind}`} role="status">
          {notice.text}
        </p>
      ) : null}
      {busyLabel ? <p className="notice">{busyLabel}</p> : null}

      <section>
        <h2>Wallet</h2>
        {!provider ? <p>No browser wallet found. Install one (for example MetaMask) and reload.</p> : null}
        {provider && !owner ? (
          <button onClick={connect} disabled={busy}>
            Connect wallet
          </button>
        ) : null}
        {provider && owner ? (
          <p className="row">
            <span>
              Connected as <strong>{displayName('', owner)}</strong>
            </span>
            <button onClick={disconnect}>Disconnect</button>
          </p>
        ) : null}
        {provider && owner ? (
          <p className="row">
            <span>
              Network: {chainId === null ? '…' : onMonad ? `${monadTestnet.name} (${chainId})` : `wrong network (chain ${chainId})`}
            </span>
            {chainId !== null && !onMonad ? (
              <button onClick={switchChain} disabled={busy}>
                Switch to Monad testnet
              </button>
            ) : null}
          </p>
        ) : null}
      </section>

      {provider && owner ? (
        <KeyPanel
          address={keyAddress}
          balance={balance.value}
          gasPct={gasPct}
          busy={busy}
          onUnlock={unlock}
          onGasPct={setGasPct}
          onCopyFailed={(address) => say('error', `Could not copy. Game key address: ${address}`)}
        />
      ) : null}

      {provider && ctx ? <FundsPanel ctx={ctx} provider={provider} /> : null}

      {CHEST_GAME_ADDRESS === null ? (
        <section>
          <h2>Chest</h2>
          <p>Not deployed: set CHEST_GAME_ADDRESS in src/config.ts after deploying.</p>
        </section>
      ) : ctx ? (
        <ChestPanel key={ctx.account.address} ctx={ctx} chest={CHEST_GAME_ADDRESS} balance={balance.value} />
      ) : (
        <section>
          <h2>Chest</h2>
          <p>Connect your wallet and unlock the game key to open chests.</p>
        </section>
      )}

      {NAME_REGISTRY_ADDRESS === null ? (
        <section>
          <h2>Nickname</h2>
          <p>Not deployed: set NAME_REGISTRY_ADDRESS in src/config.ts after deploying.</p>
        </section>
      ) : ctx ? (
        <NicknamePanel key={ctx.account.address} ctx={ctx} registry={NAME_REGISTRY_ADDRESS} />
      ) : null}

      {CHEST_GAME_ADDRESS === null ? (
        <section>
          <h2>Score board</h2>
          <p>Not deployed: set CHEST_GAME_ADDRESS in src/config.ts after deploying.</p>
        </section>
      ) : (
        <BoardPanel chest={CHEST_GAME_ADDRESS} registry={NAME_REGISTRY_ADDRESS} me={keyAddress} />
      )}
    </main>
  );
}
