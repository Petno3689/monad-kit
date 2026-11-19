// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {IRandomSource, IRandomConsumer} from "./IRandomSource.sol";
import {ScoreBoard} from "./ScoreBoard.sol";
import {ChestMath} from "./ChestMath.sol";

/// @title ChestGame — minimal two-phase example built on the kit.
/// @notice A player pays the randomness fee and requests a chest (`open`); in a
/// later transaction the random source delivers a word (`receiveWord`), the
/// chest's rarity is derived from it and recorded as the player's score on the
/// board. If the word never arrives, the request can be cancelled: by the
/// player after `playerTimeout` seconds, by anyone after `outsiderTimeout`.
///
/// @dev It shows the patterns every consumer of an asynchronous random source
/// needs: one outstanding request per player; an explicit `active` flag (request
/// ids may legitimately be 0, so the id cannot double as "none"); the delivery
/// guarded by both caller and id; and a real-time escape hatch for stuck
/// requests, so a player is never locked out forever.
contract ChestGame is IRandomConsumer, ScoreBoard {
    /// @notice The source that sells and delivers random words. Fixed at deploy:
    /// it is the only address allowed to call `receiveWord`.
    IRandomSource public immutable randomSource;

    /// @notice Seconds after a request before its player may cancel it.
    uint32 public immutable playerTimeout;

    /// @notice Seconds after a request before anyone else may cancel it. Never
    /// shorter than `playerTimeout`, so a stranger cannot cancel (and so burn the
    /// fee of) a request that is merely slow before the player could.
    uint32 public immutable outsiderTimeout;

    /// @dev A player's outstanding request.
    struct Pending {
        bool active;
        uint64 requestId;
        uint40 committedAt;
    }

    mapping(address => Pending) private _pending;

    error ZeroSource();
    error ZeroPlayerTimeout();
    error OutsiderTimeoutTooShort(uint32 outsiderTimeout, uint32 playerTimeout);
    error ChestPending();
    error InsufficientFee(uint256 required, uint256 sent);
    error RefundFailed();
    error NotRandomSource();
    error UnknownRequest(address player, uint64 requestId);
    error NoPendingRequest();
    /// @param availableFrom The first `block.timestamp` at which the cancel succeeds.
    error RequestNotTimedOut(uint256 availableFrom);

    event ChestRequested(address indexed player, uint64 indexed requestId, uint256 fee);
    event ChestOpened(address indexed player, uint64 indexed requestId, uint8 rarity);
    event ChestCancelled(address indexed player, uint64 indexed requestId, address indexed by);

    /// @param source The random source (PythEntropySource on Monad testnet).
    /// @param playerTimeout_ Seconds before the player may cancel; > 0.
    /// @param outsiderTimeout_ Seconds before anyone may cancel; >= playerTimeout_.
    constructor(IRandomSource source, uint32 playerTimeout_, uint32 outsiderTimeout_) {
        if (address(source) == address(0)) revert ZeroSource();
        if (playerTimeout_ == 0) revert ZeroPlayerTimeout();
        if (outsiderTimeout_ < playerTimeout_) revert OutsiderTimeoutTooShort(outsiderTimeout_, playerTimeout_);
        randomSource = source;
        playerTimeout = playerTimeout_;
        outsiderTimeout = outsiderTimeout_;
    }

    /// @notice Pay the current randomness fee and request a chest for the caller.
    /// Send at least `randomSource.fee()`; the change is returned.
    /// @dev The fee is read here, in the same transaction, because it changes
    /// over time. Exactly `f` goes to the source, so the source has no change to
    /// return to us (this contract has no `receive`). The pending record can only
    /// be written after `requestWord` returns the id, which is why the source must
    /// never deliver inside `requestWord`. The refund is the LAST step: by then the
    /// request is stored, so re-entering `open` from the refund hits ChestPending.
    function open() external payable {
        address player = msg.sender;
        if (_pending[player].active) revert ChestPending();

        uint256 f = randomSource.fee();
        if (msg.value < f) revert InsufficientFee(f, msg.value);

        uint64 requestId = randomSource.requestWord{value: f}(player);
        // uint40 seconds last until the year 36812.
        // forge-lint: disable-next-line(unsafe-typecast)
        _pending[player] = Pending({active: true, requestId: requestId, committedAt: uint40(block.timestamp)});
        // The event needs the id, which only exists after the call to the source;
        // the source is a trusted immutable that never calls back into `open`.
        // forge-lint: disable-next-line(reentrancy-events)
        emit ChestRequested(player, requestId, f);

        uint256 change = msg.value - f;
        if (change > 0) {
            (bool ok,) = player.call{value: change}("");
            if (!ok) revert RefundFailed();
        }
    }

    /// @inheritdoc IRandomConsumer
    /// @dev Accepts a word only from `randomSource` and only for the player's
    /// active request with the same id: anything else would let a caller pick
    /// the outcome. The pending record is deleted before scoring, so the same
    /// delivery can never be applied twice; a word for a cancelled request
    /// reverts here. A revert rolls back the whole delivery, including the
    /// adapter's delete, so with real Pyth a failed callback stays recorded and
    /// can be retried; a retry for a cancelled or superseded request reverts
    /// again with UnknownRequest, so it cannot score.
    function receiveWord(address player, uint64 requestId, uint256 word) external {
        if (msg.sender != address(randomSource)) revert NotRandomSource();
        Pending memory p = _pending[player];
        if (!p.active || p.requestId != requestId) revert UnknownRequest(player, requestId);
        delete _pending[player];

        uint8 r = ChestMath.rarity(word);
        _record(player, r);
        emit ChestOpened(player, requestId, r);
    }

    /// @notice Cancel `player`'s request whose word never arrived.
    /// @dev The player may cancel once more than `playerTimeout` seconds of REAL
    /// time (block.timestamp) have passed since the request; anyone else only
    /// after `outsiderTimeout`, so a stranger cannot grief a request that is
    /// merely slow, yet a stuck request can be cleared even if its player never
    /// comes back (e.g. a front end or keeper acting for them). The boundary is
    /// strict: at exactly `committedAt + timeout` it still reverts, reporting the
    /// first second at which it would succeed.
    ///
    /// Nothing is refunded: the fee was paid to the random source (and on to
    /// Pyth) when the request was made; it is not held by this contract, so there
    /// is nothing here to return.
    function cancel(address player) external {
        Pending memory p = _pending[player];
        if (!p.active) revert NoPendingRequest();

        uint256 waitSeconds = msg.sender == player ? playerTimeout : outsiderTimeout;
        uint256 availableAt = uint256(p.committedAt) + waitSeconds;
        // Real time is the point: a stuck request is stuck in wall-clock terms. A
        // block producer's few seconds of timestamp drift are small next to the
        // timeouts and only move the moment a cancel becomes possible.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp <= availableAt) revert RequestNotTimedOut(availableAt + 1);

        delete _pending[player];
        emit ChestCancelled(player, p.requestId, msg.sender);
    }

    /// @notice The outstanding request of `player`, if any.
    /// @return active Whether a request is outstanding (the other fields are 0 if not).
    /// @return requestId The source's id for the request.
    /// @return committedAt `block.timestamp` of the request.
    /// @return playerAvailableAt `committedAt + playerTimeout`; the player's cancel
    ///         succeeds strictly AFTER this moment (the same value `cancel` compares).
    /// @return outsiderAvailableAt `committedAt + outsiderTimeout`; likewise for anyone else.
    function pendingOf(address player)
        external
        view
        returns (
            bool active,
            uint64 requestId,
            uint40 committedAt,
            uint256 playerAvailableAt,
            uint256 outsiderAvailableAt
        )
    {
        Pending memory p = _pending[player];
        active = p.active;
        if (active) {
            requestId = p.requestId;
            committedAt = p.committedAt;
            playerAvailableAt = uint256(committedAt) + playerTimeout;
            outsiderAvailableAt = uint256(committedAt) + outsiderTimeout;
        }
    }
}
