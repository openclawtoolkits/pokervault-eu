const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || "PokerVault <orders@pokervault.eu>";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "cngfin@gmail.com";
const SITE_URL = process.env.SITE_URL || "https://pokervault.eu";

function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendEmail({ to, subject, html, replyTo }) {
  if (!RESEND_API_KEY) {
    console.warn("RESEND_API_KEY not configured; skipping email to", to);
    return { skipped: true };
  }
  const payload = {
    from: FROM_EMAIL,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
  };
  if (replyTo) payload.reply_to = replyTo;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Resend API error (${res.status}): ${errText}`);
  }
  return res.json();
}

function wrapLayout(title, bodyHtml) {
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;background:#0a0a0c;color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#13131a;border:1px solid #2a2a3a;border-radius:16px;padding:28px;">
    <div style="font-size:12px;letter-spacing:1.2px;text-transform:uppercase;color:#10b981;font-weight:700;margin-bottom:8px;">POKERVAULT.EU</div>
    <h1 style="margin:0 0 16px;font-size:22px;color:#ffffff;">${esc(title)}</h1>
    ${bodyHtml}
    <hr style="border:none;border-top:1px solid #262636;margin:24px 0;" />
    <p style="margin:0;font-size:12px;color:#94a3b8;">Need help? Reply to this email with your Order ID.</p>
  </div>
</body>
</html>`;
}

async function sendOrderConfirmedEmail(order, instantItems, pendingItems) {
  const instantHtml = instantItems.length
    ? `<div style="margin:18px 0;padding:16px;background:#0f241d;border:1px solid #10b981;border-radius:12px;">
        <div style="font-weight:700;color:#34d399;margin-bottom:10px;">Instant Google Drive Access Ready</div>
        ${instantItems
          .map(
            (c) =>
              `<div style="margin-bottom:10px;">
                <div style="font-weight:600;color:#fff;">${esc(c.title)}</div>
                <a href="${esc(c.driveUrl)}" style="display:inline-block;margin-top:4px;padding:8px 14px;background:#10b981;color:#052e16;text-decoration:none;border-radius:8px;font-weight:700;font-size:13px;">Open Google Drive Folder →</a>
              </div>`
          )
          .join("")}
      </div>`
    : "";

  const pendingHtml = pendingItems.length
    ? `<div style="margin:18px 0;padding:16px;background:#1a1b2e;border:1px solid #6366f1;border-radius:12px;">
        <div style="font-weight:700;color:#a5b4fc;margin-bottom:8px;">Preparing Google Drive Folder Share</div>
        <p style="margin:0 0 10px;font-size:14px;color:#cbd5e1;">We have received your payment and are preparing your Google Drive access for:</p>
        <ul style="margin:0;padding-left:18px;color:#f8fafc;font-size:14px;">
          ${pendingItems.map((c) => `<li style="margin-bottom:4px;">${esc(c.title)}</li>`).join("")}
        </ul>
        <p style="margin:10px 0 0;font-size:13px;color:#94a3b8;">You will receive the Google Drive share invite/link at <strong>${esc(order.email)}</strong> as soon as it is ready.</p>
      </div>`
    : "";

  const txList = (order.txs || []).map((t) => `<li><code>${esc(t.txid)}</code> (${esc(t.amountAsset)} ${esc(order.symbol)})</li>`).join("");

  const html = wrapLayout(
    "Order Confirmed — Thank You!",
    `<p style="color:#cbd5e1;font-size:15px;line-height:1.5;">Your crypto payment for Order <strong>${esc(order.id)}</strong> has been verified on-chain.</p>
     <div style="background:#0c0c12;border:1px solid #242434;border-radius:10px;padding:14px;font-size:14px;color:#cbd5e1;">
       <div><strong>Order ID:</strong> ${esc(order.id)}</div>
       <div><strong>Total Paid:</strong> $${Number(order.paidUsd || 0).toFixed(2)} (${esc(order.networkLabel)})</div>
       <div style="margin-top:6px;"><strong>Transaction(s):</strong><ul style="margin:4px 0 0;padding-left:18px;">${txList}</ul></div>
     </div>
     ${instantHtml}
     ${pendingHtml}`
  );

  return sendEmail({
    to: order.email,
    subject: `Order Confirmed (${order.id}) — PokerVault.eu`,
    html,
    replyTo: ADMIN_EMAIL,
  });
}

