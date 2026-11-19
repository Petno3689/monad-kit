// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

/// @title ScoreBoard — best score per address plus a paged list of players.
/// @notice A reusable on-chain leaderboard. The inheriting game decides what a
/// score is and when to record one; the board keeps each player's best, counts
/// every entry, and lists each player once so a front end can page through it
/// without an indexer.
///
/// @dev The list is in insertion order, not sorted: sorting on chain costs gas
/// on every write and caps the board size, while a client can sort one page set
/// for free. A player is listed the first time their best becomes > 0, so a
/// zero score (a "nothing happened" entry) never adds an empty row.
///
/// Storage: the board's variables are private and occupy the first slots of any
/// contract that inherits it. Never add variables here once a child is deployed
/// (that shifts the child's slots), and in an inheriting contract add new state
/// only after its own existing variables.
abstract contract ScoreBoard {
    /// @notice A player's record.
    /// @param score The best score so far.
    /// @param achievedAt `block.timestamp` when `score` was first reached
    ///        (uint32 is enough until 2106).
    /// @param entries How many scores were recorded, including non-improving ones.
    struct Best {
        uint64 score;
        uint32 achievedAt;
        uint32 entries;
    }

    mapping(address => Best) private _best;
    address[] private _board;

    /// @notice A score was recorded for `player`; `newBest` is true when it
    /// strictly beat the previous best.
    event ScoreRecorded(address indexed player, uint64 score, bool newBest);

    /// @dev Record `score` for `player`. Only a strictly higher score is a new
    /// best: on a tie the earlier achievement keeps its timestamp, so whoever got
    /// there first stays first. Appends the player to the list exactly once, the
    /// first time their best rises above 0.
    function _record(address player, uint64 score) internal {
        Best storage b = _best[player];
        bool firstListed = b.score == 0 && score > 0;
        bool newBest = score > b.score;
        if (newBest) {
            b.score = score;
            // forge-lint: disable-next-line(unsafe-typecast)
            b.achievedAt = uint32(block.timestamp);
        }
        b.entries += 1;
        if (firstListed) {
            _board.push(player);
        }
        emit ScoreRecorded(player, score, newBest);
    }

    /// @notice The record for `player` (`entries == 0` means none yet).
    function bestOf(address player) external view returns (Best memory) {
        return _best[player];
    }

    /// @notice The number of listed players (those with a best above 0).
    function boardSize() external view returns (uint256) {
        return _board.length;
    }

    /// @notice A slice of the board in insertion order.
    /// @param offset Starting index; at or past the end returns empty arrays.
    /// @param limit Number of entries to return; 0 returns empty arrays.
    /// @return players Addresses at indices [offset, offset+limit), clamped to the end.
    /// @return bests The record of each returned player.
    function boardPage(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory players, Best[] memory bests)
    {
        uint256 size = _board.length;
        if (limit == 0 || offset >= size) {
            return (new address[](0), new Best[](0));
        }
        // Written as `limit > size - offset` (not `offset + limit > size`) so a
        // huge `limit` cannot overflow.
        uint256 end = limit > size - offset ? size : offset + limit;
        uint256 count = end - offset;
        players = new address[](count);
        bests = new Best[](count);
        for (uint256 i = 0; i < count; i++) {
            address player = _board[offset + i];
            players[i] = player;
            bests[i] = _best[player];
        }
    }
}
