// api/save-subscription.js — Turjo v3 (robust error handling)
// POST { userId, subscription: { endpoint, keys: { p256dh, auth } } }

module.exports = async (req, res) => {
  // Always set JSON header first — prevents empty response errors
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
    const body = req.body || {};
    const { userId = "default", subscription } = body;

    if (!subscription || !subscription.endpoint) {
      res.status(400).end(JSON.stringify({ ok: false, error: "Missing subscription.endpoint" }));
      return;
    }

    const p256dh = subscription.keys?.p256dh || "";
    const auth   = subscription.keys?.auth   || "";

    if (!p256dh || !auth) {
      res.status(400).end(JSON.stringify({ ok: false, error: "Missing subscription.keys (p256dh / auth)" }));
      return;
    }

    const sbUrl = `${process.env.SUPABASE_URL}/rest/v1/push_subscriptions`;

    // Try to delete existing row for this endpoint first (clean upsert without on_conflict issues)
    await fetch(`${sbUrl}?endpoint=eq.${encodeURIComponent(subscription.endpoint)}`, {
      method: "DELETE",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        Prefer: "return=minimal",
      },
    });

    // Now insert fresh
    const insertRes = await fetch(sbUrl, {
      method: "POST",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ user_id: userId, endpoint: subscription.endpoint, p256dh, auth }),
    });

    if (!insertRes.ok) {
      const errText = await insertRes.text();
      throw new Error(`Supabase insert ${insertRes.status}: ${errText.slice(0, 300)}`);
    }

    res.status(200).end(JSON.stringify({ ok: true, userId }));
  } catch (e) {
    console.error("save-subscription error:", e.message);
    res.status(500).end(JSON.stringify({ ok: false, error: e.message }));
  }
};
