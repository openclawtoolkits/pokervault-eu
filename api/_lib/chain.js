const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const NETWORKS = {
  USDT_TRC20: {
    id: "USDT_TRC20",
    label: "USDT (TRC20 · Tron)",
    symbol: "USDT",
    decimals: 6,
    walletEnv: "WALLET_TRC20",
    contracts: ["TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"],
  },
  USDT_POLYGON: {
    id: "USDT_POLYGON",
    label: "USDT (Polygon)",
    symbol: "USDT",
    decimals: 6,
    walletEnv: "WALLET_EVM",
    rpcs: ["https://polygon-rpc.com", "https://polygon-bor-rpc.publicnode.com"],
    contracts: ["0xc2132D05D31c914a87C6611C10748AEb04B58e8F"],
  },
  USDC_POLYGON: {
    id: "USDC_POLYGON",
    label: "USDC (Polygon)",
    symbol: "USDC",
    decimals: 6,
    walletEnv: "WALLET_EVM",
    rpcs: ["https://polygon-rpc.com", "https://polygon-bor-rpc.publicnode.com"],
    contracts: [
      "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", // Native USDC
      "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // Bridged USDC.e
    ],
  },
  USDT_BASE: {
    id: "USDT_BASE",
    label: "USDT (Base)",
    symbol: "USDT",
    decimals: 6,
    walletEnv: "WALLET_EVM",
    rpcs: ["https://mainnet.base.org", "https://base-rpc.publicnode.com"],
    contracts: ["0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2"],
  },
  USDC_BASE: {
    id: "USDC_BASE",
    label: "USDC (Base)",
    symbol: "USDC",
    decimals: 6,
    walletEnv: "WALLET_EVM",
    rpcs: ["https://mainnet.base.org", "https://base-rpc.publicnode.com"],
    contracts: ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"],
  },
  BTC: {
    id: "BTC",
    label: "Bitcoin (BTC)",
    symbol: "BTC",
    decimals: 8,
    walletEnv: "WALLET_BTC",
  },
};

function getWalletForNetwork(networkId) {
  const cfg = NETWORKS[networkId];
  if (!cfg) return null;
  const addr = process.env[cfg.walletEnv];
  return addr ? addr.trim() : null;
}

async function getBtcUsdPrice() {
  try {
    const r = await fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot");
    if (r.ok) {
      const j = await r.json();
      const p = parseFloat(j?.data?.amount);
      if (p > 1000) return p;
    }
  } catch (_) {}
  const r2 = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd");
  if (r2.ok) {
    const j2 = await r2.json();
    const p2 = parseFloat(j2?.bitcoin?.usd);
    if (p2 > 1000) return p2;
  }
  throw new Error("Unable to fetch live BTC/USD price.");
}

async function evmRpc(rpcs, method, params) {
  let lastErr;
  for (const url of rpcs) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
      return data.result;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("All EVM RPC endpoints failed.");
}

