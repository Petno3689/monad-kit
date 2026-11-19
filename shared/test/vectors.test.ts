import { describe, expect, it } from "vitest";
import { parseChestVectors } from "./support/vectors";

describe("parseChestVectors", () => {
  it("rejects a word written as a number", () => {
    const json = '{"vectors":[{"label":"x","word":123,"rarity":0}]}';
    expect(() => parseChestVectors(json)).toThrow(/word must be a decimal string/);
  });

  it("rejects a rarity that is not a number", () => {
    const json = '{"vectors":[{"label":"x","word":"1","rarity":"0"}]}';
    expect(() => parseChestVectors(json)).toThrow(/rarity must be a number/);
  });

  it("parses a valid row to BigInt", () => {
    const word = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
    const json = `{"vectors":[{"label":"max","word":"${word}","rarity":4}]}`;
    expect(parseChestVectors(json)).toEqual([{ label: "max", word: BigInt(word), rarity: 4 }]);
  });
});
