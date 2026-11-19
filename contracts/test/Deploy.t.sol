// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Test} from "forge-std/Test.sol";
import {MonadTestnet} from "../src/MonadTestnet.sol";
import {PythEntropySource} from "../src/PythEntropySource.sol";
import {ChestGame} from "../src/ChestGame.sol";
import {NameRegistry} from "../src/NameRegistry.sol";
import {DeployScript} from "../script/Deploy.s.sol";
import {DeployNamesScript} from "../script/DeployNames.s.sol";

/// @notice Runs the deploy scripts in-process (no RPC, no broadcast to any
/// network) to check the chain guard and the wiring of what they deploy.
contract DeployTest is Test {
    function test_Deploy_RevertsOnOtherChain() public {
        DeployScript script = new DeployScript();
        vm.chainId(1);
        vm.expectRevert(abi.encodeWithSelector(DeployScript.UnsupportedChain.selector, uint256(1)));
        script.run();
    }

    function test_Deploy_OnMonadTestnet_WiresPythAndTimeouts() public {
        DeployScript script = new DeployScript();
        vm.chainId(10143);
        (PythEntropySource source, ChestGame game) = script.run();

        assertEq(address(game.randomSource()), address(source));
        assertEq(game.playerTimeout(), 120);
        assertEq(game.outsiderTimeout(), 600);

        assertEq(address(source.entropy()), MonadTestnet.PYTH_ENTROPY);
        assertEq(address(source.entropy()), 0x825c0390f379C631f3Cf11A82a37D20BddF93c07);
        assertEq(source.provider(), MonadTestnet.PYTH_PROVIDER);
        assertEq(source.provider(), 0x6CC14824Ea2918f5De5C2f75A9Da968ad4BD6344);
        assertEq(source.callbackGasLimit(), MonadTestnet.CALLBACK_GAS_LIMIT);
        assertEq(source.callbackGasLimit(), 1_000_000);
    }

    function test_DeployNames_RevertsOnOtherChain() public {
        DeployNamesScript script = new DeployNamesScript();
        vm.chainId(31337);
        vm.expectRevert(abi.encodeWithSelector(DeployNamesScript.UnsupportedChain.selector, uint256(31337)));
        script.run();
    }

    function test_DeployNames_OnMonadTestnet_Deploys() public {
        DeployNamesScript script = new DeployNamesScript();
        vm.chainId(10143);
        NameRegistry registry = script.run();
        assertGt(address(registry).code.length, 0);
    }
}
