import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { ethers } from "ethers";
import { LEDGERCOIN_ABI, ROLES } from "./abi";
import { NETWORK, NICKNAMES } from "./config";
import { friendlyError } from "./errors";
import { RollingNumber } from "./RollingNumber";
import "./App.css";

// Lets TypeScript know about the object MetaMask injects in the page
declare global {
  interface Window {
    ethereum?: ethers.Eip1193Provider & {
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}

// ─── Small helpers ──────────────────────────────────────────────
const toCamp = (value: bigint) =>
  Number(ethers.formatUnits(value, 18)).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const sameAddress = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();
const nameOf = (address: string) => NICKNAMES[address.toLowerCase()] ?? short(address);
const txLink = (hash: string) => (NETWORK.explorerUrl ? `${NETWORK.explorerUrl}/tx/${hash}` : undefined);

// "12.5" -> 12.5 LDG with 18 decimals, or null if the text isn't a positive number
function parseAmount(text: string): bigint | null {
  try {
    const value = ethers.parseUnits(text.trim(), 18);
    return value > 0n ? value : null;
  } catch {
    return null;
  }
}

// ─── Read-only connection to the blockchain ─────────────────────
// Used for every read and for the live events. It doesn't need MetaMask,
// so the page shows the token even before anyone connects.
const readProvider = new ethers.JsonRpcProvider(NETWORK.rpcUrl || undefined, NETWORK.chainId, {
  staticNetwork: true,
});
readProvider.pollingInterval = 2000; // check for new events every 2 seconds
const readToken = new ethers.Contract(NETWORK.tokenAddress, LEDGERCOIN_ABI, readProvider);

const configProblem = !ethers.isAddress(NETWORK.tokenAddress)
  ? `Paste your ${NETWORK.chainName} contract address in src/config.ts.`
  : !NETWORK.rpcUrl
    ? "Add VITE_SEPOLIA_RPC_URL to the file frontend/.env.local, then restart npm run dev."
    : null;

// Ask MetaMask to switch to the right network (and add it if MetaMask doesn't know it)
async function switchNetwork() {
  const chainId = ethers.toQuantity(NETWORK.chainId);
  try {
    await window.ethereum!.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (err) {
    if ((err as { code?: number }).code !== 4902) throw err;
    await window.ethereum!.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId,
          chainName: NETWORK.chainName,
          rpcUrls: [NETWORK.rpcUrl],
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          ...(NETWORK.explorerUrl ? { blockExplorerUrls: [NETWORK.explorerUrl] } : {}),
        },
      ],
    });
  }
}

// ─── Activity (Transfer events) ─────────────────────────────────
type Activity = {
  id: string;
  from: string;
  to: string;
  value: bigint;
  block: number;
  txHash: string;
  fresh: boolean; // arrived live, gets highlighted
};

function toActivity(log: ethers.EventLog, fresh: boolean): Activity {
  return {
    id: `${log.transactionHash}-${log.index}`,
    from: log.args[0],
    to: log.args[1],
    value: log.args[2],
    block: log.blockNumber,
    txHash: log.transactionHash,
    fresh,
  };
}

// LIVE events: we start listening once, when the page loads, and pass each new
// Transfer to whoever is interested (the React component below).
const transferListeners = new Set<(item: Activity) => void>();
if (!configProblem) {
  readProvider
    .getBlockNumber()
    .then((startBlock) => {
      // Called by ethers every time the contract emits a Transfer event
      readToken.on("Transfer", (_from: string, _to: string, _value: bigint, event: ethers.ContractEventPayload) => {
        const isNew = event.log.blockNumber > startBlock; // older ones are already in the history
        transferListeners.forEach((listener) => listener(toActivity(event.log, isNew)));
      });
    })
    .catch(() => {});
}

function mergeActivity(current: Activity[], incoming: Activity[]) {
  const known = new Set(current.map((a) => a.id));
  const added = incoming.filter((a) => !known.has(a.id));
  return [...added, ...current].sort((a, b) => b.block - a.block).slice(0, 40);
}

