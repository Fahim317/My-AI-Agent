// api/cron-daily.js — Turjo Morning Briefing
// Runs once daily at 8 AM Dhaka time (2 AM UTC) via Vercel free cron.
// For each user with push subscriptions:
//   1. Fetches their pending tasks + reminders from Supabase
//   2. Calls Gemini to write a personalized Bangla/Banglish morning briefing
//   3. Sends it as a push notification

const webpush = require("web-push");

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return (req.headers.authorization || "") === `Bearer ${secret}`;
}

async function sbReq(path, options = {}) {
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
  if (!res.ok) { const t = await res.text(); throw new Error(`Supabase ${res.status}: ${t.slice(0, 200)}`); }
  return res.status === 204 ? null : res.json();
}

async function generateBriefing(tasks, reminders) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  const taskList = tasks.map(t => `- ${t.content}`).join("\n") || "কোনো task নেই";
  const reminderList = reminders.map(r => {
    const dhakaTime = r.remind_at
      ? new Date(new Date(r.remind_at).getTime() + 6 * 60 * 60 * 1000)
          .toISOString().replace("T", " ").slice(0, 16)
      : "";
    return `- ${r.content}${dhakaTime ? ` (${dhakaTime})` : ""}`;
  }).join("\n") || "কোনো reminder নেই";

  const prompt = `তুমি Turjo, Fahim-এর personal AI agent। আজকের সকালের briefing লেখো।

Pending tasks (${tasks.length}টা):
${taskList}

Today's reminders (${reminders.length}টা):
${reminderList}

Rules:
- Banglish-এ লেখো (romanized Bengali + English mix)
- 2-3 line max — notification-এ fit হতে হবে
- Warm but focused tone
- Start with "Good morning!" or "Shubho shokal!"
- Mention task/reminder count, most important ones
- End with one motivational word
- NEVER exceed 200 characters total (push notification limit)`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 150 },
        }),
      }
    );
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return text || null;
  } catch (e) {
    console.error("Gemini briefing error:", e.message);
    return null;
  }
}

module.exports = async (req, res) => {
  if (!authorized(req)) { res.status(401).json({ error: "Unauthorized" }); return; }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY ||
      !process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    res.status(200).json({ ok: false, error: "Missing env vars." });
    return;
  }

  webpush.setVapidDetails(
    "mailto:turjo@agent.app",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  try {
    // Get all unique users who have push subscriptions
    const subs = await sbReq("push_subscriptions?select=*", { method: "GET", prefer: "" });
    if (!subs?.length) {
      res.status(200).json({ ok: true, users: 0, notificationsSent: 0 });
      return;
    }

    // Group subscriptions by user_id
    const userMap = {};
    for (const sub of subs) {
      if (!userMap[sub.user_id]) userMap[sub.user_id] = [];
      userMap[sub.user_id].push(sub);
    }

    const nowIso = new Date().toISOString();
    let totalSent = 0;

    for (const [userId, userSubs] of Object.entries(userMap)) {
      try {
        // Fetch pending tasks
        const tasks = await sbReq(
          `notes?user_id=eq.${encodeURIComponent(userId)}&type=eq.task&order=created_at.desc&limit=10`,
          { method: "GET", prefer: "" }
        ) || [];

        // Fetch today's reminders (next 24 hours)
        const in24h = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        const reminders = await sbReq(
          `notes?user_id=eq.${encodeURIComponent(userId)}&type=eq.reminder&sent=eq.false&active=eq.true&remind_at=gte.${encodeURIComponent(nowIso)}&remind_at=lte.${encodeURIComponent(in24h)}&order=remind_at.asc&limit=5`,
          { method: "GET", prefer: "" }
        ) || [];

        // Generate AI briefing
        let body = "Shubho shokal! Turjo ekhane ache — bolo ki dorkar 😊";
        let title = "🌅 Good Morning";

        if (tasks.length > 0 || reminders.length > 0) {
          const aiText = await generateBriefing(tasks, reminders);
          if (aiText) body = aiText;
          else {
            const parts = [];
            if (tasks.length) parts.push(`${tasks.length}ta task pending`);
            if (reminders.length) parts.push(`${reminders.length}ta reminder aj`);
            body = `Shubho shokal! Aj tomar ${parts.join(", ")} ache. Chaliye jao! 💪`;
          }
          title = `🌅 Good Morning — ${tasks.length + reminders.length} ta item`;
        }

        const payload = JSON.stringify({ title, body });

        for (const sub of userSubs) {
          try {
            await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              payload
            );
            totalSent++;
          } catch (e) {
            if (e.statusCode === 404 || e.statusCode === 410) {
              await sbReq(`push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`,
                { method: "DELETE", prefer: "return=minimal" }
              ).catch(() => {});
            }
          }
        }
      } catch (e) {
        console.error(`Briefing failed for user ${userId}:`, e.message);
      }
    }

    res.status(200).json({ ok: true, users: Object.keys(userMap).length, notificationsSent: totalSent });
  } catch (e) {
    console.error("cron-daily error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
};
