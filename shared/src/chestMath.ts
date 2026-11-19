// Mirror of contracts/src/ChestMath.sol. Any change there must be made here too
// (and the vectors regenerated); the golden test proves the two still agree.

export const ROLL_RANGE = 10_000n;
export const UNCOMMON_FROM = 5_000n;
export const RARE_FROM = 8_000n;
export const EPIC_FROM = 9_500n;
export const LEGENDARY_FROM = 9_950n;

export type Rarity = 1 | 2 | 3 | 4 | 5;

export const RARITY_NAMES = ["Common", "Uncommon", "Rare", "Epic", "Legendary"] as const;

const UINT256_LIMIT = 2n ** 256n;

/** The rarity (1..5) a chest opened with `word` gets. `word` must be a uint256. */
export function rarity(word: bigint): Rarity {
  if (word < 0n || word >= UINT256_LIMIT) {
    throw new RangeError(`word is not a uint256: ${word}`);
  }
  const roll = word % ROLL_RANGE;
  if (roll < UNCOMMON_FROM) return 1;
  if (roll < RARE_FROM) return 2;
  if (roll < EPIC_FROM) return 3;
  if (roll < LEGENDARY_FROM) return 4;
  return 5;
}

export function rarityName(r: Rarity): string {
  return RARITY_NAMES[r - 1];
}
