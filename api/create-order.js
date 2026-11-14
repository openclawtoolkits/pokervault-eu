const crypto = require("crypto");
const catalog = require("./_data/catalog.json");
const { saveOrder } = require("./_lib/store");
const { NETWORKS, getWalletForNetwork, getBtcUsdPrice } = require("./_lib/chain");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const email = String(body.email || "").trim().toLowerCase();
    const networkId = String(body.network || "").trim();
    const productIds = Array.isArray(body.productIds) ? [...new Set(body.productIds.map(String))] : [];

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email address for delivery." });
    }
    if (!productIds.length) {
      return res.status(400).json({ error: "No courses selected." });
    }
    const cfg = NETWORKS[networkId];
    if (!cfg) {
      return res.status(400).json({ error: "Unsupported payment network." });
    }
    const wallet = getWalletForNetwork(networkId);
    if (!wallet) {
      return res.status(500).json({ error: `Receiving wallet for ${cfg.label} is not configured yet.` });
    }

    const items = productIds.map((id) => catalog[id]).filter(Boolean);
    if (!items.length) {
      return res.status(400).json({ error: "Invalid course selection." });
    }

    const rawTotal = items.reduce((s, p) => s + Number(p.price), 0);
    const discountRate = items.length >= 3 ? 0.25 : items.length === 2 ? 0.15 : 0;
    const baseUsd = Math.round(rawTotal * (1 - discountRate));

    // Add 1..99 unique cents so concurrent orders are distinguishable on-chain
    const uniqueCents = crypto.randomInt(1, 100);
    const totalUsd = Number((baseUsd + uniqueCents / 100).toFixed(2));

    let btcPriceUsd = null;
    let totalAsset = totalUsd;
    if (cfg.id === "BTC") {
      btcPriceUsd = await getBtcUsdPrice();
      totalAsset = Number((totalUsd / btcPriceUsd).toFixed(8));
    }

    const orderId = "PV-" + crypto.randomBytes(4).toString("hex").toUpperCase();
    const order = {
      id: orderId,
      email,
      items,
      baseUsd,
      uniqueCents,
      totalUsd,
      totalAsset,
      paidUsd: 0,
      paidAsset: 0,
      btcPriceUsd,
      network: cfg.id,
      networkLabel: cfg.label,
      symbol: cfg.symbol,
      wallet,
      status: "pending", // pending | partial | paid
      txs: [],
      shortfallEmailSent: false,
      confirmEmailSent: false,
      createdAt: Date.now(),
    };

    await saveOrder(order);

    return res.status(200).json({
      order: {
        id: order.id,
        email: order.email,
        items: order.items,
        totalUsd: order.totalUsd,
        totalAsset: order.totalAsset,
        remainingUsd: order.totalUsd,
        remainingAsset: order.totalAsset,
        paidUsd: 0,
        paidAsset: 0,
        network: order.network,
        networkLabel: order.networkLabel,
        symbol: order.symbol,
        wallet: order.wallet,
        status: order.status,
      },
    });
  } catch (err) {
    console.error("create-order error:", err);
    return res.status(500).json({ error: err.message || "Failed to create order." });
  }
};
