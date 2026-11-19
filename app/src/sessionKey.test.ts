import { describe, expect, it } from 'vitest';
import { keccak256, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  NonDeterministicSignatureError,
  adoptBurner,
  buildSessionMessage,
  createKeyStore,
  deriveSessionKey,
  unlockSessionKey,
  type StorageLike,
} from './sessionKey';

const store = createKeyStore('portal-lab');
const {
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
} = store;

function memoryStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

const deniedStorage: StorageLike = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('denied');
  },
  removeItem: () => {
    throw new Error('denied');
  },
};

const OWNER = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01' as Address;
const BURNER_A = '0x1111111111111111111111111111111111111111' as Address;
const BURNER_B = '0x2222222222222222222222222222222222222222' as Address;
const SIGNATURE_A = `0x${'ab'.repeat(65)}` as Hex;
const SIGNATURE_B = `0x${'cd'.repeat(65)}` as Hex;
const KEY = `0x${'11'.repeat(32)}` as Hex;

describe('deriveSessionKey', () => {
  it('gives the same key and address for the same signature', () => {
    const first = deriveSessionKey(SIGNATURE_A);
    const second = deriveSessionKey(SIGNATURE_A);
    expect(first).toBe(second);
    expect(first).toBe(keccak256(SIGNATURE_A));
    expect(privateKeyToAccount(first).address).toBe(privateKeyToAccount(second).address);
  });

  it('gives a different address for a different signature', () => {
    const a = privateKeyToAccount(deriveSessionKey(SIGNATURE_A));
    const b = privateKeyToAccount(deriveSessionKey(SIGNATURE_B));
    expect(a.address).not.toBe(b.address);
  });
});

describe('buildSessionMessage', () => {
  it("reproduces the Unstable Portals Lab message byte for byte", () => {
    const expected =
      'Unstable Portals Lab - game key\n' +
      'Signing this creates your game key for Monad testnet (chain 10143).\n' +
      'Version: session-key-v1\n' +
      'Sign only on https://portal-lab-monad.vercel.app - any site that gets this signature can play with your game key and spend its MON.';
    const built = buildSessionMessage({
      appName: 'Unstable Portals Lab',
      networkName: 'Monad testnet',
      chainId: 10143,
      version: 'session-key-v1',
      origin: 'https://portal-lab-monad.vercel.app',
    });
    expect(built).toBe(expected);
    expect(new TextEncoder().encode(built)).toEqual(new TextEncoder().encode(expected));
    expect(built.split('\n')).toHaveLength(4);
    expect(built.endsWith('\n')).toBe(false);
    expect([...built].every((c) => c.charCodeAt(0) < 128)).toBe(true);
  });

  it('changes when any parameter changes', () => {
    const base = { appName: 'A', networkName: 'N', chainId: 1, version: 'v1', origin: 'https://a' };
    const message = buildSessionMessage(base);
    for (const change of [{ appName: 'B' }, { networkName: 'M' }, { chainId: 2 }, { version: 'v2' }, { origin: 'https://b' }]) {
      expect(buildSessionMessage({ ...base, ...change })).not.toBe(message);
    }
  });
});

describe('session key storage', () => {
  it('round-trips and clears, keyed by the lowercase owner', () => {
    const storage = memoryStorage();
    expect(loadKey(storage, OWNER)).toBeNull();
    saveKey(storage, OWNER, KEY);
    expect(loadKey(storage, OWNER)).toBe(KEY);
    expect([...storage.map.keys()]).toEqual([`portal-lab:session-key:${OWNER.toLowerCase()}`]);
    clearKey(storage, OWNER);
    expect(loadKey(storage, OWNER)).toBeNull();
    expect(storage.map.size).toBe(0);
  });

  it('ignores a stored value that is not a private key', () => {
    const storage = memoryStorage();
    storage.map.set(`portal-lab:session-key:${OWNER.toLowerCase()}`, '0x1234');
    expect(loadKey(storage, OWNER)).toBeNull();
  });

  it('survives storage that throws or is missing', () => {
    expect(() => saveKey(deniedStorage, OWNER, KEY)).not.toThrow();
    expect(() => clearKey(deniedStorage, OWNER)).not.toThrow();
    expect(loadKey(deniedStorage, OWNER)).toBeNull();
    expect(loadKey(null, OWNER)).toBeNull();
  });
});

