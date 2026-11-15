const { getOrder, isTxClaimed, claimTx } = require("./_lib/store");
const { verifyStripeSignature } = require("./_lib/stripe");
const { finalizePaidOrder } = require("./_lib/fulfill");

async function readRawBody(req) {
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  if (chunks.length) return Buffer.concat(chunks).toString("utf8");
  if (req.body && typeof req.body === "object") return JSON.stringify(req.body);
  return "";
}

async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const rawBody = await readRawBody(req);
    const sig = req.headers["stripe-signature"];
    const secret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!verifyStripeSignature(rawBody, sig, secret)) {
      return res.status(400).json({ error: "Invalid Stripe signature" });
    }

    const event = JSON.parse(rawBody);
    if (event.type === "checkout.session.completed") {
      const session = event.data?.object || {};
      const orderId = session.metadata?.orderId;
      if (orderId && session.payment_status === "paid") {
        const order = await getOrder(orderId);
        if (order && order.status !== "paid") {
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
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("stripe-webhook error:", err);
    return res.status(500).json({ error: err.message || "Webhook error" });
  }
}

handler.config = {
  api: {
    bodyParser: false,
  },
};

module.exports = handler;
