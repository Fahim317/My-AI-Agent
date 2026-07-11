// api/debug.js
// GET /api/debug?userId=XXXX — shows pending reminders + subscriptions for a user.
// Delete this file after debugging is done.

async function supabaseRequest(path, options = {}) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation",
    },
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Supabase ${res.status}: ${t.slice(0, 200)}`); }
  return res.status === 204 ? null : res.json();
}

module.exports = async (req, res) => {
  const userId = req.query.userId || "PMNRAR"; // default to your sync code

  try {
    const now = new Date().toISOString();

    // All reminders for this user
    const allReminders = await supabaseRequest(
      `notes?user_id=eq.${encodeURIComponent(userId)}&type=eq.reminder&order=created_at.desc&limit=10`,
      { method: "GET", prefer: "" }
    );

    // Due but not sent
    const dueReminders = await supabaseRequest(
      `notes?user_id=eq.${encodeURIComponent(userId)}&type=eq.reminder&sent=eq.false&remind_at=lte.${encodeURIComponent(now)}&order=remind_at.asc`,
      { method: "GET", prefer: "" }
    );

    // Subscriptions for this user
    const subs = await supabaseRequest(
      `push_subscriptions?user_id=eq.${encodeURIComponent(userId)}`,
      { method: "GET", prefer: "" }
    );

    res.status(200).json({
      serverTimeUTC: now,
      userId,
      subscriptions: (subs || []).length,
      allReminders: (allReminders || []).map(r => ({
        id: r.id,
        content: r.content,
        remind_at: r.remind_at,
        sent: r.sent,
        created_at: r.created_at,
      })),
      dueNow: (dueReminders || []).length,
      dueReminders: (dueReminders || []).map(r => ({
        id: r.id,
        content: r.content,
        remind_at: r.remind_at,
      })),
      diagnosis: {
        supabaseConnected: true,
        hasSubscriptions: (subs || []).length > 0,
        hasRemindersWithTime: (allReminders || []).some(r => r.remind_at !== null),
        hasDueReminders: (dueReminders || []).length > 0,
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message, supabaseConnected: false });
  }
};