// Past transfers, read from the blockchain logs
async function loadHistory(): Promise<{ items: Activity[]; note: string | null }> {
  const latest = await readProvider.getBlockNumber();
  const filter = readToken.filters.Transfer();
  const isEventLog = (log: ethers.Log): log is ethers.EventLog => log instanceof ethers.EventLog;
  try {
    const logs = await readToken.queryFilter(filter, NETWORK.deployBlock, latest);
    return { items: logs.filter(isEventLog).map((l) => toActivity(l, false)), note: null };
  } catch {
    // Some free RPC plans only allow reading a few blocks at a time:
    // fall back to the last 200 blocks, 10 at a time.
    const items: Activity[] = [];
    for (let from = Math.max(NETWORK.deployBlock, latest - 199); from <= latest; from += 10) {
      const logs = await readToken.queryFilter(filter, from, Math.min(from + 9, latest));
      items.push(...logs.filter(isEventLog).map((l) => toActivity(l, false)));
    }
    return { items, note: "Showing the last 200 blocks only. Your RPC plan limits older history." };
  }
}

// ─── Toasts ─────────────────────────────────────────────────────
type Toast = {
  id: number;
  kind: "pending" | "success" | "error" | "received";
  title: string;
  detail?: string;
  link?: string;
};

type RunTx = (
  label: string,
  send: (token: ethers.Contract) => Promise<ethers.ContractTransactionResponse>,
) => Promise<boolean>;

type Tab = "send" | "allowance" | "supply";

