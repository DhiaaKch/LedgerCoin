import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { parseUnits } from "ethers";

// Describes HOW to deploy the token. Hardhat Ignition runs these steps in
// order.
export default buildModule("LedgerCoinModule", (m) => {
    // Account #0 = the one whose private key Hardhat uses (Alice). She becomes
    // the admin, with every role: admin, minter and pauser.
    const admin = m.getAccount(0);

    // Maximum supply: 1,000,000 LDG (18 decimals)
    const maxSupply = parseUnits("1000000", 18);

    // Step 1: deploy the contract
    const token = m.contract("LedgerCoin", [admin, maxSupply]);

    // Step 2: give the admin a starting balance of 10,000 LDG
    m.call(token, "mint", [admin, parseUnits("10000", 18)], {
        id: "initialMint",
    });

    return { token };
});