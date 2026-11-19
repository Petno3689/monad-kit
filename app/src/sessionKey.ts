import { keccak256, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

/** The part of the Web Storage API used here; `null` when the browser denies storage. */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type MaybeStorage = StorageLike | null;

export interface SessionMessageParams {
  appName: string;
  networkName: string;
  chainId: number;
  version: string;
  origin: string;
}

/**
 * The four-line text the owner signs to create the game key. Freezing it is the app's job:
 * changing any byte of the result changes every user's key, so build it once, test it
 * against a literal, and never edit the parameters after release.
 */
export function buildSessionMessage({ appName, networkName, chainId, version, origin }: SessionMessageParams): string {
  return [
    `${appName} - game key`,
    `Signing this creates your game key for ${networkName} (chain ${chainId}).`,
    `Version: ${version}`,
    `Sign only on ${origin} - any site that gets this signature can play with your game key and spend its MON.`,
  ].join('\n');
}

const GAS_PCT_MIN = 100;
const GAS_PCT_MAX = 200;
const GAS_PCT_DEFAULT = 120;

function read(storage: MaybeStorage, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(storage: MaybeStorage, key: string, value: string) {
  try {
    storage?.setItem(key, value);
  } catch {
    // storage full or denied: the value lives for this page only
  }
}

function remove(storage: MaybeStorage, key: string) {
  try {
    storage?.removeItem(key);
  } catch {
    // storage denied: nothing was stored
  }
}

/** The burner's private key: the hash of the owner's signature over the session message. */
export function deriveSessionKey(signature: Hex): Hex {
  return keccak256(signature);
}

const clampGasPct = (pct: number) => Math.min(GAS_PCT_MAX, Math.max(GAS_PCT_MIN, Math.round(pct)));

export type BurnerCheck = 'new' | 'match' | 'mismatch';

/** All browser-storage access of the game key, namespaced as `${prefix}:<kind>:<lowercase address>`. */
export function createKeyStore(prefix: string) {
  const keyOf = (kind: string, address: Address) => `${prefix}:${kind}:${address.toLowerCase()}`;

  // The key itself: pass sessionStorage only, so that it dies with the tab.
  const loadKey = (storage: MaybeStorage, owner: Address): Hex | null => {
    const key = read(storage, keyOf('session-key', owner));
    return key && /^0x[0-9a-fA-F]{64}$/.test(key) ? (key as Hex) : null;
  };

  const saveKey = (storage: MaybeStorage, owner: Address, key: Hex) => {
    write(storage, keyOf('session-key', owner), key);
  };

  const clearKey = (storage: MaybeStorage, owner: Address) => {
    remove(storage, keyOf('session-key', owner));
  };

  // The burner ADDRESS this browser saw for `owner`, never the key: it reveals a wallet
  // whose signatures are not deterministic before funds go to an address it cannot recreate.
  const rememberedBurner = (storage: MaybeStorage, owner: Address): string | null =>
    read(storage, keyOf('burner-of', owner));

  const rememberBurner = (storage: MaybeStorage, owner: Address, burner: Address) => {
    write(storage, keyOf('burner-of', owner), burner);
  };

  const checkBurner = (storage: MaybeStorage, owner: Address, burner: Address): BurnerCheck => {
    const known = rememberedBurner(storage, owner);
    if (known === null) return 'new';
    return known.toLowerCase() === burner.toLowerCase() ? 'match' : 'mismatch';
  };

  const getGasMultiplierPct = (storage: MaybeStorage, burner: Address): number => {
    const raw = read(storage, keyOf('gas-multiplier-pct', burner));
    return raw !== null && /^\d+$/.test(raw) ? clampGasPct(Number(raw)) : GAS_PCT_DEFAULT;
  };

  const setGasMultiplierPct = (storage: MaybeStorage, burner: Address, pct: number) => {
    write(storage, keyOf('gas-multiplier-pct', burner), String(Number.isFinite(pct) ? clampGasPct(pct) : GAS_PCT_DEFAULT));
  };

  // A per-burner boolean: only 'true' and 'false' are valid, anything else reads as `defaultOn`.
  const getFlag = (storage: MaybeStorage, name: string, burner: Address, defaultOn: boolean): boolean => {
    const raw = read(storage, keyOf(name, burner));
    return raw === 'true' ? true : raw === 'false' ? false : defaultOn;
  };

  const setFlag = (storage: MaybeStorage, name: string, burner: Address, on: boolean) => {
    write(storage, keyOf(name, burner), String(on));
  };

  return {
    loadKey,
    saveKey,
    clearKey,
    rememberedBurner,
    rememberBurner,
    checkBurner,
    getGasMultiplierPct,
    setGasMultiplierPct,
    getFlag,
    setFlag,
  };
}

export type KeyStore = ReturnType<typeof createKeyStore>;

/** Two signatures of the same message differed: this wallet cannot recreate its game key. */
export class NonDeterministicSignatureError extends Error {
  constructor() {
    super('The wallet signed the same message twice and produced different signatures, so a game key cannot be recreated from it.');
    this.name = 'NonDeterministicSignatureError';
  }
}

export interface UnlockParams {
  owner: Address;
  message: string;
  /** Asks the wallet to sign `message` (personal_sign); injected so it can be faked. */
  sign: (message: string) => Promise<Hex>;
  store: KeyStore;
  /** sessionStorage: holds the key. */
  session: MaybeStorage;
  /** localStorage: holds the burner address only. */
  local: MaybeStorage;
}

export type UnlockResult =
  | { status: 'cached' | 'match' | 'new'; key: Hex }
  | { status: 'mismatch'; expected: string; key: Hex; burner: Address };

/**
 * Gets the game key for `owner`. A key already in sessionStorage is returned without a
 * signature. Otherwise the wallet signs once; a first-ever unlock ('new') signs a second
 * time to prove the wallet's signatures are deterministic before any funds are sent to
 * the derived address. On 'mismatch' nothing is stored: the UI decides, then calls `adoptBurner`.
 */
export async function unlockSessionKey({ owner, message, sign, store, session, local }: UnlockParams): Promise<UnlockResult> {
  const cached = store.loadKey(session, owner);
  if (cached) return { status: 'cached', key: cached };

  const signature = await sign(message);
  const key = deriveSessionKey(signature);
  const burner = privateKeyToAccount(key).address;
  const known = store.checkBurner(local, owner, burner);

  if (known === 'mismatch') {
    return { status: 'mismatch', expected: store.rememberedBurner(local, owner) ?? '', key, burner };
  }
  if (known === 'new') {
    const again = await sign(message);
    if (again.toLowerCase() !== signature.toLowerCase()) throw new NonDeterministicSignatureError();
    store.rememberBurner(local, owner, burner);
  }
  store.saveKey(session, owner, key);
  return { status: known, key };
}

/** The owner accepted the key of a 'mismatch': remember its burner and keep the key for this tab. */
export function adoptBurner({ owner, key, store, session, local }: Pick<UnlockParams, 'owner' | 'store' | 'session' | 'local'> & { key: Hex }): Address {
  const burner = privateKeyToAccount(key).address;
  store.rememberBurner(local, owner, burner);
  store.saveKey(session, owner, key);
  return burner;
}