// ════════════════════════════════════════════════════════════════
export default function App() {
  const [account, setAccount] = useState<string | null>(null);
  const [writeToken, setWriteToken] = useState<ethers.Contract | null>(null);
  const [wrongNetwork, setWrongNetwork] = useState(false);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [supply, setSupply] = useState<{ total: bigint; cap: bigint } | null>(null);
  const [isMinter, setIsMinter] = useState(false);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [historyNote, setHistoryNote] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [tab, setTab] = useState<Tab>("send");
  const [problem, setProblem] = useState<string | null>(configProblem);
  const [tick, setTick] = useState(0); // goes up after each refresh, so forms re-read allowances
  const [mood, setMood] = useState<"up" | "down" | null>(null);

  const accountRef = useRef<string | null>(null);
  const previousBalance = useRef<bigint | null>(null);
  const nextToastId = useRef(1);

  // ── Toast helpers ──
  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const showToast = useCallback(
    (toast: Omit<Toast, "id">, id?: number) => {
      const toastId = id ?? nextToastId.current++;
      setToasts((list) => [...list.filter((t) => t.id !== toastId), { ...toast, id: toastId }].slice(-4));
      if (toast.kind !== "pending") setTimeout(() => dismiss(toastId), toast.kind === "error" ? 9000 : 6000);
      return toastId;
    },
    [dismiss],
  );

  // ── Re-read balances and supply from the blockchain ──
  const refresh = useCallback(async () => {
    if (configProblem) return;
    try {
      const [total, cap] = await Promise.all([
        readToken.totalSupply(),
        readToken.cap(),
      ]);
      setSupply({ total, cap });
      const me = accountRef.current;
      setBalance(me ? await readToken.balanceOf(me) : null);
      setIsMinter(me ? await readToken.hasRole(ROLES.minter, me) : false);
      setTick((t) => t + 1);
    } catch {
      // the "problem" banner below explains connection issues
    }
  }, []);

  // ── Wallet: read which account MetaMask is using ──
  const loadWallet = useCallback(async () => {
    if (!window.ethereum) return;
    const browser = new ethers.BrowserProvider(window.ethereum);
    const accounts: string[] = await browser.send("eth_accounts", []);
    if (accounts.length === 0) {
      setAccount(null);
      setWriteToken(null);
      return;
    }
    const chainId = Number(await browser.send("eth_chainId", []));
    setWrongNetwork(chainId !== NETWORK.chainId);
    const signer = await browser.getSigner();
    setAccount(await signer.getAddress());
    setWriteToken(new ethers.Contract(NETWORK.tokenAddress, LEDGERCOIN_ABI, signer));
  }, []);

  const connect = async () => {
    if (!window.ethereum) {
      showToast({ kind: "error", title: "MetaMask not found", detail: "Install the MetaMask extension, then reload this page." });
      return;
    }
    try {
      await window.ethereum.request({ method: "eth_requestAccounts" });
      await switchNetwork();
      await loadWallet();
    } catch (err) {
      showToast({ kind: "error", title: "Couldn't connect", detail: friendlyError(err) });
    }
  };

  const addToMetaMask = async () => {
    try {
      await window.ethereum?.request({
        method: "wallet_watchAsset",
        params: {
          type: "ERC20",
          options: {
            address: NETWORK.tokenAddress,
            symbol: "LDG",
            decimals: 18,
            image: `${window.location.origin}/logo.png`,
          },
        },
      });
    } catch (err) {
      showToast({ kind: "error", title: "Couldn't add LDG", detail: friendlyError(err) });
    }
  };

  // ── Send a transaction and follow it: signature → pending → confirmed ──
  const runTx: RunTx = async (label, send) => {
    if (!writeToken) return false;
    const id = showToast({ kind: "pending", title: label, detail: "Confirm in MetaMask…" });
    try {
      const tx = await send(writeToken);
      showToast({ kind: "pending", title: label, detail: "Sent. Waiting for the next block…", link: txLink(tx.hash) }, id);
      const receipt = await tx.wait();
      showToast(
        {
          kind: "success",
          title: `${label}: confirmed`,
          detail: `Included in block ${receipt?.blockNumber}, ${receipt?.gasUsed.toLocaleString("en-US")} gas used.`,
          link: txLink(tx.hash),
        },
        id,
      );
      refresh();
      return true;
    } catch (err) {
      showToast({ kind: "error", title: `${label}: failed`, detail: friendlyError(err) }, id);
      return false;
    }
  };

  // ── Effects ──

  // Check that the contract really exists at the configured address
  useEffect(() => {
    if (configProblem) return;
    readProvider
      .getCode(NETWORK.tokenAddress)
      .then((code) => {
        if (code === "0x")
          setProblem(`No contract at ${short(NETWORK.tokenAddress)} on ${NETWORK.chainName}. Deploy it, then update src/config.ts.`);
      })
      .catch(() => setProblem(`Can't reach ${NETWORK.chainName}. Is the blockchain running and the RPC URL right?`));
  }, []);

  // Follow MetaMask: account switched → reload the account; network switched → reload the page
  useEffect(() => {
    loadWallet().catch(() => {});
    const eth = window.ethereum;
    if (!eth?.on) return;
    const onAccounts = () => void loadWallet().catch(() => {});
    const onChain = () => window.location.reload();
    eth.on("accountsChanged", onAccounts);
    eth.on("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, [loadWallet]);

  // New account → read its balance
  useEffect(() => {
    accountRef.current = account;
    previousBalance.current = null;
    refresh();
  }, [account, refresh]);

  // Balance went up or down → flash it
  useEffect(() => {
    const before = previousBalance.current;
    previousBalance.current = balance;
    if (before === null || balance === null || before === balance) return;
    setMood(balance > before ? "up" : "down");
    const timer = setTimeout(() => setMood(null), 1600);
    return () => clearTimeout(timer);
  }, [balance]);

  // Past activity + LIVE Transfer events
  useEffect(() => {
    if (configProblem) return;
    let cancelled = false;
    loadHistory()
      .then(({ items, note }) => {
        if (cancelled) return;
        setActivity((current) => mergeActivity(current, items));
        setHistoryNote(note);
      })
      .catch(() => !cancelled && setHistoryNote("Couldn't load past activity. New transfers still appear here."));

    // A new Transfer happened on the blockchain: add it to the list, refresh balances,
    // and celebrate if the connected account received tokens
    const onTransfer = (item: Activity) => {
      setActivity((current) => mergeActivity(current, [item]));
      if (!item.fresh) return;
      refresh();
      const me = accountRef.current;
      if (sameAddress(item.to, me) && !sameAddress(item.from, me)) {
        showToast({
          kind: "received",
          title: `+${toCamp(item.value)} LDG`,
          detail: item.from === ethers.ZeroAddress ? "New LDG was minted to you." : `Received from ${nameOf(item.from)}.`,
          link: txLink(item.txHash),
        });
      }
    };
    transferListeners.add(onTransfer);
    return () => {
      cancelled = true;
      transferListeners.delete(onTransfer);
    };
  }, [refresh, showToast]);

  // ── Render ──
  const ready = !!writeToken && !wrongNetwork && !problem;
  const supplyPercent = supply && supply.cap > 0n ? Number((supply.total * 10000n) / supply.cap) / 100 : 0;
  const myName = account ? NICKNAMES[account.toLowerCase()] : undefined;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="/logo.png" alt="" width="40" height="40" />
          <div>
            <strong>LedgerCoin</strong>
            <span>The LDG token</span>
          </div>
        </div>
        <div className="topbar-right">
          <span className="network">
            <span className="dot" aria-hidden="true" />
            {NETWORK.chainName}
          </span>
          {!account ? (
            <button className="btn btn-light" onClick={connect}>
              Connect wallet
            </button>
          ) : wrongNetwork ? (
            <button className="btn btn-warn" onClick={connect}>
              Switch to {NETWORK.chainName}
            </button>
          ) : (
            <span className="account" title={account}>
              {myName && <b>{myName}</b>}
              {short(account)}
            </span>
          )}
        </div>
      </header>

      {problem && (
        <div className="problem" role="alert">
          {problem}
        </div>
      )}

      <main className="layout">
        <section className="wallet" aria-label="Your wallet">
          <div className={`balance ${mood ?? ""}`}>
            <p className="balance-label">{account ? `${myName ?? "Your"}${myName ? "'s" : ""} balance` : "Balance"}</p>
            {account && balance !== null ? (
              <p className="balance-value">
                <RollingNumber value={toCamp(balance)} />
                <span className="balance-unit">LDG</span>
              </p>
            ) : (
              <p className="balance-empty">Connect your wallet to see your LDG.</p>
            )}
          </div>

          {supply && (
            <div className="supply">
              <div className="supply-row">
                <span>
                  <b>{toCamp(supply.total)}</b> LDG in circulation
                </span>
                <span>of {toCamp(supply.cap)} max</span>
              </div>
              <div className="supply-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={supplyPercent} aria-label="Share of the maximum supply already minted">
                <span style={{ width: `${Math.max(supplyPercent, 0.6)}%` }} />
              </div>
              <p className="facts">
                Contract:{" "}
                {NETWORK.explorerUrl ? (
                  <a href={`${NETWORK.explorerUrl}/address/${NETWORK.tokenAddress}`} target="_blank" rel="noreferrer">
                    {short(NETWORK.tokenAddress)}
                  </a>
                ) : (
                  short(NETWORK.tokenAddress)
                )}
                .{" "}
                {account && (
                  <button className="link-btn" onClick={addToMetaMask}>
                    Add LDG to MetaMask
                  </button>
                )}
              </p>
            </div>
          )}

          <div className="actions">
            <div className="tabs" role="tablist" aria-label="Actions">
              {(
                [
                  ["send", "Send"],
                  ["allowance", "Allowances"],
                  ["supply", "Mint and burn"],
                ] as [Tab, string][]
              ).map(([id, label]) => (
                <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "tab active" : "tab"} onClick={() => setTab(id)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="tab-body" role="tabpanel">
              {!ready ? (
                <p className="locked">
                  {wrongNetwork ? `Switch MetaMask to ${NETWORK.chainName} to send transactions.` : "Connect your wallet to send transactions."}
                </p>
              ) : tab === "send" ? (
                <SendForm run={runTx} account={account!} balance={balance} />
              ) : tab === "allowance" ? (
                <AllowanceForms run={runTx} account={account!} tick={tick} />
              ) : (
                <SupplyForms run={runTx} isMinter={isMinter} />
              )}
            </div>
          </div>
        </section>

        <aside className="activity" aria-label="Activity">
          <div className="activity-head">
            <h2>Activity</h2>
            <span className="live">
              <span className="dot" aria-hidden="true" />
              Live
            </span>
          </div>
          {historyNote && <p className="note">{historyNote}</p>}
          {activity.length === 0 ? (
            <p className="empty">No transfers yet. Send some LDG and it appears here within seconds.</p>
          ) : (
            <ol className="feed">
              {activity.map((item) => (
                <ActivityRow key={item.id} item={item} account={account} />
              ))}
            </ol>
          )}
        </aside>
      </main>

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
            {t.kind === "pending" && <span className="spinner" aria-hidden="true" />}
            <div className="toast-text">
              <strong>{t.title}</strong>
              {t.detail && <p>{t.detail}</p>}
              {t.link && (
                <a href={t.link} target="_blank" rel="noreferrer">
                  View on Etherscan
                </a>
              )}
            </div>
            <button className="toast-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── One line of the activity feed ──────────────────────────────
function ActivityRow({ item, account }: { item: Activity; account: string | null }) {
  const kind = item.from === ethers.ZeroAddress ? "mint" : item.to === ethers.ZeroAddress ? "burn" : "transfer";
  const who = (address: string) => (sameAddress(address, account) ? `${nameOf(address)} (you)` : nameOf(address));
  const text =
    kind === "mint" ? `Minted to ${who(item.to)}` : kind === "burn" ? `Burned by ${who(item.from)}` : `${who(item.from)} to ${who(item.to)}`;
  const direction = sameAddress(item.to, account) ? "in" : sameAddress(item.from, account) ? "out" : "";
  const link = txLink(item.txHash);
  return (
    <li className={`feed-item ${kind} ${item.fresh ? "fresh" : ""}`}>
      <span className="feed-icon" aria-hidden="true">
        {kind === "mint" ? "+" : kind === "burn" ? "−" : "→"}
      </span>
      <div className="feed-main">
        <span className="feed-text">{text}</span>
        <span className="feed-meta">
          Block {item.block}
          {link && (
            <>
              {", "}
              <a href={link} target="_blank" rel="noreferrer">
                view transaction
              </a>
            </>
          )}
        </span>
      </div>
      <span className={`feed-amount ${direction}`}>
        {direction === "in" ? "+" : direction === "out" ? "−" : ""}
        {toCamp(item.value)}
      </span>
    </li>
  );
}

// ─── Form building blocks ───────────────────────────────────────
function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

// An address input with one-click contacts (from NICKNAMES in config.ts)
function AddressInput({ value, onChange, exclude }: { value: string; onChange: (v: string) => void; exclude?: string | null }) {
  const contacts = Object.entries(NICKNAMES).filter(([address]) => !sameAddress(address, exclude));
  return (
    <>
      <input value={value} onChange={(e) => onChange(e.target.value.trim())} placeholder="0x… address" spellCheck={false} autoComplete="off" />
      {contacts.length > 0 && (
        <span className="contacts">
          {contacts.map(([address, name]) => (
            <button type="button" key={address} className={sameAddress(address, value) ? "chip picked" : "chip"} onClick={() => onChange(ethers.getAddress(address))}>
              {name}
            </button>
          ))}
        </span>
      )}
    </>
  );
}

const addressError = (v: string) => (v && !ethers.isAddress(v) ? "This isn't a valid address." : null);
const amountError = (v: string) => (v && parseAmount(v) === null ? "Enter an amount greater than 0." : null);

// ─── Send tab: transfer() ───────────────────────────────────────
function SendForm({ run, account, balance }: { run: RunTx; account: string; balance: bigint | null }) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const value = parseAmount(amount);
  const canSend = ethers.isAddress(to) && value !== null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    // No balance check here on purpose: the smart contract is the one that refuses.
    const ok = await run(`Send ${amount} LDG to ${nameOf(to)}`, (token) => token.transfer(to, value));
    if (ok) setAmount("");
  };

  return (
    <form className="form" onSubmit={submit}>
      <Field label="To" error={addressError(to)}>
        <AddressInput value={to} onChange={setTo} exclude={account} />
      </Field>
      <Field
        label="Amount"
        error={amountError(amount)}
        hint={
          balance !== null && (
            <>
              You have {toCamp(balance)} LDG.{" "}
              <button type="button" className="link-btn" onClick={() => setAmount(ethers.formatUnits(balance, 18))}>
                Use all
              </button>
            </>
          )
        }
      >
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" inputMode="decimal" />
      </Field>
      <button className="btn" disabled={!canSend}>
        Send
      </button>
    </form>
  );
}

// Reads allowance(owner, spender) and re-reads it after every refresh
function useAllowance(owner: string, spender: string, tick: number) {
  const [value, setValue] = useState<bigint | null>(null);
  useEffect(() => {
    if (!ethers.isAddress(owner) || !ethers.isAddress(spender)) {
      setValue(null);
      return;
    }
    let active = true;
    readToken
      .allowance(owner, spender)
      .then((v: bigint) => active && setValue(v))
      .catch(() => active && setValue(null));
    return () => {
      active = false;
    };
  }, [owner, spender, tick]);
  return value;
}

// ─── Allowances tab: approve() and transferFrom() ───────────────
function AllowanceForms({ run, account, tick }: { run: RunTx; account: string; tick: number }) {
  const [spender, setSpender] = useState("");
  const [approveAmount, setApproveAmount] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [spendAmount, setSpendAmount] = useState("");

  const given = useAllowance(account, spender, tick); // what I allowed the spender
  const received = useAllowance(from, account, tick); // what "from" allowed me
  const approveValue = parseAmount(approveAmount);
  const spendValue = parseAmount(spendAmount);

  const approve = async (e: FormEvent) => {
    e.preventDefault();
    if (!ethers.isAddress(spender) || approveValue === null) return;
    const ok = await run(`Allow ${nameOf(spender)} to spend ${approveAmount} LDG`, (token) => token.approve(spender, approveValue));
    if (ok) setApproveAmount("");
  };

  const spend = async (e: FormEvent) => {
    e.preventDefault();
    if (!ethers.isAddress(from) || !ethers.isAddress(to) || spendValue === null) return;
    const ok = await run(`Spend ${spendAmount} LDG from ${nameOf(from)}`, (token) => token.transferFrom(from, to, spendValue));
    if (ok) setSpendAmount("");
  };

  return (
    <div className="split">
      <form className="form" onSubmit={approve}>
        <h3>Let someone spend your LDG</h3>
        <Field label="Spender" error={addressError(spender)} hint={given !== null && `Currently allowed: ${toCamp(given)} LDG.`}>
          <AddressInput value={spender} onChange={setSpender} exclude={account} />
        </Field>
        <Field label="Amount they may spend" error={amountError(approveAmount)}>
          <input value={approveAmount} onChange={(e) => setApproveAmount(e.target.value)} placeholder="0.00" inputMode="decimal" />
        </Field>
        <button className="btn" disabled={!ethers.isAddress(spender) || approveValue === null}>
          Approve
        </button>
      </form>

      <form className="form" onSubmit={spend}>
        <h3>Spend LDG someone allowed you</h3>
        <Field label="From" error={addressError(from)} hint={received !== null && `You may spend ${toCamp(received)} LDG from ${nameOf(from)}.`}>
          <AddressInput value={from} onChange={setFrom} exclude={account} />
        </Field>
        <Field label="To" error={addressError(to)}>
          <AddressInput value={to} onChange={setTo} />
        </Field>
        <Field label="Amount" error={amountError(spendAmount)}>
          <input value={spendAmount} onChange={(e) => setSpendAmount(e.target.value)} placeholder="0.00" inputMode="decimal" />
        </Field>
        <button className="btn" disabled={!ethers.isAddress(from) || !ethers.isAddress(to) || spendValue === null}>
          Spend
        </button>
      </form>
    </div>
  );
}

// ─── Mint and burn tab: mint() and burn() ───────────────────────
function SupplyForms({ run, isMinter }: { run: RunTx; isMinter: boolean }) {
  const [to, setTo] = useState("");
  const [mintAmount, setMintAmount] = useState("");
  const [burnAmount, setBurnAmount] = useState("");
  const mintValue = parseAmount(mintAmount);
  const burnValue = parseAmount(burnAmount);

  const mint = async (e: FormEvent) => {
    e.preventDefault();
    if (!ethers.isAddress(to) || mintValue === null) return;
    // The contract enforces the minter role.
    const ok = await run(`Mint ${mintAmount} LDG to ${nameOf(to)}`, (token) => token.mint(to, mintValue));
    if (ok) setMintAmount("");
  };

  const burn = async (e: FormEvent) => {
    e.preventDefault();
    if (burnValue === null) return;
    const ok = await run(`Burn ${burnAmount} LDG`, (token) => token.burn(burnValue));
    if (ok) setBurnAmount("");
  };

  return (
    <div className="split">
      <form className="form" onSubmit={mint}>
        <h3>Create new LDG</h3>
        <p className={isMinter ? "badge owner" : "badge"}>
          {isMinter ? "Your wallet has the minter role." : "Only wallets with the minter role can mint."}
        </p>
        <Field label="Give them to" error={addressError(to)}>
          <AddressInput value={to} onChange={setTo} />
        </Field>
        <Field label="Amount" error={amountError(mintAmount)}>
          <input value={mintAmount} onChange={(e) => setMintAmount(e.target.value)} placeholder="0.00" inputMode="decimal" />
        </Field>
        <button className="btn" disabled={!ethers.isAddress(to) || mintValue === null}>
          Mint
        </button>
      </form>

      <form className="form" onSubmit={burn}>
        <h3>Destroy your LDG</h3>
        <p className="badge">Burned tokens are gone for good and the total supply goes down.</p>
        <Field label="Amount" error={amountError(burnAmount)}>
          <input value={burnAmount} onChange={(e) => setBurnAmount(e.target.value)} placeholder="0.00" inputMode="decimal" />
        </Field>
        <button className="btn btn-quiet" disabled={burnValue === null}>
          Burn
        </button>
      </form>
    </div>
  );
}
