import { describe, expect, it } from 'vitest';
import type { EIP1193Provider } from 'viem';
import { isUserRejection, onWalletEvents, personalSign, switchToMonad, toEip1193Request } from './wallet';

type Listener = (arg: unknown) => void;

function fakeProvider(options: { unknownChain?: boolean } = {}) {
  const calls: { method: string; params?: unknown }[] = [];
  const listeners = new Map<string, Set<Listener>>();
  let chainId = '0x1';
  const provider = {
    request: async ({ method, params }: { method: string; params?: unknown }) => {
      calls.push({ method, params });
      if (method === 'wallet_switchEthereumChain') {
        if (options.unknownChain) throw Object.assign(new Error('unknown chain'), { code: 4902 });
        chainId = '0x279f';
        return null;
      }
      if (method === 'wallet_addEthereumChain') {
        chainId = '0x279f';
        return null;
      }
      if (method === 'eth_chainId') return chainId;
      if (method === 'personal_sign') return '0xsig';
      throw new Error(`unexpected ${method}`);
    },
    on: (event: string, listener: Listener) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
    },
    removeListener: (event: string, listener: Listener) => {
      listeners.get(event)?.delete(listener);
    },
  };
  const count = (event: string) => listeners.get(event)?.size ?? 0;
  return { provider: provider as unknown as EIP1193Provider, calls, listeners, count };
}

describe('switchToMonad', () => {
  it('switches and re-reads the chain id', async () => {
    const { provider, calls } = fakeProvider();
    expect(await switchToMonad(provider)).toBe(10143);
    expect(calls.map((c) => c.method)).toEqual(['wallet_switchEthereumChain', 'eth_chainId']);
    expect(calls[0].params).toEqual([{ chainId: '0x279f' }]);
  });

  it('adds the chain when the wallet answers 4902, then re-reads the chain id', async () => {
    const { provider, calls } = fakeProvider({ unknownChain: true });
    expect(await switchToMonad(provider)).toBe(10143);
    expect(calls.map((c) => c.method)).toEqual(['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'eth_chainId']);
    expect(calls[1].params).toEqual([
      {
        chainId: '0x279f',
        chainName: 'Monad Testnet',
        rpcUrls: ['https://testnet-rpc.monad.xyz'],
        nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
      },
    ]);
  });

  it('rethrows any other switch error without adding the chain', async () => {
    const calls: string[] = [];
    const provider = {
      request: async ({ method }: { method: string }) => {
        calls.push(method);
        throw Object.assign(new Error('rejected'), { code: 4001 });
      },
    } as unknown as EIP1193Provider;
    await expect(switchToMonad(provider)).rejects.toMatchObject({ code: 4001 });
    expect(calls).toEqual(['wallet_switchEthereumChain']);
  });
});

describe('onWalletEvents', () => {
  it('delivers accounts and a numeric chain id, and the unsubscribe removes both listeners', () => {
    const { provider, count, listeners } = fakeProvider();
    const seen: unknown[] = [];
    const off = onWalletEvents(provider, {
      accountsChanged: (a) => seen.push(a),
      chainChanged: (id) => seen.push(id),
    });
    expect(count('accountsChanged')).toBe(1);
    expect(count('chainChanged')).toBe(1);
    listeners.get('accountsChanged')!.forEach((l) => l(['0xabc']));
    listeners.get('chainChanged')!.forEach((l) => l('0x279f'));
    expect(seen).toEqual([['0xabc'], 10143]);
    off();
    expect(count('accountsChanged')).toBe(0);
    expect(count('chainChanged')).toBe(0);
  });
});

describe('isUserRejection', () => {
  it('is true for code 4001, also when wrapped as a cause', () => {
    expect(isUserRejection({ code: 4001 })).toBe(true);
    expect(isUserRejection(new Error('x', { cause: { code: 4001 } }))).toBe(true);
  });
  it('is false for other codes and non-objects', () => {
    expect(isUserRejection({ code: 4902 })).toBe(false);
    expect(isUserRejection(new Error('x'))).toBe(false);
    expect(isUserRejection(null)).toBe(false);
    expect(isUserRejection('4001')).toBe(false);
  });
});

describe('personalSign and the request adapter', () => {
  it('signs the hex-encoded message for the owner', async () => {
    const { provider, calls } = fakeProvider();
    const owner = '0x1111111111111111111111111111111111111111';
    expect(await personalSign(provider, 'hi', owner)).toBe('0xsig');
    expect(calls).toEqual([{ method: 'personal_sign', params: ['0x6869', owner] }]);
  });

  it('adapts the provider to a plain request function', async () => {
    const { provider } = fakeProvider();
    expect(await toEip1193Request(provider)({ method: 'eth_chainId' })).toBe('0x1');
  });
});
