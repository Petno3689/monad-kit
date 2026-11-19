// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

/// @title IRandomSource — pluggable source of a single random word.
/// @notice A consumer never talks to a randomness provider directly. It asks an
/// IRandomSource for one 256-bit word and, separately, receives that word back
/// through the IRandomConsumer callback. Swapping the provider (Pyth today,
/// anything tomorrow) is then a change of ONE address given to the consumer at
/// deploy, not a change to the consumer's code.
///
/// @dev The split (request now, delivery later, in a separate call) is the
/// essence of the design: real entropy (Pyth Entropy V2) is asynchronous. The
/// value is not known until a fulfillment transaction lands in a later block,
/// and the interface must not pretend otherwise. `requestWord` therefore returns
/// only an id; the word arrives through `IRandomConsumer.receiveWord`.
///
/// Request ids are opaque. They are NOT guaranteed to start at 1 (Pyth sequence
/// numbers do not), so a consumer must never use id 0 as "no request"; it should
/// keep an explicit "active" flag next to the stored id.
interface IRandomSource {
    /// @notice The fee, in wei of the native coin, that `requestWord` requires.
    /// @dev The fee changes over time (for Pyth on Monad testnet it moved from
    /// 0.12816 MON to about 0.1238 MON within three weeks), so a caller must read
    /// `fee()` in the same transaction as every request instead of caching it.
    function fee() external view returns (uint256);

    /// @notice Request one random word on behalf of `player`.
    /// @dev The caller (the consumer) is recorded as `msg.sender`; the word is
    /// delivered back to that same address via `IRandomConsumer.receiveWord` in a
    /// LATER call, never inside this one (the consumer can only store the
    /// returned id after this call returns). Reverts if `msg.value < fee()`.
    /// @param player The player the word is for; echoed back on delivery.
    /// @return requestId An id unique to this request, used to match the delivery.
    function requestWord(address player) external payable returns (uint64 requestId);
}

/// @title IRandomConsumer — receives a word delivered by an IRandomSource.
/// @notice The source calls `receiveWord` to hand back the word for a previously
/// issued `requestId`. The consumer MUST verify that `msg.sender` is its
/// configured source and that `requestId` matches an outstanding request;
/// otherwise anyone could inject a word of their choosing.
interface IRandomConsumer {
    /// @notice Deliver `word` for the request `requestId` made for `player`.
    function receiveWord(address player, uint64 requestId, uint256 word) external;
}
