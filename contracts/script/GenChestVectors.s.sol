// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Script} from "forge-std/Script.sol";
import {ChestMath} from "../src/ChestMath.sol";

/// @notice Generates ../shared/test/vectors/chest-vectors.json: golden vectors for
/// ChestMath.rarity. Run from contracts/: `forge script script/GenChestVectors.s.sol`.
/// No RPC, no broadcast. Rerun it after ANY change to ChestMath. The output is
/// deterministic: a second run produces a byte-identical file. Never edit the
/// file by hand; the expected rarity is always computed by the real library.
///
/// Format: {"vectors":[ ... ]} with one vector object per line. The word is a
/// decimal STRING (a uint256 does not survive JSON.parse); rarity is a number.
contract GenChestVectors is Script {
    uint256 private constant RANDOM_COUNT = 1000;
    uint256 private constant EXPLICIT_COUNT = 15;

    function run() external {
        // Rows are appended line by line: one big string.concat would blow the memory limit.
        string memory file = "../shared/test/vectors/chest-vectors.json";
        vm.writeFile(file, "");
        vm.writeLine(file, '{"vectors":[');

        uint256[EXPLICIT_COUNT] memory words = [
            uint256(0), 4999, 5000, 7999, 8000, 9499, 9500, 9949, 9950, 9999, 10000,
            type(uint128).max, 2 ** 255, type(uint256).max - 1, type(uint256).max
        ];
        string[EXPLICIT_COUNT] memory labels = [
            "zero", "below-uncommon", "uncommon-from", "below-rare", "rare-from",
            "below-epic", "epic-from", "below-legendary", "legendary-from",
            "last-roll", "roll-wraps", "2^128-1", "2^255", "uint256-max-minus-1", "uint256-max"
        ];

        for (uint256 i = 0; i < EXPLICIT_COUNT; i++) {
            vm.writeLine(file, string.concat(_row(labels[i], words[i]), ","));
        }
        for (uint256 i = 0; i < RANDOM_COUNT; i++) {
            uint256 word = uint256(keccak256(abi.encode("monad-kit-chest-v1", i)));
            vm.writeLine(file, string.concat(_row("random", word), i + 1 < RANDOM_COUNT ? "," : ""));
        }
        vm.writeLine(file, "]}");
    }

    function _row(string memory label, uint256 word) private pure returns (string memory) {
        return string.concat(
            '{"label":"', label, '","word":"', vm.toString(word), '","rarity":', vm.toString(ChestMath.rarity(word)), "}"
        );
    }
}
