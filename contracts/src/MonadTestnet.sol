// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

/// @title MonadTestnet — network constants shared by contracts, scripts and tests.
/// @notice One place for every Monad-testnet-specific value, so a deploy script
/// cannot point one contract at one address and another at a different one.
/// @dev The values come from the finished game (Unstable Portals Lab), which has
/// used them on Monad testnet since October 2026. They are not re-measured here.
library MonadTestnet {
    /// @notice Monad testnet chain id. Deploy scripts refuse any other chain, so a
    /// mistyped RPC URL cannot put these addresses on a network where they mean
    /// something else (or nothing).
    uint256 internal constant CHAIN_ID = 10143;

    /// @notice Pyth Entropy V2 PROXY on Monad testnet. Always the proxy, never the
    /// implementation behind it: the implementation can be upgraded away, the
    /// proxy address stays. This is the address the deployed game calls.
    address internal constant PYTH_ENTROPY = 0x825c0390f379C631f3Cf11A82a37D20BddF93c07;

    /// @notice Pyth's default entropy provider on Monad testnet, the one the
    /// deployed game requests from with `requestV2(provider, gasLimit)`.
    address internal constant PYTH_PROVIDER = 0x6CC14824Ea2918f5De5C2f75A9Da968ad4BD6344;

    /// @notice Callback gas limit reserved with Pyth for each request. The game
    /// used 1 000 000: on Monad testnet the fee did not vary with this limit, so
    /// asking for less saves nothing. A consumer's most expensive callback should
    /// stay below 2/3 of it (the game kept that margin, and the kit's
    /// ChestCallbackGas test enforces it for ChestGame).
    uint32 internal constant CALLBACK_GAS_LIMIT = 1_000_000;
}
