// api/history.js
// GET /api/history?userId=... -> returns synced chat history (if Supabase is configured)

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Use GET" });
    return;
  }

  const { userId = "default" } = req.query || {};

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    res.status(200).json({ messages: [], synced: false });
    return;
  }

  try {
    const url = `${process.env.SUPABASE_URL}/rest/v1/messages?user_id=eq.${encodeURIComponent(
      userId
    )}&order=created_at.asc&limit=200`;
    const r = await fetch(url, {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      },
    });
    if (!r.ok) throw new Error(await r.text());
    const rows = await r.json();
    res.status(200).json({
      messages: rows.map((row) => ({ role: row.role, content: row.content })),
      synced: true,
    });
  } catch (e) {
    console.error("history.js error:", e);
    res.status(200).json({ messages: [], synced: false, error: e.message });
  }
};
