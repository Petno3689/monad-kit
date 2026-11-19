import type { Address } from 'viem';
import { buildSessionMessage } from './sessionKey';

// Fill these in after deploying, from the deploy script's output. While null, the chest,
// nickname and score board sections show "not deployed" and the rest of the demo still works.
export const CHEST_GAME_ADDRESS: Address | null = null;
export const NAME_REGISTRY_ADDRESS: Address | null = null;

// MUST be set to the real site BEFORE anyone funds a game key: the origin is part of the
// signed session message, so changing it changes every user's key (and strands their funds).
export const APP_ORIGIN = 'http://localhost:5173';

/** The frozen text the owner signs to create the game key; built once, pinned by a test. */
export const SESSION_MESSAGE = buildSessionMessage({
  appName: 'monad-kit demo',
  networkName: 'Monad testnet',
  chainId: 10143,
  version: 'session-key-v1',
  origin: APP_ORIGIN,
});

export const KEY_STORE_PREFIX = 'monad-kit-demo';

export const DEFAULT_GAS_MULTIPLIER_PCT = 120;

// Used for the up-front cost only while `open` cannot be estimated (key without funds, or a
// request already pending). Measured with forge under Monad gas pricing (cold storage,
// PythEntropySource + MockEntropy): open() costs 209 406 gas, of which the mock's requestV2
// alone is 66 610; the real Pyth request costs more than the mock. 600 000 is a deliberate
// upper bound for the displayed cost, to be re-measured on testnet after deploy.
export const OPEN_GAS_FALLBACK = 600_000n;
