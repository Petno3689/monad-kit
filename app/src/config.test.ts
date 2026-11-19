import { describe, expect, it } from 'vitest';
import { SESSION_MESSAGE } from './config';

describe('SESSION_MESSAGE', () => {
  it('is pinned to a literal: changing it changes every game key', () => {
    expect(SESSION_MESSAGE).toBe(
      [
        'monad-kit demo - game key',
        'Signing this creates your game key for Monad testnet (chain 10143).',
        'Version: session-key-v1',
        'Sign only on http://localhost:5173 - any site that gets this signature can play with your game key and spend its MON.',
      ].join('\n'),
    );
  });
});
