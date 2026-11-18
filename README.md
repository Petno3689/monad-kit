# monad-kit

monad-kit is a starter kit for Monad testnet apps: a Foundry project with tested contracts, and a Vite + React + TypeScript + viem front end with a ready chain config and an RPC rate limiter that keeps the app under the public RPC limit. It is extracted from a finished game, Unstable Portals Lab.

**Status:** Under construction (November 2026)

## Layout

- `contracts/` — Foundry project (Solidity 0.8.38, forge-std v1.17.0, Monad-ready compiler settings).
- `app/` — Vite + React + TypeScript (strict) + viem front end. No wagmi.
- `docs/` — ticket template and review checklist for working with Claude Code.

## Prerequisites

- [Foundry](https://book.getfoundry.sh/) (forge)
- Node 22+

## Build and test

Contracts:

```
cd contracts
forge build
forge test
```

App:

```
cd app
npm install
npm test
npm run build
npm run lint
npm run dev
```

## Origin

Extracted from Unstable Portals Lab: https://github.com/Petno3689/portal-lab-monad

## License

MIT
