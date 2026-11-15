const crypto = require("crypto");
const catalog = require("./_data/catalog.json");
const { saveOrder } = require("./_lib/store");
const { createCheckoutSession } = require("./_lib/stripe");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const email = String(body.email || "").trim().toLowerCase();
    const productIds = Array.isArray(body.productIds) ? [...new Set(body.productIds.map(String))] : [];

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email address for delivery." });
    }
    if (!productIds.length) {
      return res.status(400).json({ error: "No courses selected." });
    }

    const items = productIds.map((id) => catalog[id]).filter(Boolean);
    if (!items.length) {
      return res.status(400).json({ error: "Invalid course selection." });
    }

    const rawTotal = items.reduce((s, p) => s + Number(p.price), 0);
    const discountRate = items.length >= 3 ? 0.25 : items.length === 2 ? 0.15 : 0;
    const baseUsd = Math.round(rawTotal * (1 - discountRate));

    const orderId = "PV-" + crypto.randomBytes(4).toString("hex").toUpperCase();
    const order = {
      id: orderId,
      email,
      items,
      baseUsd,
      uniqueCents: 0,
      totalUsd: baseUsd,
      totalAsset: baseUsd,
      paidUsd: 0,
      paidAsset: 0,
      btcPriceUsd: null,
      network: "STRIPE",
      networkLabel: "Card / Apple Pay / Google Pay / Link",
      symbol: "USD",
      wallet: "Stripe Checkout",
      status: "pending",
      txs: [],
      stripeSessionId: null,
      shortfallEmailSent: false,
      confirmEmailSent: false,
      createdAt: Date.now(),
    };

    const session = await createCheckoutSession({
      order,
      items,
      discountRate,
      baseUsd,
      email,
    });

    order.stripeSessionId = session.id;
    await saveOrder(order);

    return res.status(200).json({
      orderId: order.id,
      url: session.url,
    });
  } catch (err) {
    console.error("create-stripe-session error:", err);
    return res.status(500).json({ error: err.message || "Failed to start card checkout." });
  }
};
