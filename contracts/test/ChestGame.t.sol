// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Test} from "forge-std/Test.sol";
import {ChestGame} from "../src/ChestGame.sol";
import {ChestMath} from "../src/ChestMath.sol";
import {ScoreBoard} from "../src/ScoreBoard.sol";
import {IRandomSource} from "../src/IRandomSource.sol";
import {DeterministicSource} from "./utils/DeterministicSource.sol";

/// @dev A player contract with no receive/fallback: any refund to it fails.
contract RejectingPlayer {
    function open(ChestGame game) external payable {
        game.open{value: msg.value}();
    }
}

contract ChestGameTest is Test {
    event ChestRequested(address indexed player, uint64 indexed requestId, uint256 fee);
    event ChestOpened(address indexed player, uint64 indexed requestId, uint8 rarity);
    event ChestCancelled(address indexed player, uint64 indexed requestId, address indexed by);

    DeterministicSource internal source;
    ChestGame internal game;

    address internal constant PLAYER = address(0xA11CE);
    address internal constant OUTSIDER = address(0xB0B);
    uint256 internal constant FEE = 0.1238 ether;
    uint32 internal constant PLAYER_TIMEOUT = 120;
    uint32 internal constant OUTSIDER_TIMEOUT = 600;
    uint256 internal constant T0 = 1_800_000_000;

    function setUp() public {
        source = new DeterministicSource(FEE);
        game = new ChestGame(source, PLAYER_TIMEOUT, OUTSIDER_TIMEOUT);
        vm.deal(PLAYER, 10 ether);
        vm.deal(OUTSIDER, 10 ether);
        vm.warp(T0);
    }

    function _open() internal returns (uint64 id) {
        vm.prank(PLAYER);
        game.open{value: FEE}();
        id = source.lastRequestId();
    }

    // в”Ђв”Ђ constructor в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

    function test_Constructor_StoresParameters() public view {
        assertEq(address(game.randomSource()), address(source));
        assertEq(game.playerTimeout(), PLAYER_TIMEOUT);
        assertEq(game.outsiderTimeout(), OUTSIDER_TIMEOUT);
    }

    function test_Constructor_RejectsZeroSource() public {
        vm.expectRevert(ChestGame.ZeroSource.selector);
        new ChestGame(IRandomSource(address(0)), PLAYER_TIMEOUT, OUTSIDER_TIMEOUT);
    }

    function test_Constructor_RejectsZeroPlayerTimeout() public {
        vm.expectRevert(ChestGame.ZeroPlayerTimeout.selector);
        new ChestGame(source, 0, OUTSIDER_TIMEOUT);
    }

    function test_Constructor_RejectsOutsiderShorterThanPlayer() public {
        vm.expectRevert(abi.encodeWithSelector(ChestGame.OutsiderTimeoutTooShort.selector, uint32(119), uint32(120)));
        new ChestGame(source, 120, 119);
    }

    function test_Constructor_AcceptsEqualTimeouts() public {
        ChestGame g = new ChestGame(source, 120, 120);
        assertEq(g.outsiderTimeout(), 120);
    }

    // в”Ђв”Ђ open в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

    function test_Open_ExactFee() public {
        vm.expectEmit(true, true, false, true);
        emit ChestRequested(PLAYER, 1, FEE);
        vm.prank(PLAYER);
        game.open{value: FEE}();

        assertEq(address(source).balance, FEE, "source received the fee");
        assertEq(address(game).balance, 0, "game keeps nothing");
        assertEq(PLAYER.balance, 10 ether - FEE);
        assertTrue(source.isPending(1));
    }

    function test_Open_WithChange_Refunded() public {
        vm.prank(PLAYER);
        game.open{value: FEE + 1 ether}();

        assertEq(address(source).balance, FEE, "source received exactly the fee");
        assertEq(address(game).balance, 0, "game keeps nothing");
        assertEq(PLAYER.balance, 10 ether - FEE, "change refunded");
    }

    function test_Open_TooLittle_Reverts() public {
        vm.prank(PLAYER);
        vm.expectRevert(abi.encodeWithSelector(ChestGame.InsufficientFee.selector, FEE, FEE - 1));
        game.open{value: FEE - 1}();
    }

    function test_Open_ReadsCurrentFee() public {
        source.setFee(0.12816 ether);
        vm.prank(PLAYER);
        game.open{value: 1 ether}();
        assertEq(address(source).balance, 0.12816 ether);
        assertEq(PLAYER.balance, 10 ether - 0.12816 ether);
    }

    function test_Open_RefundRejected_RevertsRefundFailed() public {
        RejectingPlayer rp = new RejectingPlayer();
        vm.expectRevert(ChestGame.RefundFailed.selector);
        rp.open{value: FEE + 1}(game);
    }

    function test_Open_WhilePending_RevertsChestPending() public {
        _open();
        vm.prank(PLAYER);
        vm.expectRevert(ChestGame.ChestPending.selector);
        game.open{value: FEE}();
    }

    // в”Ђв”Ђ delivery в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

    function test_Reveal_RecordsRarityAndBoard() public {
        uint64 id = _open();
        uint8 expected = ChestMath.rarity(source.wordOf(id));

        vm.expectEmit(true, true, false, true);
        emit ChestOpened(PLAYER, id, expected);
        source.reveal(id);

        ScoreBoard.Best memory b = game.bestOf(PLAYER);
        assertEq(b.score, expected);
        assertEq(b.entries, 1);
        assertEq(b.achievedAt, T0);
        assertEq(game.boardSize(), 1);
        (address[] memory players,) = game.boardPage(0, 1);
        assertEq(players[0], PLAYER);
        (bool active,,,,) = game.pendingOf(PLAYER);
        assertFalse(active);
    }

    function test_RevealWith_ChosenWordGivesRarity() public {
        uint64 id = _open();
        source.revealWith(id, 9950);
        assertEq(game.bestOf(PLAYER).score, 5);

        id = _open();
        source.revealWith(id, 0); // Common, lower than the best
        ScoreBoard.Best memory b = game.bestOf(PLAYER);
        assertEq(b.score, 5);
        assertEq(b.entries, 2);
        assertEq(game.boardSize(), 1);
    }

    function test_ReceiveWord_FromStranger_RevertsNotRandomSource() public {
        uint64 id = _open();
        vm.prank(OUTSIDER);
        vm.expectRevert(ChestGame.NotRandomSource.selector);
        game.receiveWord(PLAYER, id, 9999);
    }

    function test_ReceiveWord_WrongId_RevertsUnknownRequest() public {
        uint64 id = _open();
        vm.prank(address(source));
        vm.expectRevert(abi.encodeWithSelector(ChestGame.UnknownRequest.selector, PLAYER, id + 1));
        game.receiveWord(PLAYER, id + 1, 9999);
    }

    function test_ReceiveWord_NoRequest_RevertsUnknownRequest() public {
        vm.prank(address(source));
        vm.expectRevert(abi.encodeWithSelector(ChestGame.UnknownRequest.selector, PLAYER, uint64(0)));
        game.receiveWord(PLAYER, 0, 9999);
    }

    function test_ReceiveWord_Duplicate_RevertsUnknownRequest() public {
        uint64 id = _open();
        source.reveal(id);
        vm.prank(address(source));
        vm.expectRevert(abi.encodeWithSelector(ChestGame.UnknownRequest.selector, PLAYER, id));
        game.receiveWord(PLAYER, id, 9999);
    }

    // в”Ђв”Ђ cancel в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

    function test_Cancel_NoRequest_RevertsNoPendingRequest() public {
        vm.prank(PLAYER);
        vm.expectRevert(ChestGame.NoPendingRequest.selector);
        game.cancel(PLAYER);
    }

    function test_Cancel_Player_StrictBoundary() public {
        uint64 id = _open();
        uint256 availableAt = T0 + PLAYER_TIMEOUT;

        vm.warp(availableAt);
        vm.prank(PLAYER);
        vm.expectRevert(abi.encodeWithSelector(ChestGame.RequestNotTimedOut.selector, availableAt + 1));
        game.cancel(PLAYER);

        vm.warp(availableAt + 1);
        vm.expectEmit(true, true, true, true);
        emit ChestCancelled(PLAYER, id, PLAYER);
        vm.prank(PLAYER);
        game.cancel(PLAYER);

        (bool active,,,,) = game.pendingOf(PLAYER);
        assertFalse(active);
        assertEq(PLAYER.balance, 10 ether - FEE, "fee is not refunded on cancel");
    }

    function test_Cancel_Outsider_StrictBoundary() public {
        uint64 id = _open();
        uint256 availableAt = T0 + OUTSIDER_TIMEOUT;

        // The player's moment is not enough for an outsider.
        vm.warp(T0 + PLAYER_TIMEOUT + 1);
        vm.prank(OUTSIDER);
        vm.expectRevert(abi.encodeWithSelector(ChestGame.RequestNotTimedOut.selector, availableAt + 1));
        game.cancel(PLAYER);

        vm.warp(availableAt);
        vm.prank(OUTSIDER);
        vm.expectRevert(abi.encodeWithSelector(ChestGame.RequestNotTimedOut.selector, availableAt + 1));
        game.cancel(PLAYER);

        vm.warp(availableAt + 1);
        vm.expectEmit(true, true, true, true);
        emit ChestCancelled(PLAYER, id, OUTSIDER);
        vm.prank(OUTSIDER);
        game.cancel(PLAYER);

        (bool active,,,,) = game.pendingOf(PLAYER);
        assertFalse(active);
    }

    function test_WordAfterCancel_RevertsUnknownRequest() public {
        uint64 id = _open();
        vm.warp(T0 + PLAYER_TIMEOUT + 1);
        vm.prank(PLAYER);
        game.cancel(PLAYER);

        vm.expectRevert(abi.encodeWithSelector(ChestGame.UnknownRequest.selector, PLAYER, id));
        source.reveal(id);
        assertEq(game.bestOf(PLAYER).entries, 0, "nothing recorded");
    }

    function test_OpenAgain_AfterReveal() public {
        uint64 first = _open();
        source.reveal(first);
        uint64 second = _open();
        assertTrue(second != first);
        (bool active, uint64 rid,,,) = game.pendingOf(PLAYER);
        assertTrue(active);
        assertEq(rid, second);
    }

    function test_OpenAgain_AfterCancel() public {
        uint64 first = _open();
        vm.warp(T0 + PLAYER_TIMEOUT + 1);
        vm.prank(PLAYER);
        game.cancel(PLAYER);

        uint64 second = _open();
        (bool active, uint64 rid, uint40 committedAt,,) = game.pendingOf(PLAYER);
        assertTrue(active);
        assertEq(rid, second);
        assertTrue(second != first);
        assertEq(committedAt, T0 + PLAYER_TIMEOUT + 1);
    }

    // в”Ђв”Ђ pendingOf в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

    function test_PendingOf_Values() public {
        (bool active, uint64 rid, uint40 committed, uint256 pAt, uint256 oAt) = game.pendingOf(PLAYER);
        assertFalse(active);
        assertEq(rid, 0);
        assertEq(committed, 0);
        assertEq(pAt, 0);
        assertEq(oAt, 0);

        uint64 id = _open();
        (active, rid, committed, pAt, oAt) = game.pendingOf(PLAYER);
        assertTrue(active);
        assertEq(rid, id);
        assertEq(committed, T0);
        assertEq(pAt, T0 + PLAYER_TIMEOUT);
        assertEq(oAt, T0 + OUTSIDER_TIMEOUT);
    }

    // в”Ђв”Ђ request id 0 is a valid id в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

    function test_RequestIdZero_IsActiveAndDeliverable() public {
        source.setNextRequestId(0);
        uint64 id = _open();
        assertEq(id, 0);

        (bool active, uint64 rid,,,) = game.pendingOf(PLAYER);
        assertTrue(active, "id 0 is still an active request");
        assertEq(rid, 0);

        vm.prank(PLAYER);
        vm.expectRevert(ChestGame.ChestPending.selector);
        game.open{value: FEE}();

        source.revealWith(0, 9500);
        assertEq(game.bestOf(PLAYER).score, 4);
    }

    function test_RequestIdZero_Cancellable() public {
        source.setNextRequestId(0);
        _open();
        vm.warp(T0 + PLAYER_TIMEOUT + 1);
        vm.prank(PLAYER);
        game.cancel(PLAYER);
        (bool active,,,,) = game.pendingOf(PLAYER);
        assertFalse(active);
    }
}