describe('checkBurner', () => {
  it('reports new, match and mismatch', () => {
    const storage = memoryStorage();
    expect(checkBurner(storage, OWNER, BURNER_A)).toBe('new');
    rememberBurner(storage, OWNER, BURNER_A);
    expect(checkBurner(storage, OWNER, BURNER_A)).toBe('match');
    expect(checkBurner(storage, OWNER, BURNER_B)).toBe('mismatch');
  });

  it('compares addresses without regard to case', () => {
    const storage = memoryStorage();
    const mixed = '0xAAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa' as Address;
    rememberBurner(storage, OWNER, mixed);
    expect(checkBurner(storage, OWNER, mixed.toLowerCase() as Address)).toBe('match');
  });

  it('overwrites the record on rememberBurner and stores only the address', () => {
    const storage = memoryStorage();
    rememberBurner(storage, OWNER, BURNER_A);
    rememberBurner(storage, OWNER, BURNER_B);
    expect(rememberedBurner(storage, OWNER)).toBe(BURNER_B);
    expect(checkBurner(storage, OWNER, BURNER_B)).toBe('match');
    expect([...storage.map.entries()]).toEqual([[`portal-lab:burner-of:${OWNER.toLowerCase()}`, BURNER_B]]);
  });
});

describe('gas multiplier', () => {
  it('defaults to 120', () => {
    expect(getGasMultiplierPct(memoryStorage(), BURNER_A)).toBe(120);
    expect(getGasMultiplierPct(null, BURNER_A)).toBe(120);
  });

  it('persists per burner', () => {
    const storage = memoryStorage();
    setGasMultiplierPct(storage, BURNER_A, 150);
    expect(getGasMultiplierPct(storage, BURNER_A)).toBe(150);
    expect(getGasMultiplierPct(storage, BURNER_B)).toBe(120);
    expect(storage.map.get(`portal-lab:gas-multiplier-pct:${BURNER_A.toLowerCase()}`)).toBe('150');
  });

  it('clamps to [100, 200] on write and on read', () => {
    const storage = memoryStorage();
    setGasMultiplierPct(storage, BURNER_A, 50);
    expect(getGasMultiplierPct(storage, BURNER_A)).toBe(100);
    setGasMultiplierPct(storage, BURNER_A, 500);
    expect(getGasMultiplierPct(storage, BURNER_A)).toBe(200);
    storage.map.set(`portal-lab:gas-multiplier-pct:${BURNER_A.toLowerCase()}`, '999');
    expect(getGasMultiplierPct(storage, BURNER_A)).toBe(200);
  });

  it('keeps integers and falls back on garbage', () => {
    const storage = memoryStorage();
    setGasMultiplierPct(storage, BURNER_A, 133.6);
    expect(storage.map.get(`portal-lab:gas-multiplier-pct:${BURNER_A.toLowerCase()}`)).toBe('134');
    setGasMultiplierPct(storage, BURNER_A, Number.NaN);
    expect(getGasMultiplierPct(storage, BURNER_A)).toBe(120);
    storage.map.set(`portal-lab:gas-multiplier-pct:${BURNER_A.toLowerCase()}`, 'lots');
    expect(getGasMultiplierPct(storage, BURNER_A)).toBe(120);
  });
});

describe.each([
  ['auto-word', true],
  ['auto-settle', false],
])('flag %s', (name, defaultOn) => {
  it('falls back to the default when unset, denied or missing', () => {
    expect(getFlag(memoryStorage(), name, BURNER_A, defaultOn)).toBe(defaultOn);
    expect(getFlag(null, name, BURNER_A, defaultOn)).toBe(defaultOn);
    expect(getFlag(deniedStorage, name, BURNER_A, defaultOn)).toBe(defaultOn);
  });

  it('persists per burner under the lowercase address', () => {
    const storage = memoryStorage();
    setFlag(storage, name, BURNER_A, !defaultOn);
    expect(getFlag(storage, name, BURNER_A, defaultOn)).toBe(!defaultOn);
    expect(getFlag(storage, name, BURNER_B, defaultOn)).toBe(defaultOn);
    expect(storage.map.get(`portal-lab:${name}:${BURNER_A.toLowerCase()}`)).toBe(String(!defaultOn));
    setFlag(storage, name, BURNER_A, defaultOn);
    expect(getFlag(storage, name, BURNER_A, defaultOn)).toBe(defaultOn);
  });

  it('falls back to the default on anything but true/false', () => {
    const storage = memoryStorage();
    for (const garbage of ['maybe', '', 'TRUE', '1']) {
      storage.map.set(`portal-lab:${name}:${BURNER_A.toLowerCase()}`, garbage);
      expect(getFlag(storage, name, BURNER_A, defaultOn), garbage).toBe(defaultOn);
    }
  });

  it('does not throw when storage is denied', () => {
    expect(() => setFlag(deniedStorage, name, BURNER_A, false)).not.toThrow();
  });
});

