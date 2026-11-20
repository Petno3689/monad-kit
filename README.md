# monad-kit

monad-kit is a starter kit for Monad testnet apps. It has a Foundry project with tested contracts (randomness through Pyth Entropy, a score board, a nickname registry, a chest example) and a Vite + React + TypeScript + viem front end with a ready chain config, an RPC rate limiter, a session key, a transaction queue and log reading. It is extracted from a finished game, Unstable Portals Lab, and contains only the shared, proven modules.

**Status:** Deployed on Monad testnet on 19 November 2026. Live demo: https://monad-kit.vercel.app

### Deployed contracts

| Contract | Address | Verified on Sourcify |
| --- | --- | --- |
| `PythEntropySource` | `0x5fA4e703820208c5585f83dC7d4630E8dF598847` | yes (match) |
| `ChestGame` | `0xC674f065eae134151B58F6D12b3A7a08bc9F6e84` | yes (match) |
| `NameRegistry` | `0x1a7C4F4DfC86f618B3debF61F2FEDB9Ac91c509B` | yes (match) |

## What's inside

| Module | What it is for | Where |
| --- | --- | --- |
| `IRandomSource`, `PythEntropySource` | Random-source interface and its Pyth Entropy V2 implementation | `contracts/src/` |
| `MonadTestnet` | Monad testnet constants (chain id, etc.) | `contracts/src/MonadTestnet.sol` |
| `ScoreBoard` | On-chain score board | `contracts/src/ScoreBoard.sol` |
| `NameRegistry` | Nicknames for addresses | `contracts/src/NameRegistry.sol` |
| `ChestMath`, `ChestGame` | Chest example: rarity from a random word, and the game on top of a random source | `contracts/src/` |
| Deploy scripts | `Deploy.s.sol` (PythEntropySource + ChestGame), `DeployNames.s.sol` (NameRegistry); both refuse any chain except 10143 | `contracts/script/` |
| ChestMath mirror + golden vectors | TypeScript copy of `ChestMath` and the shared JSON vectors tested from both Solidity and TS; the vectors are produced by the forge script `forge script script/GenChestVectors.s.sol` (run from `contracts/`), and rerunning it must give a byte-identical file | `shared/src/`, `shared/test/`, `contracts/script/GenChestVectors.s.sol` |
| `chain` | Monad testnet chain definition for viem | `app/src/chain.ts` |
| `rpcLimiter` | Keeps requests under the public RPC limit (10/s) | `app/src/rpcLimiter.ts` |
| `sessionKey` | Game key derived from a wallet signature | `app/src/sessionKey.ts` |
| `funds` | Top-up and withdraw of the session key | `app/src/funds.ts` |
| `tx` | Sending transactions (estimate × 120 % gas) | `app/src/tx.ts` |
| `txQueue` | Sequential sends, waits 3 blocks after each inclusion | `app/src/txQueue.ts` |
| `backoff` | Retry delays | `app/src/backoff.ts` |
| `logs` | `eth_getLogs` in 100-block chunks | `app/src/logs.ts` |
| `names` | Nickname registry client | `app/src/names.ts` |
| `wallet` | Injected-wallet connection | `app/src/wallet.ts` |
| `chest` | Chest game client | `app/src/chest.ts` |
| `errors` | Error mapping to user text | `app/src/errors.ts` |
| Demo UI | Panels for key, funds, chest, board, nickname | `app/src/App.tsx`, `app/src/ui/` |

## Quick start

Prerequisites:

- [Foundry](https://book.getfoundry.sh/) ≥ 1.8 (checked on 1.8.3 and 1.9.0). `contracts/foundry.toml` sets `network = "monad"`, so forge uses Monad opcode pricing.
- Node 22.

Contracts:

```
cd contracts
forge build
forge test
```

Shared (ChestMath mirror and golden vectors):

```
cd shared
npm install
npm test
npm run typecheck
```

App:

```
cd app
npm install
npm test
npm run build
npm run lint
```

`npm run build` also type-checks the app (`tsc -b`).

Run the demo:

```
cd app
npm run dev
```

If localhost does not open: `npm run dev -- --host 127.0.0.1`. `app/src/config.ts` holds the kit's own deployment. A fork deploys its own contracts and sets its own `APP_ORIGIN` before anyone funds a key (see [docs/DEPLOY.md](docs/DEPLOY.md)).

## Deploying

See [docs/DEPLOY.md](docs/DEPLOY.md) (in Russian).

## Monad and Pyth facts

Dated, sourced facts about the network, Pyth Entropy and tooling: [docs/MONAD-PYTH.md](docs/MONAD-PYTH.md) (in Russian).

## Working with Claude Code

The repository is built with Claude Code working from tickets. Rules for Claude Code are in [CLAUDE.md](CLAUDE.md); the ticket template and the review checklist are in [docs/TICKET-TEMPLATE.md](docs/TICKET-TEMPLATE.md) and [docs/REVIEW-CHECKLIST.md](docs/REVIEW-CHECKLIST.md).

## Known limitations

- Sending: after a send error the kit waits up to 15 s for the transaction by its hash; a transaction that lands later than that is still reported as failed.
- Withdraw leaves dust: the key reserves gas × maxFeePerGas but pays gas × effective price (live example: 0.00042 MON left).
- If the request id is not found within 3 attempts right after `open` and the reveal has already landed, the chest panel shows nothing (the board still shows it).
- Mismatch confirmation uses `window.confirm`.
- Only injected wallets are supported (no WalletConnect).
- Monad testnet only.

## Origin

Extracted from Unstable Portals Lab: https://github.com/Petno3689/portal-lab-monad

## License

MIT
