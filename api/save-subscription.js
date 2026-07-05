// api/save-subscription.js
// POST { userId, subscription: { endpoint, keys: { p256dh, auth } } }
// Saves (or updates) a push subscription so this device can receive notifications.

async function supabaseRequest(path, options = {}) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST" });
    return;
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    res.status(200).json({ ok: false, error: "Supabase not configured — notifications need SUPABASE_URL and SUPABASE_SERVICE_KEY set." });
    return;
  }

  try {
    const { userId = "default", subscription } = req.body || {};
    if (!subscription || !subscription.endpoint || !subscription.keys) {
      res.status(400).json({ error: "Missing subscription object." });
      return;
    }

    // Upsert on endpoint: re-subscribing (e.g. after reinstall) just updates the same row.
    await supabaseRequest("push_subscriptions?on_conflict=endpoint", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: JSON.stringify({
        user_id: userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      }),
    });

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("save-subscription error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
};
