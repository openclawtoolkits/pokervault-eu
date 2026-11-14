const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisCmd(...args) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    throw new Error("Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN env vars.");
  }
  const res = await fetch(REDIS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Upstash Redis error (${res.status}): ${txt}`);
  }
  const data = await res.json();
  if (data.error) throw new Error(`Upstash Redis command error: ${data.error}`);
  return data.result;
}

async function saveOrder(order) {
  // Keep orders for 14 days (1209600 seconds)
  await redisCmd("SET", `pv:order:${order.id}`, JSON.stringify(order), "EX", 1209600);
}

async function getOrder(orderId) {
  if (!orderId) return null;
  const raw = await redisCmd("GET", `pv:order:${orderId}`);
  return raw ? JSON.parse(raw) : null;
}

async function isTxClaimed(txid) {
  if (!txid) return false;
  const val = await redisCmd("GET", `pv:tx:${txid.toLowerCase()}`);
  return Boolean(val);
}

async function claimTx(txid, orderId) {
  // Store claimed TXID for 90 days to prevent replay across orders
  await redisCmd("SET", `pv:tx:${txid.toLowerCase()}`, orderId, "EX", 7776000);
}

module.exports = {
  saveOrder,
  getOrder,
  isTxClaimed,
  claimTx,
};
