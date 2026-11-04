import { ethers } from "ethers";
import { roleName, tokenInterface } from "./abi";
const fmt = (value: bigint) =>
Number(ethers.formatUnits(value, 18)).toLocaleString("en-US", {
maximumFractionDigits: 2 });
// One clear sentence per contract error
const MESSAGES: Record<string, (args: ethers.Result) => string> = {
ERC20InsufficientBalance: (a) =>
`Not enough LDG: the balance is ${fmt(a[1])} but the transfer needs
${fmt(a[2])}.`,
ERC20InsufficientAllowance: (a) =>
`Allowance too small: you may spend ${fmt(a[1])} LDG but tried
${fmt(a[2])}.`,
AccessControlUnauthorizedAccount: (a) =>
`You don't have the ${roleName(a[1])} role, so the contract refused this
transaction.`,
EnforcedPause: () => "Transfers are paused (emergency stop). Try again once they resume.",
ExpectedPause: () => "Transfers are not paused.",
ERC20ExceededCap: (a) => `Refused: this would go above the maximum supply
of ${fmt(a[1])} LDG.`,
ERC20InvalidReceiver: () => "Tokens can't be sent to the zero address.",
ERC20InvalidSpender: () => "The spender address is not valid.",
};
// Ethers puts revert data in different places depending on the wallet.
function decodeRevert(err: unknown): { name: string; args: ethers.Result } |
null {
const e = err as {
revert?: { name: string; args: ethers.Result };
data?: unknown;
info?: { error?: { data?: unknown } };
};
if (e?.revert?.name) return e.revert;
const nested = e?.info?.error?.data as { data?: unknown } | string |
undefined;
const candidates = [e?.data, nested, typeof nested === "object" ?
nested?.data : undefined];
for (const data of candidates) {
if (typeof data === "string" && data.startsWith("0x") && data.length >=
10) {
try {
const parsed = tokenInterface.parseError(data);
if (parsed) return { name: parsed.name, args: parsed.args };
} catch {
// not one of our errors, keep looking
}
}
}
return null;
}
export function friendlyError(err: unknown): string {
if (ethers.isError(err, "ACTION_REJECTED")) return "You rejected the transaction in MetaMask.";
const revert = decodeRevert(err);
if (revert) {
const message = MESSAGES[revert.name];
return message ? message(revert.args) : `The contract refused the
transaction (${revert.name}).`;
}
if (ethers.isError(err, "INSUFFICIENT_FUNDS"))
return "Not enough ETH to pay the gas fee. Get test ETH from a faucet.";
const e = err as { shortMessage?: string; message?: string };
return e?.shortMessage ?? e?.message ?? "Something went wrong.";
}
