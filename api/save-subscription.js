// api/save-subscription.js — Turjo v3.1 (upsert with fallback)

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    res.status(405).end(JSON.stringify({ ok: false, error: "Use POST" }));
    return;
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    res.status(200).end(JSON.stringify({ ok: false, error: "Supabase not configured." }));
    return;
  }

  try {
    const { userId = "default", subscription } = req.body || {};
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      res.status(400).end(JSON.stringify({ ok: false, error: "Invalid subscription object." }));
      return;
    }

    const sbBase = `${process.env.SUPABASE_URL}/rest/v1/push_subscriptions`;
    const headers = {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    };
    const rowData = {
      user_id: userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    };

    // Step 1: Try PATCH (update) on existing endpoint
    const patchRes = await fetch(
      `${sbBase}?endpoint=eq.${encodeURIComponent(subscription.endpoint)}`,
      {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({ user_id: userId, p256dh: rowData.p256dh, auth: rowData.auth }),
      }
    );

    // Check if PATCH updated any rows (Supabase returns Content-Range header)
    const contentRange = patchRes.headers.get("content-range") || "";
    const patchedCount = contentRange.startsWith("0") ? 0 : 1;

    if (patchRes.ok && patchedCount > 0) {
      // Updated existing subscription
      res.status(200).end(JSON.stringify({ ok: true, userId, action: "updated" }));
      return;
    }

    // Step 2: PATCH found nothing — INSERT new row
    const insertRes = await fetch(sbBase, {
      method: "POST",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify(rowData),
    });

    if (insertRes.ok || insertRes.status === 409) {
      // 409 = already exists (race condition) — still fine, subscription is saved
      res.status(200).end(JSON.stringify({ ok: true, userId, action: "saved" }));
      return;
    }

    const errText = await insertRes.text();
    throw new Error(`Insert ${insertRes.status}: ${errText.slice(0, 300)}`);
  } catch (e) {
    console.error("save-subscription error:", e.message);
    res.status(500).end(JSON.stringify({ ok: false, error: e.message }));
  }
};
