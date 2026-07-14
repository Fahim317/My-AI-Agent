// api/test-push.js
// GET /api/test-push?userId=XXXX
// Sends an immediate test push to all devices of that user.
// Used to verify the full push pipeline works.

const webpush = require("web-push");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    res.status(200).end(JSON.stringify({ ok: false, error: "Supabase not configured." }));
    return;
  }
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    res.status(200).end(JSON.stringify({ ok: false, error: "VAPID keys not configured." }));
    return;
  }

  webpush.setVapidDetails(
    "mailto:turjo@agent.app",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  const userId = req.query.userId || "PMNRAR";

  try {
    const sbUrl = `${process.env.SUPABASE_URL}/rest/v1/push_subscriptions?user_id=eq.${encodeURIComponent(userId)}`;
    const sbRes = await fetch(sbUrl, {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      },
    });
    const subs = await sbRes.json();

    if (!subs?.length) {
      res.status(200).end(JSON.stringify({ ok: false, error: `No subscriptions found for userId: ${userId}` }));
      return;
    }

    const payload = JSON.stringify({
      title: "⏰ Test Reminder",
      body: "Turjo notification pipeline kaj korche! Sound r vibration check koro.",
    });

    let sent = 0;
    const errors = [];

    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
        sent++;
      } catch (e) {
        errors.push(`${e.statusCode}: ${e.message}`);
        // Remove expired subscriptions
        if (e.statusCode === 404 || e.statusCode === 410) {
          await fetch(
            `${process.env.SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`,
            {
              method: "DELETE",
              headers: {
                apikey: process.env.SUPABASE_SERVICE_KEY,
                Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
                Prefer: "return=minimal",
              },
            }
          ).catch(() => {});
        }
      }
    }

    res.status(200).end(JSON.stringify({
      ok: sent > 0,
      userId,
      subscriptionsFound: subs.length,
      notificationsSent: sent,
      errors: errors.length ? errors : undefined,
    }));
  } catch (e) {
    res.status(500).end(JSON.stringify({ ok: false, error: e.message }));
  }
};
