import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { MONAD_CHAIN_ID, MONAD_RPC_URL, limitedFetch, monadTestnet, walletClientFor } from './chain';

describe('monadTestnet', () => {
  it('has the Monad testnet chain id and block time', () => {
    expect(MONAD_CHAIN_ID).toBe(10143);
    expect(monadTestnet.id).toBe(10143);
    expect(monadTestnet.blockTime).toBe(400);
  });

  it('points at the public RPC', () => {
    expect(MONAD_RPC_URL).toBe('https://testnet-rpc.monad.xyz');
    expect(monadTestnet.rpcUrls.default.http).toEqual(['https://testnet-rpc.monad.xyz']);
  });

  it('uses MON with 18 decimals', () => {
    expect(monadTestnet.nativeCurrency.symbol).toBe('MON');
    expect(monadTestnet.nativeCurrency.decimals).toBe(18);
  });
});

describe('shared transport', () => {
  it('exports the rate-limited fetch used by publicClient', () => {
    expect(typeof limitedFetch).toBe('function');
  });

  it('builds a wallet client on Monad testnet for the given account', () => {
    const account = privateKeyToAccount(`0x${'11'.repeat(32)}`);
    const wallet = walletClientFor(account);
    expect(wallet.chain.id).toBe(MONAD_CHAIN_ID);
    expect(wallet.account.address).toBe(account.address);
  });
});