function padEvmAddress(addr) {
  return "0x" + addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function hexToFloat(hexVal, decimals) {
  const big = BigInt(hexVal);
  const whole = big / BigInt(10 ** decimals);
  const frac = big % BigInt(10 ** decimals);
  return Number(whole) + Number(frac) / 10 ** decimals;
}

// Fetch incoming transfers on the order's network since order.createdAt
async function fetchIncomingTransfers(order) {
  const cfg = NETWORKS[order.network];
  if (!cfg) throw new Error(`Unsupported network: ${order.network}`);
  const minTsMs = order.createdAt - 120000; // 2-minute clock buffer

  if (cfg.id === "USDT_TRC20") {
    const headers = {};
    if (process.env.TRONGRID_API_KEY) headers["TRON-PRO-API-KEY"] = process.env.TRONGRID_API_KEY;
    const url = `https://api.trongrid.io/v1/accounts/${order.wallet}/transactions/trc20?limit=30&only_to=true&contract_address=${cfg.contracts[0]}&min_timestamp=${minTsMs}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`TronGrid error (${res.status})`);
    const json = await res.json();
    const list = json.data || [];
    return list
      .filter((tx) => (tx.to || "").toLowerCase() === order.wallet.toLowerCase())
      .map((tx) => {
        const amt = Number(tx.value) / 10 ** cfg.decimals;
        return {
          txid: tx.transaction_id,
          amountAsset: amt,
          amountUsd: amt,
          timestampMs: Number(tx.block_timestamp || Date.now()),
        };
      });
  }

  if (cfg.id === "BTC") {
    const res = await fetch(`https://mempool.space/api/address/${order.wallet}/txs`);
    if (!res.ok) throw new Error(`Mempool.space error (${res.status})`);
    const txs = await res.json();
    const out = [];
    for (const tx of txs) {
      const tsMs = tx.status?.block_time ? tx.status.block_time * 1000 : Date.now();
      if (tx.status?.confirmed && tsMs < minTsMs) continue;
      let sats = 0;
      for (const vout of tx.vout || []) {
        if (vout.scriptpubkey_address === order.wallet) sats += Number(vout.value || 0);
      }
      if (sats > 0) {
        const btc = sats / 1e8;
        out.push({
          txid: tx.txid,
          amountAsset: btc,
          amountUsd: btc * Number(order.btcPriceUsd),
          timestampMs: tsMs,
        });
      }
    }
    return out;
  }

  // EVM (Polygon / Base)
  const latestHex = await evmRpc(cfg.rpcs, "eth_blockNumber", []);
  const latestBlock = parseInt(latestHex, 16);
  const fromBlock = "0x" + Math.max(0, latestBlock - 1800).toString(16); // ~1 hour on Polygon/Base
  const logs = await evmRpc(cfg.rpcs, "eth_getLogs", [
    {
      fromBlock,
      toBlock: "latest",
      address: cfg.contracts,
      topics: [TRANSFER_TOPIC, null, padEvmAddress(order.wallet)],
    },
  ]);

  const byTx = new Map();
  for (const log of logs || []) {
    const amt = hexToFloat(log.data, cfg.decimals);
    if (amt <= 0) continue;
    const prev = byTx.get(log.transactionHash) || 0;
    byTx.set(log.transactionHash, prev + amt);
  }

  const out = [];
  for (const [txid, amt] of byTx.entries()) {
    out.push({
      txid,
      amountAsset: amt,
      amountUsd: amt,
      timestampMs: Date.now(),
    });
  }
  return out;
}

async function fetchSingleTxTransfer(order, rawTxid) {
  const txid = rawTxid.trim();
  const cfg = NETWORKS[order.network];
  if (!cfg) throw new Error(`Unsupported network: ${order.network}`);
  const minTsMs = order.createdAt - 120000;

  if (cfg.id === "USDT_TRC20") {
    const headers = {};
    if (process.env.TRONGRID_API_KEY) headers["TRON-PRO-API-KEY"] = process.env.TRONGRID_API_KEY;
    const res = await fetch(`https://api.trongrid.io/v1/transactions/${txid}/events`, { headers });
    if (!res.ok) throw new Error(`TronGrid TX lookup failed (${res.status})`);
    const json = await res.json();
    let total = 0;
    let tsMs = Date.now();
    for (const ev of json.data || []) {
      if (
        ev.event_name === "Transfer" &&
        (ev.contract_address || "").toLowerCase() === cfg.contracts[0].toLowerCase() &&
        (ev.result?.to || "").toLowerCase() === order.wallet.toLowerCase()
      ) {
        total += Number(ev.result.value || 0) / 10 ** cfg.decimals;
        if (ev.block_timestamp) tsMs = Number(ev.block_timestamp);
      }
    }
    if (total <= 0) return null;
    if (tsMs < minTsMs) throw new Error("Transaction is older than this order.");
    return { txid, amountAsset: total, amountUsd: total, timestampMs: tsMs };
  }

  if (cfg.id === "BTC") {
    const res = await fetch(`https://mempool.space/api/tx/${txid}`);
    if (!res.ok) throw new Error(`Bitcoin TX not found (${res.status})`);
    const tx = await res.json();
    const tsMs = tx.status?.block_time ? tx.status.block_time * 1000 : Date.now();
    if (tx.status?.confirmed && tsMs < minTsMs) {
      throw new Error("Transaction is older than this order.");
    }
    let sats = 0;
    for (const vout of tx.vout || []) {
      if (vout.scriptpubkey_address === order.wallet) sats += Number(vout.value || 0);
    }
    if (sats <= 0) return null;
    const btc = sats / 1e8;
    return { txid, amountAsset: btc, amountUsd: btc * Number(order.btcPriceUsd), timestampMs: tsMs };
  }

  // EVM receipt
  const receipt = await evmRpc(cfg.rpcs, "eth_getTransactionReceipt", [txid]);
  if (!receipt) throw new Error("Transaction not found or still pending confirmation.");
  if (receipt.status !== "0x1") throw new Error("Transaction reverted/failed on-chain.");

  const block = await evmRpc(cfg.rpcs, "eth_getBlockByNumber", [receipt.blockNumber, false]);
  const tsMs = block?.timestamp ? parseInt(block.timestamp, 16) * 1000 : Date.now();
  if (tsMs < minTsMs) throw new Error("Transaction is older than this order.");

  const paddedWallet = padEvmAddress(order.wallet);
  const validContracts = new Set(cfg.contracts.map((c) => c.toLowerCase()));
  let total = 0;
  for (const log of receipt.logs || []) {
    if (
      validContracts.has((log.address || "").toLowerCase()) &&
      log.topics?.[0]?.toLowerCase() === TRANSFER_TOPIC &&
      log.topics?.[2]?.toLowerCase() === paddedWallet
    ) {
      total += hexToFloat(log.data, cfg.decimals);
    }
  }
  if (total <= 0) return null;
  return { txid, amountAsset: total, amountUsd: total, timestampMs: tsMs };
}

module.exports = {
  NETWORKS,
  getWalletForNetwork,
  getBtcUsdPrice,
  fetchIncomingTransfers,
  fetchSingleTxTransfer,
};
