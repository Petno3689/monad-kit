import { describe, expect, it } from "vitest";
import { rarity } from "../src/chestMath";
import { loadChestVectors } from "./support/vectors";

describe("chestMath golden vectors", () => {
  const vectors = loadChestVectors();

  it("has at least 1015 rows", () => {
    expect(vectors.length).toBeGreaterThanOrEqual(1015);
  });

  it("matches ChestMath.rarity on every row", () => {
    vectors.forEach((v, i) => {
      expect(rarity(v.word), `row ${i} word=${v.word}`).toBe(v.rarity);
    });
  });
});
