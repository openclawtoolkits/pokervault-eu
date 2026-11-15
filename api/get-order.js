const { getOrder, isTxClaimed, claimTx } = require("./_lib/store");
const { retrieveCheckoutSession } = require("./_lib/stripe");
const { buildDelivery, finalizePaidOrder } = require("./_lib/fulfill");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const orderId = String(req.query?.id || "").trim();
    if (!orderId) return res.status(400).json({ error: "Missing order id" });

    const order = await getOrder(orderId);
    if (!order) return res.status(404).json({ error: "Order not found or expired." });

    if (order.network === "STRIPE" && order.status !== "paid" && order.stripeSessionId) {
      try {
        const session = await retrieveCheckoutSession(order.stripeSessionId);
        if (session && session.payment_status === "paid") {
          const txid = session.payment_intent || session.id;
          if (!(await isTxClaimed(txid))) {
            await claimTx(txid, order.id);
          }
          order.paidUsd = Number(((session.amount_total || 0) / 100).toFixed(2)) || order.totalUsd;
          order.paidAsset = order.paidUsd;
          order.txs = order.txs || [];
          if (!order.txs.some((t) => t.txid === txid)) {
            order.txs.push({
              txid,
              amountUsd: order.paidUsd,
              amountAsset: order.paidUsd,
              symbol: "USD",
              network: "STRIPE",
              timestamp: Date.now(),
            });
          }
          await finalizePaidOrder(order);
        }
      } catch (e) {
        console.error("Stripe session fallback check failed:", e.message);
      }
    }

    const remainingUsd = Math.max(0, Number((order.totalUsd - (order.paidUsd || 0)).toFixed(2)));
    const remainingAsset =
      order.network === "BTC" && order.btcPriceUsd
        ? Math.max(0, Number((remainingUsd / order.btcPriceUsd).toFixed(8)))
        : remainingUsd;

    const base = {
      id: order.id,
      email: order.email,
      items: order.items,
      totalUsd: order.totalUsd,
      totalAsset: order.totalAsset,
      paidUsd: order.paidUsd || 0,
      paidAsset: order.paidAsset || 0,
      remainingUsd,
      remainingAsset,
      network: order.network,
      networkLabel: order.networkLabel,
      symbol: order.symbol,
      wallet: order.wallet,
      status: order.status,
    };

    if (order.status === "paid") {
      base.delivery = buildDelivery(order);
    }

    return res.status(200).json({ order: base });
  } catch (err) {
    console.error("get-order error:", err);
    return res.status(500).json({ error: err.message || "Failed to load order." });
  }
};
