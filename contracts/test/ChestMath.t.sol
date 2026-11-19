// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Test} from "forge-std/Test.sol";
import {ChestMath} from "../src/ChestMath.sol";

contract ChestMathTest is Test {
    /// @dev The largest multiple of 10 000 that still leaves room for any roll
    /// below it in uint256, so `TOP + roll` is a word near 2^256 whose roll is
    /// `roll` by construction (no hand-computed residues).
    uint256 internal constant TOP = (type(uint256).max / 10_000 - 1) * 10_000;

    /// @dev Expected values are written out as literals, not taken from the
    /// library's constants, so a changed threshold fails here.
    function test_Boundaries() public pure {
        assertEq(ChestMath.rarity(0), 1);
        assertEq(ChestMath.rarity(4999), 1);
        assertEq(ChestMath.rarity(5000), 2);
        assertEq(ChestMath.rarity(7999), 2);
        assertEq(ChestMath.rarity(8000), 3);
        assertEq(ChestMath.rarity(9499), 3);
        assertEq(ChestMath.rarity(9500), 4);
        assertEq(ChestMath.rarity(9949), 4);
        assertEq(ChestMath.rarity(9950), 5);
        assertEq(ChestMath.rarity(9999), 5);
    }

    function test_LargeWords_ReduceToEachBand() public pure {
        assertEq(ChestMath.rarity(10_000), 1); // roll 0
        assertEq(ChestMath.rarity(TOP + 1_234), 1);
        assertEq(ChestMath.rarity(TOP + 6_000), 2);
        assertEq(ChestMath.rarity(123_456_789 * 10_000 + 8_765), 3);
        assertEq(ChestMath.rarity(TOP + 9_700), 4);
        assertEq(ChestMath.rarity(TOP + 9_999), 5);
    }

    function test_Constants() public pure {
        assertEq(ChestMath.ROLL_RANGE, 10_000);
        assertEq(ChestMath.UNCOMMON_FROM, 5_000);
        assertEq(ChestMath.RARE_FROM, 8_000);
        assertEq(ChestMath.EPIC_FROM, 9_500);
        assertEq(ChestMath.LEGENDARY_FROM, 9_950);
    }
}
