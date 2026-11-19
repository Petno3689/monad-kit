// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Test} from "forge-std/Test.sol";
import {MonadTestnet} from "../src/MonadTestnet.sol";
import {PythEntropySource} from "../src/PythEntropySource.sol";
import {ChestGame} from "../src/ChestGame.sol";
import {MockEntropy} from "./utils/MockEntropy.sol";

/// @title ChestCallbackGas — the delivery path fits the callback budget.
/// @notice Invariant, not a benchmark: the whole Pyth delivery path for a chest
/// (MockEntropy → PythEntropySource._entropyCallback → ChestGame.receiveWord →
/// ScoreBoard._record) must use less than 2/3 of the callback gas limit reserved
/// with Pyth, so the real callback never runs out of gas. The case measured is
/// the most expensive one: a player's FIRST chest (fresh best record, first
/// board listing, so the board grows).
///
/// @dev The test runs under Monad gas pricing because foundry.toml sets
/// `network = "monad"`.
///
/// @dev The request is made in `setUp`, a separate transaction, so the test
/// starts with cold accounts and storage; `vm.cool` additionally marks the
/// storage of every contract on the path cold. The measured span includes the
/// mock's own encoding and call overhead, so it over-estimates the real callback.
contract ChestCallbackGasTest is Test {
    MockEntropy internal entropy;
    PythEntropySource internal source;
    ChestGame internal game;
    uint64 internal seq;

    address internal constant PROVIDER = address(0xBEEF);
    address internal constant PLAYER = address(0xA11CE);
    uint128 internal constant FEE = 0.1238 ether;

    function setUp() public {
        entropy = new MockEntropy(FEE);
        source = new PythEntropySource(address(entropy), PROVIDER, MonadTestnet.CALLBACK_GAS_LIMIT);
        game = new ChestGame(source, 120, 600);

        vm.deal(PLAYER, 1 ether);
        vm.prank(PLAYER);
        game.open{value: FEE}();
        seq = entropy.lastSequence();
    }

    function test_FirstChestDelivery_BelowTwoThirdsOfCallbackLimit() public {
        vm.cool(address(entropy));
        vm.cool(address(source));
        vm.cool(address(game));

        uint256 before = gasleft();
        entropy.deliver(address(source), seq, bytes32(uint256(9_999))); // Legendary
        uint256 used = before - gasleft();

        // The path really ran end to end.
        assertEq(game.bestOf(PLAYER).score, 5);
        assertEq(game.boardSize(), 1);
        (bool active,,,,) = game.pendingOf(PLAYER);
        assertFalse(active);

        assertLt(used, uint256(MonadTestnet.CALLBACK_GAS_LIMIT) * 2 / 3, "callback over 2/3 of the limit");
    }
}
