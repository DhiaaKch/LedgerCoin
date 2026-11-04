# LedgerCoin contract package

This directory contains the LedgerCoin Solidity contract, Hardhat configuration,
tests, and the Ignition deployment module. For the complete repository setup,
frontend instructions, and operational notes, see the [project guide](../README.md).

## Install, compile, and test

From this directory:

```powershell
npm ci
npx hardhat compile
npx hardhat test
```

The tests run against a local simulated chain. They do not require Sepolia
credentials.

## Deploy

The deployment module at `ignition/modules/LedgerCoin.ts` assigns all initial
roles to the first configured account, deploys a token capped at 1,000,000 LDG,
and mints 10,000 LDG to the admin.

For a local network, start `npx hardhat node` in one terminal and run this
command in another:

```powershell
npx hardhat ignition deploy --network localhost ignition/modules/LedgerCoin.ts
```

For Sepolia, first store `SEPOLIA_RPC_URL` and `SEPOLIA_PRIVATE_KEY` with
`npx hardhat keystore set <NAME>`, then run:

```powershell
npx hardhat ignition deploy --network sepolia ignition/modules/LedgerCoin.ts
```

Never commit deployment credentials. After deploying, update the matching
network entry and contract address in `frontend/src/config.ts`.
