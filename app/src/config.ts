import type { Address } from 'viem';
import { buildSessionMessage } from './sessionKey';

// The kit's own deployment on Monad testnet (19 Nov 2026). A fork deploys its own contracts
// and puts their addresses here; while null, the chest, nickname and score board sections show
// "not deployed" and the rest of the demo still works.
export const CHEST_GAME_ADDRESS: Address | null = '0xC674f065eae134151B58F6D12b3A7a08bc9F6e84';
export const NAME_REGISTRY_ADDRESS: Address | null = '0x1a7C4F4DfC86f618B3debF61F2FEDB9Ac91c509B';

// The kit's own site. A fork MUST set its own origin BEFORE anyone funds a game key: the origin
// is part of the signed session message, so changing it changes every user's key (and strands
// their funds).
export const APP_ORIGIN = 'https://monad-kit.vercel.app';

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
// request already pending). Measured on Monad testnet on 19 Nov 2026: eth_estimateGas of open()
// from an address without a pending chest (a new player, cold writes) gave 239 648 gas, three
// times. 239 648 x 120 % = 287 578, rounded up to 300 000. For comparison, forge with the mock
// Pyth gives 209 406.
export const OPEN_GAS_FALLBACK = 300_000n;
