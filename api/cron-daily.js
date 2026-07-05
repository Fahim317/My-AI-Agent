// api/cron-daily.js
// Triggered once a day by Vercel's own free cron (configured in vercel.json).
// Sends a short proactive "good morning" push to every device with notifications enabled.

const webpush = require("web-push");

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.authorization || "";
  return header === `Bearer ${secret}`;
}

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
  if (!authorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY || !process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    res.status(200).json({ ok: false, error: "Supabase or VAPID not fully configured." });
    return;
  }

  webpush.setVapidDetails("mailto:agent@example.com", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

  try {
    const subs = await supabaseRequest("push_subscriptions?select=*", { method: "GET", prefer: "" });
    const payload = JSON.stringify({
      title: "Good morning",
      body: "Ready when you are — ask me anything or check what's on your list today.",
    });

    let sentCount = 0;
    for (const sub of subs || []) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
        sentCount += 1;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          await supabaseRequest(`push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, {
            method: "DELETE",
            prefer: "return=minimal",
          }).catch(() => {});
        }
      }
    }

    res.status(200).json({ ok: true, notificationsSent: sentCount });
  } catch (e) {
    console.error("cron-daily error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
};
