// ─────────────────────────────────────────────────────────────
//  Edit this file after each deployment.
// ─────────────────────────────────────────────────────────────

// 1) Which blockchain the website talks to: "localhost" or "sepolia"
const ACTIVE_NETWORK: "localhost" | "sepolia" = "sepolia";

const NETWORKS = {
  localhost: {
    chainId: 31337,
    chainName: "Hardhat Local",
    rpcUrl: "http://127.0.0.1:8545",
    explorerUrl: "", // no block explorer for a local blockchain
    // 2) Contract address printed by `ignition deploy --network localhost`
    tokenAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    deployBlock: 0,
  },
  sepolia: {
    chainId: 11155111,
    chainName: "Sepolia",
    // Read from the file frontend/.env.local (never pushed to GitHub)
    rpcUrl: import.meta.env.VITE_SEPOLIA_RPC_URL ?? "",
    explorerUrl: "https://sepolia.etherscan.io",
    // 3) Contract address printed by `ignition deploy --network sepolia`
    tokenAddress: "0x2ED38507d70E035dF14Cc9eb2331901620ea14e2",
    // 4) Block number of the deployment (on Etherscan), so the activity list starts there
    deployBlock: 0,
  },
};

export const NETWORK = NETWORKS[ACTIVE_NETWORK];

// 5) Names shown instead of addresses. Write the addresses in lowercase.
//    The three local ones are Hardhat's test accounts #0, #1 and #2.
export const NICKNAMES: Record<string, string> = {
  "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266": "Alice",
  "0x70997970c51812dc3a010c7d01b50e0d17dc79c8": "Bob Local",
  "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc": "Charlie Local",
  // Add your Sepolia accounts here, for example:
  // "0x1234...abcd": "Alice",
  "0x304786c6fb9f302deb4db481a053a10be7414c9a": "Alice Sepolia",
  "0x349e3dc8e1add6fb4114623a9fac265cc5f7bfa4": "Bob",
  "0x811155929230734c0f7b70c306c4217d6fc0e447": "Charlie",
};
