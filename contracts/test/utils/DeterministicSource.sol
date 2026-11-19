// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {IRandomSource, IRandomConsumer} from "../../src/IRandomSource.sol";

/// @title DeterministicSource — test-only IRandomSource with a reproducible word.
/// @notice Stands in for Pyth in tests and local runs. The word is a pure
/// function of `(player, nonce)`, so a run is reproducible, yet, because the
/// nonce advances on every request, two successive requests by the same player
/// still get different words, exactly as real entropy would.
///
/// @dev DELIVERY IS ALWAYS A SEPARATE CALL (`reveal` / `revealWith`), never a
/// synchronous callback inside `requestWord`. This is not a limitation but a
/// requirement: a consumer records the `requestId` only after `requestWord`
/// returns, and its `receiveWord` must verify the delivered id against that
/// record. A callback fired from inside `requestWord` would arrive before the id
/// was stored and so could never be verified. Call `reveal` on the next line for
/// an "immediate" result, or warp time first to exercise timeouts.
contract DeterministicSource is IRandomSource {
    uint256 private _fee;

    /// @dev Advances on every request, so successive words differ.
    uint64 private _nonce;

    /// @dev The id the next request gets. Starts at 1 by default; `setNextRequestId`
    /// can set it to anything (including 0) to prove a consumer does not treat
    /// any particular id as "no request" (Pyth gives no such guarantee).
    uint64 private _nextId = 1;

    /// @notice The id returned by the most recent `requestWord`. Convenience for
    /// single-threaded tests that want to reveal the request they just made.
    uint64 public lastRequestId;

    struct Request {
        address consumer;
        address player;
        uint256 word;
        bool pending;
    }

    mapping(uint64 => Request) private _requests;

    error FeeTooLow(uint256 needed, uint256 sent);
    error NotPending(uint64 requestId);

    /// @param feeWei The fee `requestWord` requires (0 for most tests).
    constructor(uint256 feeWei) {
        _fee = feeWei;
    }

    /// @inheritdoc IRandomSource
    function fee() external view returns (uint256) {
        return _fee;
    }

    /// @notice Test aid: change the fee after construction, to exercise the
    /// underpay/overpay paths of a consumer.
    function setFee(uint256 feeWei) external {
        _fee = feeWei;
    }

    /// @notice Test aid: choose the id of the next request.
    function setNextRequestId(uint64 id) external {
        _nextId = id;
    }

    /// @inheritdoc IRandomSource
    /// @dev Keeps whatever is paid (no change is returned): consumers are
    /// expected to send exactly `fee()`, and tests check their balances.
    function requestWord(address player) external payable returns (uint64 requestId) {
        if (msg.value < _fee) revert FeeTooLow(_fee, msg.value);
        requestId = _nextId++;
        uint256 word = uint256(keccak256(abi.encode(player, _nonce)));
        _nonce += 1;
        _requests[requestId] = Request({consumer: msg.sender, player: player, word: word, pending: true});
        lastRequestId = requestId;
    }

    /// @notice Deliver the precomputed word for `requestId` to its consumer.
    function reveal(uint64 requestId) external {
        _deliver(requestId, _requests[requestId].word);
    }

    /// @notice Test aid: deliver a CHOSEN word for `requestId`, to reach a given
    /// outcome (e.g. a specific rarity band) deterministically.
    function revealWith(uint64 requestId, uint256 word) external {
        _deliver(requestId, word);
    }

    /// @notice The word that `reveal` would deliver for `requestId` (test aid:
    /// lets a test predict the derived outcome before revealing).
    function wordOf(uint64 requestId) external view returns (uint256) {
        return _requests[requestId].word;
    }

    /// @notice Whether `requestId` is still awaiting delivery.
    function isPending(uint64 requestId) external view returns (bool) {
        return _requests[requestId].pending;
    }

    function _deliver(uint64 requestId, uint256 word) private {
        Request storage r = _requests[requestId];
        if (!r.pending) revert NotPending(requestId);
        r.pending = false;
        IRandomConsumer(r.consumer).receiveWord(r.player, requestId, word);
    }
}
