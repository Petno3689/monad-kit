// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {IRandomSource, IRandomConsumer} from "./IRandomSource.sol";

/// @dev Minimal slice of the Pyth Entropy V2 interface: only the two methods
/// this adapter calls. Declared here (not pulled from a Pyth SDK submodule) so
/// the kit has no build-time dependency on Pyth; the only coupling is the
/// address passed at deploy. Signatures match Pyth's `IEntropyV2`.
interface IEntropyV2 {
    /// @notice Fee for a request with the given callback gas limit. On Monad
    /// testnet it did not vary with the limit, but it does change over time
    /// (0.12816 MON on 28 Oct 2026, about 0.1238 MON on 16 Nov), so read it on
    /// every call.
    function getFeeV2(address provider, uint32 gasLimit) external view returns (uint128 feeAmount);

    /// @notice Request entropy from `provider`, reserving `gasLimit` gas for the
    /// fulfillment callback. Returns the sequence number that identifies the
    /// request and is echoed back to `_entropyCallback`.
    function requestV2(address provider, uint32 gasLimit)
        external
        payable
        returns (uint64 assignedSequenceNumber);
}

/// @dev The Pyth `IEntropyConsumer` base, inlined. Pyth calls `_entropyCallback`
/// (the external entry point); this wrapper proves the caller is the Entropy
/// contract, then hands control to the consumer's `entropyCallback`. Reproduced
/// rather than imported for the same no-SDK-dependency reason as `IEntropyV2`.
abstract contract IEntropyConsumer {
    /// @dev Reverts `_entropyCallback` when the caller is not the Entropy contract.
    error NotEntropy();

    /// @notice External entry point Pyth calls on fulfillment (the exact SDK name
    /// and signature: `_entropyCallback(uint64,address,bytes32)`). Guarded to the
    /// Entropy contract so nobody else can inject a random value.
    function _entropyCallback(uint64 sequence, address provider, bytes32 randomNumber) external {
        if (msg.sender != getEntropy()) revert NotEntropy();
        entropyCallback(sequence, provider, randomNumber);
    }

    function getEntropy() internal view virtual returns (address);

    /// @dev Override this to handle the delivered random number. Called by
    /// `_entropyCallback` after the Entropy-contract guard passes.
    function entropyCallback(uint64 sequence, address provider, bytes32 randomNumber) internal virtual;
}

/// @title PythEntropySource — IRandomSource backed by Pyth Entropy V2.
/// @notice The ONLY place Pyth types appear. Consumers talk to it purely through
/// `IRandomSource` / `IRandomConsumer`, so replacing Pyth with another provider
/// is a redeploy of this one contract plus a one-address change in the consumer.
///
/// @dev Flow:
///   1. A consumer calls `requestWord{value: >= fee()}(player)`; we pay Pyth
///      EXACTLY `fee()` via `requestV2` with the deploy-time callback gas limit,
///      remember who asked, and refund any change to the caller.
///   2. Pyth fulfils in a later transaction via `_entropyCallback`; we forward the
///      word to the recorded consumer, using the sequence number as the id.
contract PythEntropySource is IRandomSource, IEntropyConsumer {
    /// @notice The Pyth Entropy V2 proxy (the proxy, never the implementation).
    IEntropyV2 public immutable entropy;

    /// @notice The entropy provider whose randomness we request.
    address public immutable provider;

    /// @notice Gas Pyth reserves for the fulfillment callback. Fixed at deploy:
    /// it bounds what every consumer's `receiveWord` may spend, so it is part of
    /// the contract's identity, not a tunable.
    uint32 public immutable callbackGasLimit;

    /// @dev Who to call back, per Pyth sequence number, between request and reveal.
    struct Request {
        address consumer;
        address player;
    }

    mapping(uint64 => Request) private _requests;

    /// @dev A constructor argument was the zero address.
    error ZeroAddress();

    /// @dev The callback gas limit was zero: Pyth could never deliver.
    error ZeroGasLimit();

    /// @dev `msg.value` is below the current Pyth fee.
    error InsufficientFee(uint256 required, uint256 sent);

    /// @dev Returning the overpaid change to the caller failed.
    error RefundFailed();

    /// @dev A fulfillment arrived for a sequence number we never requested (or
    /// already served). Should be impossible given Pyth's guarantees.
    error UnknownSequence(uint64 sequence);

    /// @param entropyContract The Pyth Entropy V2 proxy address.
    /// @param entropyProvider The entropy provider address.
    /// @param gasLimit The callback gas limit reserved with Pyth per request.
    constructor(address entropyContract, address entropyProvider, uint32 gasLimit) {
        if (entropyContract == address(0) || entropyProvider == address(0)) revert ZeroAddress();
        if (gasLimit == 0) revert ZeroGasLimit();
        entropy = IEntropyV2(entropyContract);
        provider = entropyProvider;
        callbackGasLimit = gasLimit;
    }

    /// @inheritdoc IRandomSource
    /// @dev Asked with the same gas limit `requestWord` uses, so the quoted fee is
    /// the fee actually charged even on a network where it depends on the limit.
    function fee() public view returns (uint256) {
        return uint256(entropy.getFeeV2(provider, callbackGasLimit));
    }

    /// @inheritdoc IRandomSource
    /// @dev Pays Pyth exactly `fee()`, never the whole `msg.value`: anything Pyth
    /// receives above its fee is not returned to us, so forwarding the change
    /// would silently lose it. The request is stored BEFORE the refund, so a
    /// caller that re-enters from its receive hook sees a consistent state.
    function requestWord(address player) external payable returns (uint64 requestId) {
        uint256 f = fee();
        if (msg.value < f) revert InsufficientFee(f, msg.value);

        requestId = entropy.requestV2{value: f}(provider, callbackGasLimit);
        _requests[requestId] = Request({consumer: msg.sender, player: player});

        uint256 change = msg.value - f;
        if (change > 0) {
            (bool ok,) = msg.sender.call{value: change}("");
            if (!ok) revert RefundFailed();
        }
    }

    /// @inheritdoc IEntropyConsumer
    function getEntropy() internal view override returns (address) {
        return address(entropy);
    }

    /// @dev Pyth fulfillment: deliver the word to the consumer that requested it.
    /// The outer `_entropyCallback` has already proven `msg.sender` is Entropy.
    /// The slot is deleted before the external call, so a repeated or re-entrant
    /// delivery of the same sequence fails with UnknownSequence.
    function entropyCallback(uint64 sequence, address, /*provider*/ bytes32 randomNumber) internal override {
        Request memory r = _requests[sequence];
        if (r.consumer == address(0)) revert UnknownSequence(sequence);
        delete _requests[sequence];
        IRandomConsumer(r.consumer).receiveWord(r.player, sequence, uint256(randomNumber));
    }
}
