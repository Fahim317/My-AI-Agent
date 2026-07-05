// api/cron-reminders.js
// Triggered on a schedule (recommended: an external free pinger like cron-job.org,
// every 5-15 min, since Vercel's own free cron only allows once/day — see README).
// Finds due reminders in Supabase and pushes a notification to every device the
// user has enabled notifications on.

const webpush = require("web-push");

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // not configured -> no auth check (fine for personal use, but less safe)
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

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    res.status(200).json({ ok: false, error: "Supabase not configured." });
    return;
  }
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    res.status(200).json({ ok: false, error: "VAPID keys not configured." });
    return;
  }

  webpush.setVapidDetails("mailto:agent@example.com", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

  try {
    const nowIso = new Date().toISOString();
    const due = await supabaseRequest(
      `notes?type=eq.reminder&sent=eq.false&remind_at=lte.${encodeURIComponent(nowIso)}&order=remind_at.asc&limit=50`,
      { method: "GET", prefer: "" }
    );

    if (!due || due.length === 0) {
      res.status(200).json({ ok: true, sent: 0 });
      return;
    }

    let sentCount = 0;
    for (const reminder of due) {
      const subs = await supabaseRequest(
        `push_subscriptions?user_id=eq.${encodeURIComponent(reminder.user_id)}`,
        { method: "GET", prefer: "" }
      );

      const payload = JSON.stringify({ title: "Reminder", body: reminder.content });

      for (const sub of subs || []) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload
          );
          sentCount += 1;
        } catch (e) {
          // Subscription likely expired/revoked — remove it so we stop retrying it forever.
          if (e.statusCode === 404 || e.statusCode === 410) {
            await supabaseRequest(`push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, {
              method: "DELETE",
              prefer: "return=minimal",
            }).catch(() => {});
          } else {
            console.error("push send failed:", e.message);
          }
        }
      }

      // Mark sent regardless of per-device outcome, so it doesn't repeat forever on a hard failure.
      await supabaseRequest(`notes?id=eq.${reminder.id}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: JSON.stringify({ sent: true }),
      });
    }

    res.status(200).json({ ok: true, reminders: due.length, notificationsSent: sentCount });
  } catch (e) {
    console.error("cron-reminders error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
};
