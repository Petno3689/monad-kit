// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Test} from "forge-std/Test.sol";
import {ChestMath} from "../src/ChestMath.sol";

/// @title ChestMathGoldenTest — checks ChestMath.rarity against
/// shared/test/vectors/chest-vectors.json, the file the TS mirror is tested with.
/// A stale file fails here, not only in TS. Regenerate with
/// `forge script script/GenChestVectors.s.sol` from contracts/.
///
/// Rows are read one by one (`.vectors[i].word`): in Foundry 1.8.3 the typed
/// wildcard readers (`parseJsonUintArray(json, ".vectors[*].word")`) reject the
/// column, and the untyped `parseJson` column cannot be decoded reliably.
/// `parseJsonUint` parses the decimal-string word straight into a uint256.
contract ChestMathGoldenTest is Test {
    string private constant FILE = "../shared/test/vectors/chest-vectors.json";

    function test_GoldenVectors() external view {
        string memory json;
        try vm.readFile(FILE) returns (string memory content) {
            json = content;
        } catch {
            revert("chest-vectors.json missing: run `forge script script/GenChestVectors.s.sol` from contracts/");
        }

        // The word column and the rarity column must have the same length.
        uint256 n = 0;
        while (vm.keyExistsJson(json, _key(n, "word"))) n++;
        uint256 nRarity = 0;
        while (vm.keyExistsJson(json, _key(nRarity, "rarity"))) nRarity++;
        assertEq(n, nRarity, "column length mismatch");
        assertGe(n, 1015, "expected at least 1015 vectors");

        for (uint256 i = 0; i < n; i++) {
            uint256 word = vm.parseJsonUint(json, _key(i, "word"));
            assertEq(
                uint256(ChestMath.rarity(word)),
                vm.parseJsonUint(json, _key(i, "rarity")),
                string.concat("rarity mismatch at i=", vm.toString(i), " word=", vm.toString(word))
            );
        }
    }

    function _key(uint256 i, string memory field) private pure returns (string memory) {
        return string.concat(".vectors[", vm.toString(i), "].", field);
    }
}
