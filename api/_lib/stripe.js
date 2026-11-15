const crypto = require("crypto");

function getStripeKey() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY env var.");
  return key;
}

async function stripeRequest(path, params = null) {
  const key = getStripeKey();
  const headers = { Authorization: `Bearer ${key}` };
  let method = "GET";
  let body;

  if (params !== null) {
    method = "POST";
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(params).toString();
  }

  const res = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers,
    body,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `Stripe API error (${res.status})`);
  }
  return data;
}

async function createCheckoutSession({ order, items, discountRate, baseUsd, email }) {
  const titleSummary =
    items.length === 1
      ? items[0].title
      : `${items.length} Courses Bundle${discountRate > 0 ? ` (${Math.round(discountRate * 100)}% OFF)` : ""}`;
  const desc = items.map((p) => p.title).join(" + ").slice(0, 450);

  const params = {
    mode: "payment",
    customer_email: email,
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(Math.round(baseUsd * 100)),
    "line_items[0][price_data][product_data][name]": titleSummary,
    "line_items[0][price_data][product_data][description]": desc,
    "line_items[0][quantity]": "1",
    "metadata[orderId]": order.id,
    "payment_intent_data[metadata][orderId]": order.id,
    success_url: `https://pokervault.eu/?pay=${encodeURIComponent(order.id)}&stripe_session={CHECKOUT_SESSION_ID}`,
    cancel_url: "https://pokervault.eu/",
  };

  return stripeRequest("/v1/checkout/sessions", params);
}

async function retrieveCheckoutSession(sessionId) {
  if (!sessionId) return null;
  return stripeRequest(`/v1/checkout/sessions/${encodeURIComponent(sessionId)}`);
}

function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader || !secret) return false;
  const parts = {};
  for (const item of String(sigHeader).split(",")) {
    const [k, v] = item.split("=");
    if (k && v) {
      if (!parts[k]) parts[k] = [];
      parts[k].push(v);
    }
  }
  const timestamp = parts.t?.[0];
  const signatures = parts.v1 || [];
  if (!timestamp || !signatures.length) return false;

  const ageSec = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(ageSec) || ageSec > 300) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");

  const expectedBuf = Buffer.from(expected, "hex");
  return signatures.some((sig) => {
    try {
      const sigBuf = Buffer.from(sig, "hex");
      return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
    } catch {
      return false;
    }
  });
}

module.exports = {
  createCheckoutSession,
  retrieveCheckoutSession,
  verifyStripeSignature,
};
