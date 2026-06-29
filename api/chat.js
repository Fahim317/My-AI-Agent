// api/chat.js
// Vercel serverless function — the agent's brain + hands.
// POST { message: string, history: [{role,content}], userId: string }
// Returns { reply: string, used: string[] }

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const SYSTEM_PROMPT = `You are Fahim's personal AI agent — sharp, fast, friendly, a little witty, never robotic or stiff.

Language rule: always reply in the same language/script the user just used. If they write in Bangla script, reply in Bangla script. If they write in Banglish (romanized Bengali mixed with English), reply the same casual way. If English, reply in English. Never force a language switch on them.

Tools:
- Use web_search whenever the answer depends on current/real-time information (prices, news, dates, scores, "today", anything you're not certain is still true).
- Use save_note when the user wants something remembered — a task, reminder, or idea. Pick type: "task", "reminder", or "note".
- Use get_notes when they ask what they've saved, or to recall something.
- If a tool isn't available (not configured by the user yet), say so plainly instead of pretending you did it.
- After a tool call returns, answer in your own words — don't just dump raw data.

Keep replies concise and conversational unless the user clearly wants depth.`;

async function callTavily(query) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return "Web search isn't set up yet — add TAVILY_API_KEY in Vercel env vars.";
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: "basic",
        max_results: 5,
        include_answer: true,
      }),
    });
    const data = await res.json();
    if (!res.ok) return `Search failed: ${JSON.stringify(data).slice(0, 300)}`;
    let out = data.answer ? `Answer: ${data.answer}\n\n` : "";
    if (Array.isArray(data.results)) {
      out += data.results
        .slice(0, 5)
        .map((r) => `- ${r.title}: ${(r.content || "").slice(0, 220)} (${r.url})`)
        .join("\n");
    }
    return out || "No results found.";
  } catch (e) {
    return `Search error: ${e.message}`;
  }
}

function supabaseReady() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
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

async function saveNote(userId, type, content) {
  if (!supabaseReady()) return "Memory storage isn't set up yet — add SUPABASE_URL and SUPABASE_SERVICE_KEY in Vercel env vars.";
  try {
    await supabaseRequest("notes", {
      method: "POST",
      body: JSON.stringify({ user_id: userId, type: type || "note", content }),
    });
    return `Saved as a ${type || "note"}.`;
  } catch (e) {
    return `Couldn't save: ${e.message}`;
  }
}

async function getNotes(userId) {
  if (!supabaseReady()) return "Memory storage isn't set up yet — add SUPABASE_URL and SUPABASE_SERVICE_KEY in Vercel env vars.";
  try {
    const rows = await supabaseRequest(
      `notes?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=25`,
      { method: "GET", prefer: "" }
    );
    if (!rows || rows.length === 0) return "No saved notes yet.";
    return rows.map((r) => `[${r.type}] ${r.content} (${new Date(r.created_at).toLocaleString()})`).join("\n");
  } catch (e) {
    return `Couldn't fetch notes: ${e.message}`;
  }
}

async function logMessage(userId, role, content) {
  if (!supabaseReady()) return;
  try {
    await supabaseRequest("messages", {
      method: "POST",
      prefer: "return=minimal",
      body: JSON.stringify({ user_id: userId, role, content }),
    });
  } catch (e) {
    // Non-fatal — chat still works without history persistence.
    console.error("logMessage failed:", e.message);
  }
}

const TOOLS = [
  {
    functionDeclarations: [
      {
        name: "web_search",
        description: "Search the live web for current information.",
        parameters: {
          type: "object",
          properties: { query: { type: "string", description: "What to search for" } },
          required: ["query"],
        },
      },
      ...(supabaseReady()
        ? [
            {
              name: "save_note",
              description: "Save a note, task, or reminder for later recall.",
              parameters: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["note", "task", "reminder"] },
                  content: { type: "string", description: "What to remember" },
                },
                required: ["content"],
              },
            },
            {
              name: "get_notes",
              description: "Retrieve previously saved notes, tasks, and reminders.",
              parameters: { type: "object", properties: {} },
            },
          ]
        : []),
    ],
  },
];

async function callGemini(contents) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set in Vercel environment variables.");
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents,
      tools: TOOLS,
      generationConfig: { temperature: 0.7 },
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Gemini ${res.status}: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return data;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST" });
    return;
  }

  try {
    const { message, history = [], userId = "default" } = req.body || {};
    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "Missing 'message' string in body." });
      return;
    }

    // Build Gemini-format contents from prior turns + new message.
    const contents = history
      .filter((m) => m && m.content)
      .map((m) => ({ role: m.role === "model" ? "model" : "user", parts: [{ text: m.content }] }));
    contents.push({ role: "user", parts: [{ text: message }] });

    const used = [];
    let data = await callGemini(contents);
    let loopCount = 0;

    // Agent loop: keep resolving tool calls until the model gives a plain text answer.
    while (loopCount < 5) {
      const candidate = data.candidates && data.candidates[0];
      const parts = candidate?.content?.parts || [];
      const functionCallPart = parts.find((p) => p.functionCall);

      if (!functionCallPart) break;

      const { name, args } = functionCallPart.functionCall;
      used.push(name);
      let result;
      if (name === "web_search") result = await callTavily(args.query);
      else if (name === "save_note") result = await saveNote(userId, args.type, args.content);
      else if (name === "get_notes") result = await getNotes(userId);
      else result = `Unknown tool: ${name}`;

      contents.push({ role: "model", parts: [{ functionCall: { name, args } }] });
      contents.push({ role: "function", parts: [{ functionResponse: { name, response: { result } } }] });

      data = await callGemini(contents);
      loopCount += 1;
    }

    const finalCandidate = data.candidates && data.candidates[0];
    const finalParts = finalCandidate?.content?.parts || [];
    const reply = finalParts.map((p) => p.text || "").join("").trim() || "(No reply generated.)";

    // Persist this exchange for cross-device memory (no-op if Supabase isn't configured).
    await logMessage(userId, "user", message);
    await logMessage(userId, "model", reply);

    res.status(200).json({ reply, used });
  } catch (e) {
    console.error("chat.js error:", e);
    res.status(500).json({ error: e.message || "Unknown server error" });
  }
};
