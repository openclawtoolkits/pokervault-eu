const { getOrder, saveOrder, isTxClaimed, claimTx } = require("./_lib/store");
const { fetchIncomingTransfers, fetchSingleTxTransfer } = require("./_lib/chain");
const {
  sendOrderConfirmedEmail,
  sendAdminFulfillmentEmail,
  sendShortfallEmail,
} = require("./_lib/email");
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

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const orderId = String(body.orderId || "").trim();
    const txidInput = String(body.txid || "").trim();

    if (!orderId) return res.status(400).json({ error: "Missing orderId" });
    const order = await getOrder(orderId);
    if (!order) return res.status(404).json({ error: "Order not found or expired." });

    if (order.status === "paid") {
      return res.status(200).json({ order: formatOrderResponse(order, buildDelivery(order)) });
    }

    const remainingBefore = Math.max(0, Number((order.totalUsd - (order.paidUsd || 0)).toFixed(2)));
    const remainingCents = Math.round((remainingBefore % 1) * 100);
    let newlyMatched = [];

    if (txidInput) {
      if (await isTxClaimed(txidInput)) {
        return res.status(400).json({ error: "This transaction ID has already been claimed." });
      }
      const tx = await fetchSingleTxTransfer(order, txidInput);
      if (!tx) {
        return res.status(400).json({
          error: "No matching transfer to our receiving address was found in that transaction.",
        });
      }
      newlyMatched.push(tx);
    } else {
      const transfers = await fetchIncomingTransfers(order);
      for (const t of transfers) {
        if (await isTxClaimed(t.txid)) continue;
        const txCents = Math.round((t.amountUsd % 1) * 100);
        const coversRemaining = t.amountUsd >= remainingBefore - 0.02;
        const matchesUniqueCents = order.network !== "BTC" && txCents === remainingCents;
        if (coversRemaining || matchesUniqueCents) {
          newlyMatched.push(t);
          break;
        }
      }
    }

    if (!newlyMatched.length) {
      return res.status(200).json({ order: formatOrderResponse(order) });
    }

    let newlyPaidUsd = 0;
    for (const tx of newlyMatched) {
      await claimTx(tx.txid, order.id);
      order.txs = order.txs || [];
      order.txs.push(tx);
      order.paidUsd = Number(((order.paidUsd || 0) + tx.amountUsd).toFixed(4));
      order.paidAsset = Number(((order.paidAsset || 0) + tx.amountAsset).toFixed(8));
      newlyPaidUsd += tx.amountUsd;
    }

    const remainingAfter = Math.max(0, Number((order.totalUsd - order.paidUsd).toFixed(2)));

    if (remainingAfter <= 0.02) {
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

      return res.status(200).json({ order: formatOrderResponse(order, delivery) });
    }

    // Partial payment (money is short)
    order.status = "partial";
    const remainingAsset =
      order.network === "BTC" && order.btcPriceUsd
        ? Number((remainingAfter / order.btcPriceUsd).toFixed(8))
        : remainingAfter;

    await saveOrder(order);
    await sendShortfallEmail(order, newlyPaidUsd, remainingAfter, remainingAsset).catch((e) =>
      console.error("Shortfall email failed:", e)
    );

    return res.status(200).json({ order: formatOrderResponse(order) });
  } catch (err) {
    console.error("verify-payment error:", err);
    return res.status(500).json({ error: err.message || "Payment verification failed." });
  }
};
