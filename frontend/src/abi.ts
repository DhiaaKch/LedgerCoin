import { ethers } from "ethers";
// The ABI is the contract interface: the list of its functions, events, and errors.
// ethers.js accepts it in this human-readable form.
export const LEDGERCOIN_ABI = [
// Read functions (free, no transaction)
"function name() view returns (string)",
"function symbol() view returns (string)",
"function decimals() view returns (uint8)",
"function totalSupply() view returns (uint256)",
"function cap() view returns (uint256)",
"function balanceOf(address account) view returns (uint256)",
"function allowance(address owner, address spender) view returns (uint256)",
"function paused() view returns (bool)",
"function hasRole(bytes32 role, address account) view returns (bool)",
// Write functions (transactions, signed in MetaMask)
"function transfer(address to, uint256 value) returns (bool)",
"function approve(address spender, uint256 value) returns (bool)",
"function transferFrom(address from, address to, uint256 value) returns (bool)",
"function mint(address to, uint256 amount)",
"function burn(uint256 value)",
"function pause()",
"function unpause()",
"function grantRole(bytes32 role, address account)",
"function revokeRole(bytes32 role, address account)",
// Events (the blockchain's notifications)
"event Transfer(address indexed from, address indexed to, uint256 value)",
"event Approval(address indexed owner, address indexed spender, uint256 value)",
"event Paused(address account)",
"event Unpaused(address account)",
"event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)",
"event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender)",
// Errors (why the contract refused a transaction)
"error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
"error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
"error ERC20InvalidReceiver(address receiver)",
"error ERC20InvalidSender(address sender)",
"error ERC20InvalidSpender(address spender)",
"error ERC20InvalidApprover(address approver)",
"error ERC20ExceededCap(uint256 increasedSupply, uint256 cap)",
"error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)",
"error EnforcedPause()",
"error ExpectedPause()",
];
export const tokenInterface = new ethers.Interface(LEDGERCOIN_ABI);
// Role identifiers: the same keccak256 hashes the contract uses
export const ROLES = {
admin: ethers.ZeroHash, // DEFAULT_ADMIN_ROLE is 0x00...00
minter: ethers.id("MINTER_ROLE"), // keccak256("MINTER_ROLE")
pauser: ethers.id("PAUSER_ROLE"),
};
export function roleName(role: string): string {
if (role === ROLES.admin) return "admin";
if (role === ROLES.minter) return "minter";
if (role === ROLES.pauser) return "pauser";
return "unknown";
}
