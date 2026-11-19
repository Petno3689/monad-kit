// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Test} from "forge-std/Test.sol";
import {ScoreBoard} from "../src/ScoreBoard.sol";

/// @dev Exposes the internal `_record` for tests.
contract ScoreBoardHarness is ScoreBoard {
    function record(address player, uint64 score) external {
        _record(player, score);
    }
}

contract ScoreBoardTest is Test {
    event ScoreRecorded(address indexed player, uint64 score, bool newBest);

    ScoreBoardHarness internal board;
    address internal constant A = address(0xA);
    address internal constant B = address(0xB);
    address internal constant C = address(0xC);
    uint256 internal constant T0 = 1_000_000;

    function setUp() public {
        board = new ScoreBoardHarness();
        vm.warp(T0);
    }

    function test_FirstPositiveScore_ListsPlayerOnce() public {
        vm.expectEmit(true, false, false, true);
        emit ScoreRecorded(A, 3, true);
        board.record(A, 3);
        board.record(A, 5);
        board.record(A, 1);

        assertEq(board.boardSize(), 1, "listed exactly once");
        (address[] memory players,) = board.boardPage(0, 10);
        assertEq(players.length, 1);
        assertEq(players[0], A);
    }

    function test_EqualScore_IsNotNewBest() public {
        board.record(A, 4);
        vm.warp(T0 + 50);
        vm.expectEmit(true, false, false, true);
        emit ScoreRecorded(A, 4, false);
        board.record(A, 4);

        ScoreBoard.Best memory b = board.bestOf(A);
        assertEq(b.score, 4);
        assertEq(b.achievedAt, T0, "tie keeps the first timestamp");
        assertEq(b.entries, 2);
    }

    function test_HigherScore_UpdatesAchievedAt() public {
        board.record(A, 2);
        vm.warp(T0 + 77);
        board.record(A, 3);

        ScoreBoard.Best memory b = board.bestOf(A);
        assertEq(b.score, 3);
        assertEq(b.achievedAt, T0 + 77);
    }

    function test_LowerScore_KeepsBest() public {
        board.record(A, 5);
        vm.warp(T0 + 9);
        board.record(A, 1);
        ScoreBoard.Best memory b = board.bestOf(A);
        assertEq(b.score, 5);
        assertEq(b.achievedAt, T0);
    }

    function test_Entries_CountsEveryRecord() public {
        board.record(A, 1);
        board.record(A, 0);
        board.record(A, 1);
        board.record(A, 2);
        assertEq(board.bestOf(A).entries, 4);
    }

    function test_ZeroScore_CountedButNotListed() public {
        vm.expectEmit(true, false, false, true);
        emit ScoreRecorded(A, 0, false);
        board.record(A, 0);

        ScoreBoard.Best memory b = board.bestOf(A);
        assertEq(b.entries, 1);
        assertEq(b.score, 0);
        assertEq(b.achievedAt, 0);
        assertEq(board.boardSize(), 0);

        // Listed later, once, when a positive score arrives.
        board.record(A, 2);
        assertEq(board.boardSize(), 1);
    }

    function test_UnknownPlayer_IsEmpty() public view {
        ScoreBoard.Best memory b = board.bestOf(A);
        assertEq(b.score, 0);
        assertEq(b.entries, 0);
    }

    // ── boardPage ────────────────────────────────────────────────────────────

    function _fillThree() internal {
        board.record(A, 1);
        board.record(B, 2);
        board.record(C, 3);
    }

    function test_Page_LimitZero_Empty() public {
        _fillThree();
        (address[] memory p, ScoreBoard.Best[] memory b) = board.boardPage(0, 0);
        assertEq(p.length, 0);
        assertEq(b.length, 0);
    }

    function test_Page_OffsetAtEnd_Empty() public {
        _fillThree();
        (address[] memory p, ScoreBoard.Best[] memory b) = board.boardPage(3, 5);
        assertEq(p.length, 0);
        assertEq(b.length, 0);
    }

    function test_Page_OffsetPastEnd_Empty() public {
        _fillThree();
        (address[] memory p, ScoreBoard.Best[] memory b) = board.boardPage(100, 5);
        assertEq(p.length, 0);
        assertEq(b.length, 0);
    }

    function test_Page_EmptyBoard_Empty() public view {
        (address[] memory p,) = board.boardPage(0, 10);
        assertEq(p.length, 0);
    }

    function test_Page_PartialLastPage() public {
        _fillThree();
        (address[] memory p, ScoreBoard.Best[] memory b) = board.boardPage(2, 2);
        assertEq(p.length, 1);
        assertEq(p[0], C);
        assertEq(b[0].score, 3);
    }

    function test_Page_FullPageInOrder() public {
        _fillThree();
        (address[] memory p, ScoreBoard.Best[] memory b) = board.boardPage(0, 2);
        assertEq(p.length, 2);
        assertEq(p[0], A);
        assertEq(p[1], B);
        assertEq(b[0].score, 1);
        assertEq(b[1].score, 2);
    }

    function test_Page_HugeLimit_DoesNotOverflow() public {
        _fillThree();
        (address[] memory p,) = board.boardPage(1, type(uint256).max);
        assertEq(p.length, 2);
        assertEq(p[0], B);
        assertEq(p[1], C);
    }
}
