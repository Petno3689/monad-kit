import { describe, expect, it } from 'vitest';
import { MONAD_CHAIN_ID, MONAD_RPC_URL, monadTestnet } from './chain';

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
