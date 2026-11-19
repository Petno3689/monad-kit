// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {IRandomConsumer} from "../../src/IRandomSource.sol";

/// @title MockEntropy — test-only Pyth Entropy V2 stand-in.
/// @notice Issues increasing sequence numbers, records what each request paid
/// and which callback gas limit it asked for (so tests can assert "exactly the
/// fee" and "the configured limit"), and delivers words to a consumer via raw
/// ABI encoding, never a typed Solidity interface, so tests prove the real
/// selector is exposed and not just our own typedef.
contract MockEntropy {
    uint128 public mockFee;
    uint64 private _seq;

    /// @notice The sequence number assigned by the most recent `requestV2`.
    uint64 public lastSequence;

    struct Received {
        address provider;
        uint256 value;
        uint32 gasLimit;
    }

    mapping(uint64 => Received) private _received;

    constructor(uint128 fee_) {
        mockFee = fee_;
    }

    function setFee(uint128 fee_) external {
        mockFee = fee_;
    }

    function getFeeV2(address, uint32) external view returns (uint128) {
        return mockFee;
    }

    function requestV2(address provider, uint32 gasLimit) external payable returns (uint64 assignedSequenceNumber) {
        assignedSequenceNumber = ++_seq;
        _received[assignedSequenceNumber] = Received({provider: provider, value: msg.value, gasLimit: gasLimit});
        lastSequence = assignedSequenceNumber;
    }

    /// @notice The `msg.value` the request `sequence` paid.
    function valueOf(uint64 sequence) external view returns (uint256) {
        return _received[sequence].value;
    }

    /// @notice The callback gas limit the request `sequence` asked for.
    function gasLimitOf(uint64 sequence) external view returns (uint32) {
        return _received[sequence].gasLimit;
    }

    /// @notice The provider the request `sequence` named.
    function providerOf(uint64 sequence) external view returns (address) {
        return _received[sequence].provider;
    }

    /// @notice Call `_entropyCallback` on `consumer` using raw ABI encoding.
    /// @dev The signature string here is the INDEPENDENT check: if the adapter's
    /// external function were named differently, this call would land on the
    /// fallback (or not at all) and `ok` would be false. The inner revert data is
    /// bubbled so callers can assert on its selector.
    function deliver(address consumer, uint64 sequence, bytes32 randomNumber) external {
        bytes memory data =
            abi.encodeWithSignature("_entropyCallback(uint64,address,bytes32)", sequence, address(this), randomNumber);
        (bool ok, bytes memory ret) = consumer.call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
    }
}

/// @title MockConsumer — records the last word delivered via receiveWord.
contract MockConsumer is IRandomConsumer {
    address public lastPlayer;
    uint64 public lastRequestId;
    uint256 public lastWord;
    bool public received;

    function receiveWord(address player, uint64 requestId, uint256 word) external {
        lastPlayer = player;
        lastRequestId = requestId;
        lastWord = word;
        received = true;
    }
}