describe('createKeyStore prefix', () => {
  it('namespaces every kind under its prefix', () => {
    const storage = memoryStorage();
    const other = createKeyStore('other-app');
    other.saveKey(storage, OWNER, KEY);
    other.rememberBurner(storage, OWNER, BURNER_A);
    other.setGasMultiplierPct(storage, BURNER_A, 130);
    other.setFlag(storage, 'auto', BURNER_A, true);
    expect(storage.map.size).toBe(4);
    expect([...storage.map.keys()].every((k) => k.startsWith('other-app:'))).toBe(true);
    expect(loadKey(storage, OWNER)).toBeNull();
  });
});

describe('unlockSessionKey', () => {
  const message = 'test message';
  const BURNER_OF_A = privateKeyToAccount(deriveSessionKey(SIGNATURE_A)).address;

  function setup(signatures: Hex[]) {
    const session = memoryStorage();
    const local = memoryStorage();
    let calls = 0;
    const signed: string[] = [];
    const sign = async (m: string) => {
      signed.push(m);
      return signatures[Math.min(calls++, signatures.length - 1)];
    };
    return { session, local, signed, params: { owner: OWNER, message, sign, store, session, local } };
  }

  it('returns a cached key without signing', async () => {
    const t = setup([SIGNATURE_A]);
    saveKey(t.session, OWNER, KEY);
    const result = await unlockSessionKey(t.params);
    expect(result).toEqual({ status: 'cached', key: KEY });
    expect(t.signed).toHaveLength(0);
  });

  it('signs exactly twice for a new burner, then stores key and burner', async () => {
    const t = setup([SIGNATURE_A, SIGNATURE_A]);
    const result = await unlockSessionKey(t.params);
    expect(result).toEqual({ status: 'new', key: deriveSessionKey(SIGNATURE_A) });
    expect(t.signed).toEqual([message, message]);
    expect(loadKey(t.session, OWNER)).toBe(deriveSessionKey(SIGNATURE_A));
    expect(rememberedBurner(t.local, OWNER)).toBe(BURNER_OF_A);
  });

  it('throws and stores nothing when the two signatures differ', async () => {
    const t = setup([SIGNATURE_A, SIGNATURE_B]);
    await expect(unlockSessionKey(t.params)).rejects.toBeInstanceOf(NonDeterministicSignatureError);
    expect(t.signed).toHaveLength(2);
    expect(t.session.map.size).toBe(0);
    expect(t.local.map.size).toBe(0);
  });

  it('signs once on a match and saves the key', async () => {
    const t = setup([SIGNATURE_A]);
    rememberBurner(t.local, OWNER, BURNER_OF_A);
    const result = await unlockSessionKey(t.params);
    expect(result).toEqual({ status: 'match', key: deriveSessionKey(SIGNATURE_A) });
    expect(t.signed).toHaveLength(1);
    expect(loadKey(t.session, OWNER)).toBe(deriveSessionKey(SIGNATURE_A));
  });

  it('stores nothing on a mismatch until adoptBurner', async () => {
    const t = setup([SIGNATURE_B]);
    rememberBurner(t.local, OWNER, BURNER_OF_A);
    const result = await unlockSessionKey(t.params);
    const key = deriveSessionKey(SIGNATURE_B);
    const burner = privateKeyToAccount(key).address;
    expect(result).toEqual({ status: 'mismatch', expected: BURNER_OF_A, key, burner });
    expect(t.signed).toHaveLength(1);
    expect(loadKey(t.session, OWNER)).toBeNull();
    expect(rememberedBurner(t.local, OWNER)).toBe(BURNER_OF_A);

    expect(adoptBurner({ owner: OWNER, key, store, session: t.session, local: t.local })).toBe(burner);
    expect(loadKey(t.session, OWNER)).toBe(key);
    expect(rememberedBurner(t.local, OWNER)).toBe(burner);
  });

  it('propagates a rejected signature and stores nothing', async () => {
    const session = memoryStorage();
    const local = memoryStorage();
    const sign = async (): Promise<Hex> => {
      throw new Error('rejected');
    };
    await expect(unlockSessionKey({ owner: OWNER, message, sign, store, session, local })).rejects.toThrow('rejected');
    expect(session.map.size + local.map.size).toBe(0);
  });
});
