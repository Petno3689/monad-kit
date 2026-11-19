import { createPublicClient, createWalletClient, defineChain, http, type Account } from 'viem';
import { createRateLimitedFetch } from './rpcLimiter';

export const MONAD_CHAIN_ID = 10143 as const;
export const MONAD_RPC_URL = 'https://testnet-rpc.monad.xyz' as const;

export const monadTestnet = defineChain({
  id: MONAD_CHAIN_ID,
  name: 'Monad Testnet',
  blockTime: 400,
  nativeCurrency: { decimals: 18, name: 'MON', symbol: 'MON' },
  rpcUrls: { default: { http: [MONAD_RPC_URL] } },
});

// The public RPC allows about 15 requests/s per IP, shared with the wallet: stay at 10.
export const limitedFetch = createRateLimitedFetch({
  fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
  maxPerSecond: 10,
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});

const limitedTransport = () => http(MONAD_RPC_URL, { retryCount: 5, retryDelay: 400, fetchFn: limitedFetch });

export const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: limitedTransport(),
});

/** A wallet client for a local account, on the same rate-limited transport as `publicClient`. */
export function walletClientFor(account: Account) {
  return createWalletClient({ account, chain: monadTestnet, transport: limitedTransport() });
}
