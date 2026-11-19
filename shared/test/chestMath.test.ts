import { describe, expect, it } from "vitest";
import {
  EPIC_FROM,
  LEGENDARY_FROM,
  RARE_FROM,
  RARITY_NAMES,
  ROLL_RANGE,
  UNCOMMON_FROM,
  rarity,
  rarityName,
} from "../src/chestMath";

describe("chestMath", () => {
  it("keeps the Solidity constants", () => {
    expect(ROLL_RANGE).toBe(10_000n);
    expect(UNCOMMON_FROM).toBe(5_000n);
    expect(RARE_FROM).toBe(8_000n);
    expect(EPIC_FROM).toBe(9_500n);
    expect(LEGENDARY_FROM).toBe(9_950n);
  });

  it("cuts the roll at every threshold", () => {
    expect(rarity(0n)).toBe(1);
    expect(rarity(4_999n)).toBe(1);
    expect(rarity(5_000n)).toBe(2);
    expect(rarity(7_999n)).toBe(2);
    expect(rarity(8_000n)).toBe(3);
    expect(rarity(9_499n)).toBe(3);
    expect(rarity(9_500n)).toBe(4);
    expect(rarity(9_949n)).toBe(4);
    expect(rarity(9_950n)).toBe(5);
    expect(rarity(9_999n)).toBe(5);
    expect(rarity(10_000n)).toBe(1);
  });

  it("rejects values outside uint256", () => {
    expect(() => rarity(-1n)).toThrow(RangeError);
    expect(() => rarity(2n ** 256n)).toThrow(RangeError);
    expect(() => rarity(2n ** 256n - 1n)).not.toThrow();
  });

  it("names all five rarities", () => {
    expect(RARITY_NAMES).toHaveLength(5);
    expect(rarityName(1)).toBe("Common");
    expect(rarityName(2)).toBe("Uncommon");
    expect(rarityName(3)).toBe("Rare");
    expect(rarityName(4)).toBe("Epic");
    expect(rarityName(5)).toBe("Legendary");
  });
});
