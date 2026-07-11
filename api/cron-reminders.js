// api/cron-reminders.js — Turjo v3
// Handles both one-time and recurring reminders.
// Triggered every 5 min by cron-job.org

const webpush = require("web-push");

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return (req.headers.authorization || "") === `Bearer ${secret}`;
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
  if (!res.ok) { const t = await res.text(); throw new Error(`Supabase ${res.status}: ${t.slice(0, 300)}`); }
  return res.status === 204 ? null : res.json();
}

// Calculate next occurrence for recurring reminders
function nextOccurrence(remindAt, recurrence) {
  const d = new Date(remindAt);
  switch (recurrence) {
    case "daily":
      return new Date(d.getTime() + 24 * 60 * 60 * 1000).toISOString();
    case "weekly":
      return new Date(d.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    case "weekdays": {
      let next = new Date(d.getTime() + 24 * 60 * 60 * 1000);
      // Skip Saturday (6) and Sunday (0)
      while (next.getUTCDay() === 0 || next.getUTCDay() === 6) {
        next = new Date(next.getTime() + 24 * 60 * 60 * 1000);
      }
      return next.toISOString();
    }
    case "monthly": {
      const next = new Date(d);
      next.setUTCMonth(next.getUTCMonth() + 1);
      return next.toISOString();
    }
    default:
      return null;
  }
}

module.exports = async (req, res) => {
  if (!authorized(req)) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    res.status(200).json({ ok: false, error: "Supabase not configured." }); return;
  }
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    res.status(200).json({ ok: false, error: "VAPID keys not configured." }); return;
  }

  webpush.setVapidDetails(
    "mailto:turjo@agent.app",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  try {
    const nowIso = new Date().toISOString();

    // Fetch due reminders: active + not sent + remind_at is past
    const due = await supabaseRequest(
      `notes?type=eq.reminder&sent=eq.false&active=eq.true&remind_at=lte.${encodeURIComponent(nowIso)}&order=remind_at.asc&limit=50`,
      { method: "GET", prefer: "" }
    );

    if (!due || due.length === 0) {
      res.status(200).json({ ok: true, reminders: 0, notificationsSent: 0 });
      return;
    }

    let sentCount = 0;

    for (const reminder of due) {
      // Get all push subscriptions for this user
      const subs = await supabaseRequest(
        `push_subscriptions?user_id=eq.${encodeURIComponent(reminder.user_id)}`,
        { method: "GET", prefer: "" }
      );

      const isRecurring = Boolean(reminder.recurrence);
      const label = isRecurring ? `🔁 ${reminder.recurrence}` : "⏰";
      const payload = JSON.stringify({
        title: `${label} Reminder`,
        body: reminder.content,
      });

      for (const sub of subs || []) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload
          );
          sentCount += 1;
        } catch (e) {
          if (e.statusCode === 404 || e.statusCode === 410) {
            // Subscription expired — remove it
            await supabaseRequest(
              `push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`,
              { method: "DELETE", prefer: "return=minimal" }
            ).catch(() => {});
          } else {
            console.error("push failed:", e.statusCode, e.message);
          }
        }
      }

      if (isRecurring) {
        // Recurring: schedule next occurrence, reset sent=false
        const next = nextOccurrence(reminder.remind_at, reminder.recurrence);
        if (next) {
          await supabaseRequest(`notes?id=eq.${reminder.id}`, {
            method: "PATCH",
            prefer: "return=minimal",
            body: JSON.stringify({ remind_at: next, sent: false }),
          });
        } else {
          // Unknown recurrence type — just mark sent
          await supabaseRequest(`notes?id=eq.${reminder.id}`, {
            method: "PATCH", prefer: "return=minimal",
            body: JSON.stringify({ sent: true }),
          });
        }
      } else {
        // One-time: mark as sent permanently
        await supabaseRequest(`notes?id=eq.${reminder.id}`, {
          method: "PATCH", prefer: "return=minimal",
          body: JSON.stringify({ sent: true }),
        });
      }
    }

    res.status(200).json({ ok: true, reminders: due.length, notificationsSent: sentCount });
  } catch (e) {
    console.error("cron-reminders error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
};
