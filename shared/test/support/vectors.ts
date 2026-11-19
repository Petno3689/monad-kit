// Golden-vector file format (shared/test/vectors/*.json):
//  - {"vectors":[ ... ]}: an array of objects, one object per line;
//  - integers wider than 48 bits (the uint256 word) are decimal STRINGS, because
//    JSON.parse rounds anything above 2^53; read them with BigInt;
//  - "label" is a human note and is never asserted;
//  - files come only from the Solidity generator scripts, never by hand;
//  - the Solidity golden test and the TS golden test read the same file.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface ChestVector {
  label: string;
  word: bigint;
  rarity: number;
}

const CHEST_VECTORS = fileURLToPath(new URL("../vectors/chest-vectors.json", import.meta.url));

export function loadChestVectors(): ChestVector[] {
  if (!existsSync(CHEST_VECTORS)) {
    throw new Error(
      "chest-vectors.json is missing: run `forge script script/GenChestVectors.s.sol` from contracts/",
    );
  }
  const parsed = JSON.parse(readFileSync(CHEST_VECTORS, "utf8")) as {
    vectors: { label: string; word: string; rarity: number }[];
  };
  return parsed.vectors.map((v) => ({ label: v.label, word: BigInt(v.word), rarity: v.rarity }));
}
