const { getOrder } = require("./_lib/store");
const driveLinks = require("./_data/drive-links.json");

function buildDelivery(order) {
  const instantItems = [];
  const pendingItems = [];
  for (const item of order.items || []) {
    const url = driveLinks[String(item.id)];
    if (url && typeof url === "string" && url.startsWith("http")) {
      instantItems.push({ ...item, driveUrl: url });
    } else {
      pendingItems.push(item);
    }
  }
  return { instantItems, pendingItems };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const orderId = String(req.query?.id || "").trim();
    if (!orderId) return res.status(400).json({ error: "Missing order id" });

    const order = await getOrder(orderId);
    if (!order) return res.status(404).json({ error: "Order not found or expired." });

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
