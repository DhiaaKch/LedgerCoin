# LedgerCoin

LedgerCoin (LDG) is an ERC-20 token project with a capped supply, role-based
minting, and an emergency pause. The repository also contains a React/Vite
interface for viewing token activity and interacting with a deployment through
MetaMask.

The Solidity contract is in `contracts-app/`; the web client is in `frontend/`.
They are separate npm projects, so install and run each one from its own
directory.

## What the contract does

- Uses 18 decimals and the name `LedgerCoin` / symbol `LDG`.
- Enforces a maximum supply supplied at deployment.
- Allows accounts with `MINTER_ROLE` to mint up to the cap.
- Allows accounts with `PAUSER_ROLE` to pause and resume transfers, minting,
  and burning.
- Uses OpenZeppelin `AccessControl` for role administration.
- Lets token holders burn their own tokens and use standard ERC-20 allowances.

The deployment module in `contracts-app/ignition/modules/LedgerCoin.ts` sets
the first configured account as admin, minter, and pauser. It deploys with a
1,000,000 LDG cap and mints an initial 10,000 LDG to that account. The contract
itself starts with no tokens; the initial mint is a separate step in the
Ignition module.

## Repository layout

```text
contracts-app/
  contracts/LedgerCoin.sol       Solidity contract
  ignition/modules/              Hardhat Ignition deployment module
  test/LedgerCoin.ts             Contract tests
  hardhat.config.ts              Solidity compiler and network settings
frontend/
  src/                           React application and contract configuration
  public/                        Static assets
```

## Requirements

- Node.js and npm (use a current Node.js LTS release).
- MetaMask for submitting transactions from the web app.
- For Sepolia deployment: a funded Sepolia account, an RPC endpoint, and the
  relevant credentials configured locally.

## Install

Run these commands from the repository root:

```powershell
cd contracts-app
npm ci
cd ..\frontend
npm ci
```

## Compile and test the contract

From `contracts-app/`:

```powershell
npx hardhat compile
npx hardhat test
```

The tests use a fresh local Hardhat network and cover token metadata and roles,
minting and the supply cap, transfers, allowances, burning, and pause behavior.
No RPC endpoint, wallet, or deployed contract is needed to run them.

## Run the web app

The frontend reads blockchain data from an RPC endpoint and uses MetaMask for
transactions. It does not need a private key of its own.

1. Copy `frontend/.env.example` to `frontend/.env.local`.
2. Set `VITE_SEPOLIA_RPC_URL` in `.env.local` to an RPC URL for Sepolia.
3. Check `frontend/src/config.ts`. Set the active network, chain ID, token
   address, explorer URL, and deployment block to match the deployment you
   intend to use.
4. Start the development server from `frontend/`:

   ```powershell
   npm run dev
   ```

Open the local URL printed by Vite. Connect MetaMask on the configured network
to submit transactions. The RPC URL is exposed to the browser as a Vite
`VITE_` variable; use an endpoint intended for client-side use and observe its
provider's limits.

To create a production frontend bundle, run `npm run build` in `frontend/`.
`npm run preview` serves that bundle locally for a final check.

## Deploy to a local Hardhat network

Open one terminal in `contracts-app/` and start a local node:

```powershell
npx hardhat node
```

In a second terminal, deploy the module:

```powershell
cd contracts-app
npx hardhat ignition deploy --network localhost ignition/modules/LedgerCoin.ts
```

Copy the deployed address from the command output into the `localhost`
configuration in `frontend/src/config.ts`, then select `localhost` as the
active network. Keep the node running while using the app. A local chain is
reset when its node process is stopped.

## Deploy to Sepolia

Set up the Hardhat keystore from `contracts-app/` before deployment:

```powershell
npx hardhat keystore set SEPOLIA_RPC_URL
npx hardhat keystore set SEPOLIA_PRIVATE_KEY
```

Use an RPC URL and a private key for a dedicated deployment account. Fund that
account with Sepolia ETH. Do not put a private key in the frontend, source
control, or a Vite environment variable.

Deploy with:

```powershell
npx hardhat ignition deploy --network sepolia ignition/modules/LedgerCoin.ts
```

Record the resulting contract address and deployment block. Update the Sepolia
entry in `frontend/src/config.ts` to use those values. The web app's RPC URL is
configured separately in `frontend/.env.local`; the Hardhat keystore settings
are for deployment and are not read by Vite.

## Roles and operational notes

| Role | Capability | Initial holder |
| --- | --- | --- |
| `DEFAULT_ADMIN_ROLE` | Grant and revoke roles | Deployment admin |
| `MINTER_ROLE` | Mint tokens, subject to the cap | Deployment admin |
| `PAUSER_ROLE` | Pause and unpause token operations | Deployment admin |

The deployment admin initially holds all three roles. Assign roles only to
accounts that should have those powers. Losing the admin account can make role
management impossible; losing all pauser accounts removes the ability to
resume the contract after a pause.

Pausing is an emergency control, not a way to freeze selected accounts: it
stops all transfers, mints, and burns until an authorized pauser unpauses the
contract. Burning reduces circulating and total supply; it does not restore
minting capacity above the fixed lifetime cap.

## Configuration and troubleshooting

- **The app says the RPC URL is missing:** create `frontend/.env.local` from
  `.env.example`, set `VITE_SEPOLIA_RPC_URL`, and restart Vite.
- **The app shows the wrong chain or no token:** check `ACTIVE_NETWORK`,
  `chainId`, `tokenAddress`, and `deployBlock` in `frontend/src/config.ts`.
- **MetaMask cannot submit a transaction:** switch MetaMask to the configured
  network and check that the connected account has the required role and
  enough native test ETH for gas.
- **History is incomplete:** check the RPC provider's log-range limits. The
  app can fall back to a limited recent block range when a provider restricts
  historical queries.
- **A local deployment address no longer works:** restart the node and deploy
  again, then update the frontend address.

Keep `.env.local`, private keys, and provider credentials out of commits.
`.env.example` is safe to share because it contains only a placeholder.

## Scope

This repository contains application code and tests; it is not an audit or a
guarantee that a deployment is suitable for production. Review the contract,
deployment parameters, administrator controls, RPC configuration, and wallet
permissions before using real assets.
