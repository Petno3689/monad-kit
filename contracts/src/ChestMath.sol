// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

/// @title ChestMath — turns a random word into a chest rarity.
/// @notice Pure and stateless, so the same function can be mirrored off chain:
/// a TypeScript mirror (next ticket) will reproduce `rarity` byte for byte, and
/// golden vectors will pin the two together.
///
/// @dev The word is reduced to a roll in [0, 10 000) and the roll is cut into
/// bands. Probabilities: Common 50%, Uncommon 30%, Rare 15%, Epic 4.5%,
/// Legendary 0.5%.
///
/// Modulo bias: 2^256 is not a multiple of 10^4, so the lowest
/// (2^256 mod 10^4) rolls get one extra preimage each. That remainder is below
/// 10^4, i.e. a relative bias under 10^4 / 2^256 (about 10^-73): unmeasurable,
/// so plain `%` is used instead of rejection sampling.
library ChestMath {
    /// @notice Size of the roll space; rolls are 0..ROLL_RANGE-1.
    uint256 internal constant ROLL_RANGE = 10_000;

    /// @notice First roll of each band above Common (inclusive lower bounds).
    uint256 internal constant UNCOMMON_FROM = 5_000;
    uint256 internal constant RARE_FROM = 8_000;
    uint256 internal constant EPIC_FROM = 9_500;
    uint256 internal constant LEGENDARY_FROM = 9_950;

    /// @notice Rarity codes. 0 is deliberately unused, so a rarity is always a
    /// positive score on a ScoreBoard (and every opened chest lists the player).
    uint8 internal constant COMMON = 1;
    uint8 internal constant UNCOMMON = 2;
    uint8 internal constant RARE = 3;
    uint8 internal constant EPIC = 4;
    uint8 internal constant LEGENDARY = 5;

    /// @notice The rarity (1..5) a chest opened with `word` gets.
    function rarity(uint256 word) internal pure returns (uint8) {
        uint256 roll = word % ROLL_RANGE;
        if (roll < UNCOMMON_FROM) return COMMON;
        if (roll < RARE_FROM) return UNCOMMON;
        if (roll < EPIC_FROM) return RARE;
        if (roll < LEGENDARY_FROM) return EPIC;
        return LEGENDARY;
    }
}
