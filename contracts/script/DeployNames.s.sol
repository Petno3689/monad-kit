// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Script, console} from "forge-std/Script.sol";
import {MonadTestnet} from "../src/MonadTestnet.sol";
import {NameRegistry} from "../src/NameRegistry.sol";

/// @notice Deploys NameRegistry on Monad testnet.
/// @dev Sign with an encrypted Foundry keystore only (`--account <name>`). Never
/// pass a private key: no --private-key flag, no env var, no key in any file.
///
/// Example (run from contracts/):
///   forge script script/DeployNames.s.sol --rpc-url monad_testnet --broadcast --account <name>
///
/// The script refuses any chain other than Monad testnet, so a mistyped RPC URL
/// cannot deploy the registry somewhere the kit's front end will never look.
contract DeployNamesScript is Script {
    error UnsupportedChain(uint256 chainId);

    function run() external returns (NameRegistry registry) {
        if (block.chainid != MonadTestnet.CHAIN_ID) revert UnsupportedChain(block.chainid);

        vm.startBroadcast();
        registry = new NameRegistry();
        vm.stopBroadcast();

        console.log("NameRegistry deployed at:", address(registry));
    }
}
