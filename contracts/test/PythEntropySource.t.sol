// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Test} from "forge-std/Test.sol";
import {PythEntropySource, IEntropyV2, IEntropyConsumer} from "../src/PythEntropySource.sol";
import {MockEntropy, MockConsumer} from "./utils/MockEntropy.sol";

/// @dev A caller with no receive/fallback: any refund to it fails.
contract EthRejecter {
    function request(PythEntropySource src, address player) external payable returns (uint64) {
        return src.requestWord{value: msg.value}(player);
    }
}

contract PythEntropySourceTest is Test {
    MockEntropy internal entropy;
    PythEntropySource internal adapter;
    MockConsumer internal consumer;

    address internal constant PROVIDER = address(0xBEEF);
    address internal constant ALICE = address(0xA11CE);
    address internal constant CALLER = address(0xC0FFEE);
    uint32 internal constant LIMIT = 750_000;
    uint128 internal constant FEE = 0.01 ether;

    function setUp() public {
        entropy = new MockEntropy(FEE);
        consumer = new MockConsumer();
        adapter = new PythEntropySource(address(entropy), PROVIDER, LIMIT);
    }

    // ── constructor ──────────────────────────────────────────────────────────

    function test_Constructor_StoresParameters() public view {
        assertEq(address(adapter.entropy()), address(entropy));
        assertEq(adapter.provider(), PROVIDER);
        assertEq(adapter.callbackGasLimit(), LIMIT);
    }

    function test_Constructor_RejectsZeroEntropy() public {
        vm.expectRevert(PythEntropySource.ZeroAddress.selector);
        new PythEntropySource(address(0), PROVIDER, LIMIT);
    }

    function test_Constructor_RejectsZeroProvider() public {
        vm.expectRevert(PythEntropySource.ZeroAddress.selector);
        new PythEntropySource(address(entropy), address(0), LIMIT);
    }

    function test_Constructor_RejectsZeroLimit() public {
        vm.expectRevert(PythEntropySource.ZeroGasLimit.selector);
        new PythEntropySource(address(entropy), PROVIDER, 0);
    }

    // ── fee ──────────────────────────────────────────────────────────────────

    function test_Fee_AsksPythWithConfiguredLimit() public {
        vm.expectCall(address(entropy), abi.encodeCall(IEntropyV2.getFeeV2, (PROVIDER, LIMIT)));
        assertEq(adapter.fee(), FEE);
    }

    function test_Fee_FollowsPythOverTime() public {
        entropy.setFee(0.1238 ether);
        assertEq(adapter.fee(), 0.1238 ether);
    }

    // ── requestWord ──────────────────────────────────────────────────────────

    function test_RequestWord_ExactFee_SendsFeeWithConfiguredLimit() public {
        vm.deal(CALLER, 1 ether);
        vm.prank(CALLER);
        uint64 id = adapter.requestWord{value: FEE}(ALICE);

        assertEq(entropy.valueOf(id), FEE, "Entropy received exactly the fee");
        assertEq(entropy.gasLimitOf(id), LIMIT, "configured callback limit");
        assertEq(entropy.providerOf(id), PROVIDER, "configured provider");
        assertEq(address(entropy).balance, FEE);
        assertEq(address(adapter).balance, 0, "adapter keeps nothing");
        assertEq(CALLER.balance, 1 ether - FEE);
    }

    function test_RequestWord_Overpay_SendsExactFeeAndRefundsChange() public {
        uint256 sent = FEE + 0.37 ether;
        vm.deal(CALLER, 1 ether);
        vm.prank(CALLER);
        uint64 id = adapter.requestWord{value: sent}(ALICE);

        assertEq(entropy.valueOf(id), FEE, "Entropy received exactly the fee");
        assertEq(address(entropy).balance, FEE);
        assertEq(address(adapter).balance, 0, "adapter keeps nothing");
        assertEq(CALLER.balance, 1 ether - FEE, "change refunded to the caller");
    }

    function test_RequestWord_Underpay_RevertsInsufficientFee() public {
        vm.deal(CALLER, 1 ether);
        vm.prank(CALLER);
        vm.expectRevert(abi.encodeWithSelector(PythEntropySource.InsufficientFee.selector, uint256(FEE), FEE - 1));
        adapter.requestWord{value: FEE - 1}(ALICE);
    }

    function test_RequestWord_RefundToRejecter_RevertsRefundFailed() public {
        EthRejecter rejecter = new EthRejecter();
        vm.deal(address(this), 1 ether);
        vm.expectRevert(PythEntropySource.RefundFailed.selector);
        rejecter.request{value: FEE + 1}(adapter, ALICE);
    }

    function test_RequestWord_ExactFeeFromRejecter_Succeeds() public {
        // No change, so no refund call: a contract without receive can still pay exactly.
        EthRejecter rejecter = new EthRejecter();
        vm.deal(address(this), 1 ether);
        uint64 id = rejecter.request{value: FEE}(adapter, ALICE);
        assertEq(entropy.valueOf(id), FEE);
    }

    // ── callback ─────────────────────────────────────────────────────────────

    function _request() internal returns (uint64 id) {
        vm.deal(address(consumer), 1 ether);
        vm.prank(address(consumer));
        id = adapter.requestWord{value: FEE}(ALICE);
    }

    /// @notice `_entropyCallback(uint64,address,bytes32)` is the external name Pyth
    /// calls. The call is built from the signature string, independent of our
    /// own types: a wrong name would make `ok` false.
    function test_Callback_RealSelectorReachesConsumer() public {
        uint64 id = _request();
        bytes32 word = bytes32(uint256(0x1234));
        bytes memory callData =
            abi.encodeWithSignature("_entropyCallback(uint64,address,bytes32)", id, address(entropy), word);
        vm.prank(address(entropy));
        (bool ok,) = address(adapter).call(callData);
        assertTrue(ok, "_entropyCallback must be externally callable from Entropy");

        assertTrue(consumer.received());
        assertEq(consumer.lastPlayer(), ALICE);
        assertEq(consumer.lastRequestId(), id);
        assertEq(consumer.lastWord(), uint256(word));
    }

    function test_Callback_ViaMockDeliver_ReachesConsumer() public {
        uint64 id = _request();
        entropy.deliver(address(adapter), id, keccak256("w"));
        assertEq(consumer.lastWord(), uint256(keccak256("w")));
    }

    function test_Callback_FromNonEntropy_RevertsNotEntropy() public {
        uint64 id = _request();
        vm.prank(address(0xDEAD));
        vm.expectRevert(IEntropyConsumer.NotEntropy.selector);
        adapter._entropyCallback(id, PROVIDER, bytes32(0));
        assertFalse(consumer.received());
    }

    function test_Callback_UnknownSequence_Reverts() public {
        uint64 unknown = 999;
        vm.expectRevert(abi.encodeWithSelector(PythEntropySource.UnknownSequence.selector, unknown));
        entropy.deliver(address(adapter), unknown, keccak256("bad"));
    }

    function test_Callback_DuplicateSequence_Reverts() public {
        uint64 id = _request();
        entropy.deliver(address(adapter), id, keccak256("once"));
        vm.expectRevert(abi.encodeWithSelector(PythEntropySource.UnknownSequence.selector, id));
        entropy.deliver(address(adapter), id, keccak256("once"));
    }
}
