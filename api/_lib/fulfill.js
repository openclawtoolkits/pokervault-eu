const { saveOrder } = require("./store");
const { sendOrderConfirmedEmail, sendAdminFulfillmentEmail } = require("./email");
const driveLinks = require("../_data/drive-links.json");

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

function formatOrderResponse(order, delivery = null) {
  const remainingUsd =
    order.status === "paid"
      ? 0
      : Math.max(0, Number((order.totalUsd - (order.paidUsd || 0)).toFixed(2)));
  const remainingAsset =
    order.status === "paid"
      ? 0
      : order.network === "BTC" && order.btcPriceUsd
      ? Math.max(0, Number((remainingUsd / order.btcPriceUsd).toFixed(8)))
      : remainingUsd;

  const out = {
    id: order.id,
    email: order.email,
    items: order.items,
    totalUsd: order.totalUsd,
    totalAsset: order.totalAsset,
    paidUsd: Number((order.paidUsd || 0).toFixed(2)),
    paidAsset: order.paidAsset || 0,
    remainingUsd,
    remainingAsset,
    network: order.network,
    networkLabel: order.networkLabel,
    symbol: order.symbol,
    wallet: order.wallet,
    status: order.status,
    txs: order.txs || [],
  };
  if (delivery) out.delivery = delivery;
  return out;
}

async function finalizePaidOrder(order) {
  order.status = "paid";
  const delivery = buildDelivery(order);
  await saveOrder(order);

  if (!order.confirmEmailSent) {
    order.confirmEmailSent = true;
    await saveOrder(order);
    await Promise.allSettled([
      sendOrderConfirmedEmail(order, delivery.instantItems, delivery.pendingItems),
      sendAdminFulfillmentEmail(order, delivery.instantItems, delivery.pendingItems),
    ]);
  }
  return delivery;
}

module.exports = {
  buildDelivery,
  formatOrderResponse,
  finalizePaidOrder,
};
