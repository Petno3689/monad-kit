import { describe, expect, it } from 'vitest';
import source from './App.tsx?raw';

// Source-level guard for one bug class: duplicate sibling `key` expressions in App.tsx
// (they made the Chest panel multiply on the live demo). It is not a render test.
describe('App.tsx JSX keys', () => {
  it('has no two identical key={...} expressions', () => {
    const keys = [...source.matchAll(/\bkey=\{(.*?)\}(?=\s|\/?>)/g)].map((m) => (m[1] ?? '').trim());
    expect(keys.length).toBeGreaterThan(0);
    const duplicates = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(
      duplicates,
      `Duplicate JSX key expressions in App.tsx (sibling keys must be unique): ${[...new Set(duplicates)].join(', ')}`,
    ).toEqual([]);
  });
});
