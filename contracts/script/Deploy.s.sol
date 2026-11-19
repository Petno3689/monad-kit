// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Script, console} from "forge-std/Script.sol";
import {MonadTestnet} from "../src/MonadTestnet.sol";
import {PythEntropySource} from "../src/PythEntropySource.sol";
import {ChestGame} from "../src/ChestGame.sol";

/// @notice Deploys PythEntropySource and the ChestGame example on Monad testnet.
/// @dev Sign with an encrypted Foundry keystore only (`--account <name>`). Never
/// pass a private key: no --private-key flag, no env var, no key in any file.
///
/// Example (run from contracts/):
///   forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast --account <name>
///
/// The script refuses any chain other than Monad testnet, because the Pyth
/// addresses it uses are only meaningful there. It logs every parameter so the
/// deploy log shows exactly what landed on chain.
contract DeployScript is Script {
    /// @notice Seconds before a player may cancel their own stuck chest request.
    uint32 public constant PLAYER_TIMEOUT = 120;

    /// @notice Seconds before anyone may cancel a stuck chest request.
    uint32 public constant OUTSIDER_TIMEOUT = 600;

    error UnsupportedChain(uint256 chainId);

    function run() external returns (PythEntropySource source, ChestGame game) {
        if (block.chainid != MonadTestnet.CHAIN_ID) revert UnsupportedChain(block.chainid);

        console.log("Deploying on chain id   :", block.chainid);
        console.log("  Pyth Entropy (proxy)  :", MonadTestnet.PYTH_ENTROPY);
        console.log("  Pyth provider         :", MonadTestnet.PYTH_PROVIDER);
        console.log("  callback gas limit    :", uint256(MonadTestnet.CALLBACK_GAS_LIMIT));
        console.log("  player timeout (s)    :", uint256(PLAYER_TIMEOUT));
        console.log("  outsider timeout (s)  :", uint256(OUTSIDER_TIMEOUT));

        vm.startBroadcast();
        // The source is deployed first: it is the only contract that knows Pyth,
        // and the game takes its address as an immutable.
        source = new PythEntropySource(
            MonadTestnet.PYTH_ENTROPY, MonadTestnet.PYTH_PROVIDER, MonadTestnet.CALLBACK_GAS_LIMIT
        );
        game = new ChestGame(source, PLAYER_TIMEOUT, OUTSIDER_TIMEOUT);
        vm.stopBroadcast();

        console.log("PythEntropySource deployed at:", address(source));
        console.log("ChestGame deployed at        :", address(game));
    }
}
