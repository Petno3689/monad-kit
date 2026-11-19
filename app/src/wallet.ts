import { toHex } from 'viem';
import type { Address, EIP1193Provider, Hex } from 'viem';
import { MONAD_CHAIN_ID, MONAD_RPC_URL } from './chain';
import type { Eip1193Request } from './funds';

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export const USER_REJECTED_CODE = 4001;
export const UNKNOWN_CHAIN_CODE = 4902;

/** The injected wallet (EIP-1193), or null when there is none. */
export function getInjectedProvider(): EIP1193Provider | null {
  return typeof window === 'undefined' ? null : (window.ethereum ?? null);
}

/** The provider's `request` as the plain EIP-1193 function the funds and logs modules take. */
export function toEip1193Request(provider: EIP1193Provider): Eip1193Request {
  return (args) => provider.request(args as never) as Promise<unknown>;
}

const codeOf = (error: unknown): unknown =>
  typeof error === 'object' && error !== null && 'code' in error ? (error as { code: unknown }).code : undefined;

/** The user rejected the wallet request (EIP-1193 code 4001), possibly wrapped. */
export function isUserRejection(error: unknown): boolean {
  if (codeOf(error) === USER_REJECTED_CODE) return true;
  const cause = typeof error === 'object' && error !== null && 'cause' in error ? (error as { cause: unknown }).cause : undefined;
  return codeOf(cause) === USER_REJECTED_CODE;
}

export async function requestAccounts(provider: EIP1193Provider): Promise<Address[]> {
  return (await toEip1193Request(provider)({ method: 'eth_requestAccounts' })) as Address[];
}

/** The accounts already shared with this site; empty when not connected. */
export async function currentAccounts(provider: EIP1193Provider): Promise<Address[]> {
  return (await toEip1193Request(provider)({ method: 'eth_accounts' })) as Address[];
}

export async function chainIdOf(provider: EIP1193Provider): Promise<number> {
  return Number(BigInt((await toEip1193Request(provider)({ method: 'eth_chainId' })) as string));
}

/** Switches the wallet to Monad testnet, adding the chain first when the wallet does not know it. Returns the chain id after. */
export async function switchToMonad(provider: EIP1193Provider): Promise<number> {
  const request = toEip1193Request(provider);
  const chainId = toHex(MONAD_CHAIN_ID);
  try {
    await request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  } catch (error) {
    if (codeOf(error) !== UNKNOWN_CHAIN_CODE) throw error;
    await request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId,
          chainName: 'Monad Testnet',
          rpcUrls: [MONAD_RPC_URL],
          nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
        },
      ],
    });
  }
  return chainIdOf(provider);
}

/** personal_sign of a text message by `owner`. */
export async function personalSign(provider: EIP1193Provider, message: string, owner: Address): Promise<Hex> {
  return (await toEip1193Request(provider)({ method: 'personal_sign', params: [toHex(message), owner] })) as Hex;
}

/** Asks the wallet to forget this site's permissions; not every wallet supports it. */
export async function revokePermissions(provider: EIP1193Provider): Promise<void> {
  try {
    await toEip1193Request(provider)({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] });
  } catch {
    // the wallet cannot revoke: the app simply stops using the account
  }
}

interface Emitter {
  on(event: string, listener: (arg: unknown) => void): void;
  removeListener?(event: string, listener: (arg: unknown) => void): void;
  off?(event: string, listener: (arg: unknown) => void): void;
}

export interface WalletEventHandlers {
  accountsChanged: (accounts: Address[]) => void;
  chainChanged: (chainId: number) => void;
}

/** Subscribes to the wallet's account and chain events; the returned function removes both listeners. */
export function onWalletEvents(provider: EIP1193Provider, handlers: WalletEventHandlers): () => void {
  const emitter = provider as unknown as Emitter;
  const accounts = (arg: unknown) => handlers.accountsChanged(arg as Address[]);
  const chain = (arg: unknown) => handlers.chainChanged(Number(BigInt(arg as string)));
  emitter.on('accountsChanged', accounts);
  emitter.on('chainChanged', chain);
  return () => {
    const remove = emitter.removeListener ?? emitter.off;
    remove?.call(emitter, 'accountsChanged', accounts);
    remove?.call(emitter, 'chainChanged', chain);
  };
}
