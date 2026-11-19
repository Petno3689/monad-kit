import { describe, expect, it } from 'vitest';
import type { Address, PublicClient } from 'viem';
import { displayName, readNames, shortAddress, validateName } from './names';

const LENGTH = '3 to 20 characters';
const CHARSET = 'Only Latin letters, digits, _ and -';

describe('validateName', () => {
  it('enforces the length bounds', () => {
    expect(validateName('ab')).toEqual({ ok: false, reason: LENGTH });
    expect(validateName('abc')).toEqual({ ok: true, name: 'abc' });
    expect(validateName('a'.repeat(20))).toEqual({ ok: true, name: 'a'.repeat(20) });
    expect(validateName('a'.repeat(21))).toEqual({ ok: false, reason: LENGTH });
  });

  it('accepts every allowed class', () => {
    expect(validateName('abcxyz').ok).toBe(true);
    expect(validateName('ABCXYZ').ok).toBe(true);
    expect(validateName('012789').ok).toBe(true);
    expect(validateName('a_b').ok).toBe(true);
    expect(validateName('a-b').ok).toBe(true);
  });

  it('rejects other characters', () => {
    for (const bad of ['ab cd', 'ab.cd', 'ab@cd', 'привет', 'ab😀cd']) {
      expect(validateName(bad)).toEqual({ ok: false, reason: CHARSET });
    }
  });

  it('measures length in bytes', () => {
    // 2 Cyrillic characters = 4 bytes: in bounds, so the charset is what fails.
    expect(validateName('пр')).toEqual({ ok: false, reason: CHARSET });
    // 12 Cyrillic characters = 24 bytes: out of bounds.
    expect(validateName('приветпривет')).toEqual({ ok: false, reason: LENGTH });
  });

  it('rejects empty input', () => {
    expect(validateName('')).toEqual({ ok: false, reason: LENGTH });
    expect(validateName('   ')).toEqual({ ok: false, reason: LENGTH });
  });

  it('trims surrounding spaces', () => {
    expect(validateName('  abc  ')).toEqual({ ok: true, name: 'abc' });
    expect(validateName(' ab ')).toEqual({ ok: false, reason: LENGTH });
  });
});

describe('display', () => {
  const address = '0x0540000000000000000000000000000000CcA6'.padEnd(42, '0').slice(0, 38) + 'CcA6';
  it('shortens an address', () => {
    expect(shortAddress(address)).toBe(`${address.slice(0, 6)}…CcA6`);
  });
  it('joins name and address, or shows the address alone', () => {
    expect(displayName('neo', address)).toBe(`neo · ${shortAddress(address)}`);
    expect(displayName('', address)).toBe(shortAddress(address));
  });
});

describe('readNames', () => {
  const REGISTRY = '0x00000000000000000000000000000000000000aa' as Address;
  const addr = (i: number) => `0x${i.toString(16).padStart(40, '0').toUpperCase()}` as Address;

  it('reads 250 players in calls of 100, 100 and 50 and keys by lowercase address', async () => {
    const players = Array.from({ length: 250 }, (_, i) => addr(i + 1));
    const sizes: number[] = [];
    const client = {
      readContract: async (args: { address: Address; functionName: string; args: [Address[]] }) => {
        expect(args.address).toBe(REGISTRY);
        expect(args.functionName).toBe('namesOf');
        sizes.push(args.args[0].length);
        return args.args[0].map((p) => (p === players[7] ? '' : `n-${p.slice(-4)}`));
      },
    } as unknown as Pick<PublicClient, 'readContract'>;
    const names = await readNames(client, REGISTRY, players);
    expect(sizes).toEqual([100, 100, 50]);
    expect(names.size).toBe(250);
    expect(names.get(players[0].toLowerCase())).toBe(`n-${players[0].slice(-4)}`);
    expect(names.get(players[7].toLowerCase())).toBe('');
    expect(names.get(players[249].toLowerCase())).toBe(`n-${players[249].slice(-4)}`);
  });

  it('makes no call for no players', async () => {
    let calls = 0;
    const client = {
      readContract: async () => {
        calls += 1;
        return [];
      },
    } as unknown as Pick<PublicClient, 'readContract'>;
    expect((await readNames(client, REGISTRY, [])).size).toBe(0);
    expect(calls).toBe(0);
  });
});