async function sendAdminFulfillmentEmail(order, instantItems, pendingItems) {
  const statusTag = pendingItems.length ? "ACTION NEEDED: Share Google Drive" : "Auto-Delivered";
  const html = wrapLayout(
    `${statusTag} — ${order.id}`,
    `<p style="color:#cbd5e1;font-size:14px;">New paid order received on <strong>pokervault.eu</strong>.</p>
     <div style="background:#0c0c12;border:1px solid #242434;border-radius:10px;padding:14px;font-size:14px;color:#cbd5e1;">
       <div><strong>Buyer Email:</strong> ${esc(order.email)}</div>
       <div><strong>Order ID:</strong> ${esc(order.id)}</div>
       <div><strong>Network:</strong> ${esc(order.networkLabel)}</div>
       <div><strong>Paid:</strong> $${Number(order.paidUsd || 0).toFixed(2)} (Expected $${Number(order.totalUsd || 0).toFixed(2)})</div>
       <div><strong>TXIDs:</strong> ${(order.txs || []).map((t) => esc(t.txid)).join(", ")}</div>
     </div>
     ${
       pendingItems.length
         ? `<h3 style="color:#f59e0b;margin:18px 0 8px;">Courses to Share via Google Drive (${pendingItems.length}):</h3>
            <ul style="color:#fff;font-size:14px;">${pendingItems.map((c) => `<li><strong>#${esc(c.id)}</strong> — ${esc(c.title)}</li>`).join("")}</ul>`
         : ""
     }
     ${
       instantItems.length
         ? `<h3 style="color:#34d399;margin:18px 0 8px;">Already Auto-Delivered (${instantItems.length}):</h3>
            <ul style="color:#94a3b8;font-size:13px;">${instantItems.map((c) => `<li>${esc(c.title)}</li>`).join("")}</ul>`
         : ""
     }`
  );

  return sendEmail({
    to: ADMIN_EMAIL,
    subject: `[PokerVault] ${statusTag} — ${order.id} ($${Number(order.paidUsd || 0).toFixed(2)})`,
    html,
    replyTo: order.email,
  });
}

async function sendShortfallEmail(order, newlyPaidUsd, remainingUsd, remainingAsset) {
  const payUrl = `${SITE_URL}/?pay=${encodeURIComponent(order.id)}`;
  const html = wrapLayout(
    "Partial Payment Received — Complete Remaining Balance",
    `<p style="color:#cbd5e1;font-size:15px;line-height:1.5;">
       We received a payment of <strong>$${Number(newlyPaidUsd).toFixed(2)}</strong> for Order <strong>${esc(order.id)}</strong>,
       which is slightly short of the order total (<strong>$${Number(order.totalUsd).toFixed(2)}</strong>) — often due to an exchange withdrawal fee.
     </p>
     <div style="background:#1c1610;border:1px solid #f59e0b;border-radius:12px;padding:16px;margin:16px 0;">
       <div style="font-size:14px;color:#fde68a;"><strong>Total Paid So Far:</strong> $${Number(order.paidUsd || 0).toFixed(2)}</div>
       <div style="font-size:18px;font-weight:800;color:#fbbf24;margin-top:6px;">Remaining Balance: $${Number(remainingUsd).toFixed(2)} (~${esc(remainingAsset)} ${esc(order.symbol)})</div>
     </div>
     <p style="margin:18px 0;">
       <a href="${esc(payUrl)}" style="display:inline-block;padding:12px 20px;background:#10b981;color:#052e16;text-decoration:none;border-radius:10px;font-weight:700;font-size:15px;">Complete Remaining Payment →</a>
     </p>
     <p style="font-size:13px;color:#94a3b8;">Or copy this link: <a href="${esc(payUrl)}" style="color:#38bdf8;">${esc(payUrl)}</a></p>`
  );

  return sendEmail({
    to: order.email,
    subject: `Action Needed: $${Number(remainingUsd).toFixed(2)} Remaining for Order ${order.id}`,
    html,
    replyTo: ADMIN_EMAIL,
  });
}

module.exports = {
  sendOrderConfirmedEmail,
  sendAdminFulfillmentEmail,
  sendShortfallEmail,
};
