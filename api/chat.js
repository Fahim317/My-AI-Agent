// api/chat.js — Turjo v2.1 (fixed reminder enforcement)

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const AGENT_NAME = "Turjo";

function buildSystemPrompt() {
  const now = new Date();
  const bdNow = new Date(now.getTime() + 6 * 60 * 60 * 1000);
  const bdNowStr = bdNow.toISOString().replace("T", " ").slice(0, 16) + " (Asia/Dhaka, UTC+6)";
  const utcNowStr = now.toISOString().replace("T", " ").slice(0, 16) + " UTC";

  return `You are ${AGENT_NAME}, Fahim's personal AI agent — sharp, fast, warm, a little witty, never robotic or stiff. Built to actually get things done.

Current time (IMPORTANT — use this for ALL time calculations):
- Dhaka time: ${bdNowStr}
- UTC time: ${utcNowStr}

Language rule: always reply in the SAME language the user used. Bangla → Bangla. Banglish → Banglish. English → English. Never switch.

TOOLS:
- web_search: use for any current/real-time info (prices, news, weather, "today", anything that could have changed).
- calculate: use for ANY math — never compute in your head, always call this tool.
- convert_currency: use for any currency conversion (supports BDT).
- save_note: saves notes, tasks, or reminders to database.
- get_notes: retrieves saved notes/tasks/reminders.
- send_email: sends email (only when user explicitly asks).

CRITICAL REMINDER RULES — read carefully:
1. When user asks to be reminded about ANYTHING at ANY future time → ALWAYS call save_note with type="reminder".
2. remind_at is ABSOLUTELY MANDATORY for every reminder. Without it the notification will NEVER fire.
3. Calculate remind_at in UTC using the UTC time shown above. Example: Dhaka 11:38 PM + 5 min = Dhaka 11:43 PM = UTC 5:43 PM = "2026-07-05T17:43:00.000Z"
4. NEVER say "ask me later", "let me know when", "tell me when you want", or ANY phrase that puts the reminder back on the user. Always set the exact time yourself.
5. NEVER skip remind_at. If user says "in 10 minutes" — calculate it. "Tomorrow morning" — use 8:00 AM Dhaka = 2:00 AM UTC. "Tonight" — use 9:00 PM Dhaka. Always make a reasonable assumption and confirm it.
6. After saving a reminder, always confirm: tell the user the exact Dhaka time they will be notified.

Keep replies concise and conversational unless depth is needed.`;
}

async function callTavily(query) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return "Web search isn't set up — add TAVILY_API_KEY in Vercel env vars.";
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: key, query, search_depth: "basic", max_results: 5, include_answer: true }),
    });
    const data = await res.json();
    if (!res.ok) return `Search failed: ${JSON.stringify(data).slice(0, 300)}`;
    let out = data.answer ? `Answer: ${data.answer}\n\n` : "";
    if (Array.isArray(data.results)) {
      out += data.results.slice(0, 5).map((r) => `- ${r.title}: ${(r.content || "").slice(0, 220)} (${r.url})`).join("\n");
    }
    return out || "No results found.";
  } catch (e) {
    return `Search error: ${e.message}`;
  }
}

function safeCalculate(expression) {
  const tokens = String(expression).match(/\d+(\.\d+)?|\+|-|\*|\/|\^|\(|\)|%/g);
  if (!tokens) throw new Error("Couldn't parse that expression.");
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  function parseExpr() {
    let v = parseTerm();
    while (peek() === "+" || peek() === "-") { const op = next(); const rhs = parseTerm(); v = op === "+" ? v + rhs : v - rhs; }
    return v;
  }
  function parseTerm() {
    let v = parsePow();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = next(); const rhs = parsePow();
      if ((op === "/" || op === "%") && rhs === 0) throw new Error("Division by zero.");
      v = op === "*" ? v * rhs : op === "/" ? v / rhs : v % rhs;
    }
    return v;
  }
  function parsePow() {
    let v = parseUnary();
    if (peek() === "^") { next(); v = Math.pow(v, parsePow()); }
    return v;
  }
  function parseUnary() { if (peek() === "-") { next(); return -parseUnary(); } return parseAtom(); }
  function parseAtom() {
    if (peek() === "(") { next(); const v = parseExpr(); if (peek() !== ")") throw new Error("Mismatched parentheses."); next(); return v; }
    const tok = next(); const n = parseFloat(tok);
    if (Number.isNaN(n)) throw new Error(`Unexpected token: ${tok}`);
    return n;
  }
  const result = parseExpr();
  if (pos !== tokens.length) throw new Error("Unexpected trailing characters.");
  if (!Number.isFinite(result)) throw new Error("Result is not finite.");
  return result;
}

async function convertCurrency(amount, from, to) {
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(from.toUpperCase())}`);
    const data = await res.json();
    if (data.result !== "success" || !data.rates || !(to.toUpperCase() in data.rates)) {
      return `Conversion failed for ${from}->${to}. Try web_search instead.`;
    }
    const converted = (amount * data.rates[to.toUpperCase()]).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
    return `${amount} ${from.toUpperCase()} = ${converted} ${to.toUpperCase()} (rate: ${data.time_last_update_utc})`;
  } catch (e) {
    return `Currency error: ${e.message}. Try web_search instead.`;
  }
}

async function sendEmail(to, subject, body) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return "Email not set up — add RESEND_API_KEY in Vercel env vars.";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "Agent <onboarding@resend.dev>", to: [to], subject, text: body }),
    });
    const data = await res.json();
    if (!res.ok) return `Email failed: ${JSON.stringify(data).slice(0, 300)}`;
    return `Email sent to ${to}.`;
  } catch (e) {
    return `Email error: ${e.message}`;
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
  if (!res.ok) { const text = await res.text(); throw new Error(`Supabase ${res.status}: ${text.slice(0, 300)}`); }
  return res.status === 204 ? null : res.json();
}

async function saveNote(userId, type, content, remindAt) {
  if (!supabaseReady()) return "Memory storage not set up — add SUPABASE_URL and SUPABASE_SERVICE_KEY in Vercel env vars.";
  try {
    // Server-side guard: if type is reminder but no remindAt, auto-set to 5 min from now
    if (type === "reminder" && !remindAt) {
      remindAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    }
    const row = { user_id: userId, type: type || "note", content };
    if (type === "reminder" && remindAt) row.remind_at = remindAt;
    await supabaseRequest("notes", { method: "POST", body: JSON.stringify(row) });
    if (type === "reminder" && remindAt) {
      // Convert UTC back to Dhaka time for user-facing confirmation
      const dhakaTime = new Date(new Date(remindAt).getTime() + 6 * 60 * 60 * 1000)
        .toISOString().replace("T", " ").slice(0, 16);
      return `Reminder saved. Will notify at ${dhakaTime} Dhaka time. Notifications must be enabled in ⚙ Settings.`;
    }
    return `Saved as a ${type || "note"}.`;
  } catch (e) {
    return `Couldn't save: ${e.message}`;
  }
}

async function getNotes(userId) {
  if (!supabaseReady()) return "Memory storage not set up — add SUPABASE_URL and SUPABASE_SERVICE_KEY in Vercel env vars.";
  try {
    const rows = await supabaseRequest(
      `notes?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=25`,
      { method: "GET", prefer: "" }
    );
    if (!rows || rows.length === 0) return "No saved notes yet.";
    return rows.map((r) => {
      let line = `[${r.type}] ${r.content}`;
      if (r.remind_at) {
        const dhakaTime = new Date(new Date(r.remind_at).getTime() + 6 * 60 * 60 * 1000)
          .toISOString().replace("T", " ").slice(0, 16);
        line += ` (remind: ${dhakaTime} Dhaka, sent: ${r.sent ? "yes" : "pending"})`;
      }
      return line;
    }).join("\n");
  } catch (e) {
    return `Couldn't fetch notes: ${e.message}`;
  }
}

async function logMessage(userId, role, content) {
  if (!supabaseReady()) return;
  try {
    await supabaseRequest("messages", {
      method: "POST", prefer: "return=minimal",
      body: JSON.stringify({ user_id: userId, role, content }),
    });
  } catch (e) { console.error("logMessage failed:", e.message); }
}

function buildTools() {
  const declarations = [
    {
      name: "web_search",
      description: "Search the live web for current information.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
    {
      name: "calculate",
      description: "Evaluate an exact arithmetic expression (+ - * / ^ % and parentheses). Always use this for math.",
      parameters: { type: "object", properties: { expression: { type: "string", description: "e.g. (120*3.5)/2" } }, required: ["expression"] },
    },
    {
      name: "convert_currency",
      description: "Convert currency using live rates. Supports BDT.",
      parameters: {
        type: "object",
        properties: {
          amount: { type: "number" },
          from: { type: "string", description: "3-letter code e.g. USD" },
          to: { type: "string", description: "3-letter code e.g. BDT" },
        },
        required: ["amount", "from", "to"],
      },
    },
  ];

  if (supabaseReady()) {
    declarations.push(
      {
        name: "save_note",
        description: "Save a note, task, or reminder. For reminders: remind_at is REQUIRED — compute it from current UTC time in system prompt. NEVER omit remind_at for reminders.",
        parameters: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["note", "task", "reminder"], description: "Use 'reminder' whenever user wants to be notified at a future time." },
            content: { type: "string", description: "What to remember or be reminded about." },
            remind_at: { type: "string", description: "REQUIRED for reminders. ISO 8601 UTC datetime e.g. '2026-07-05T17:43:00.000Z'. Calculate from current UTC time in system prompt." },
          },
          required: ["type", "content"],
        },
      },
      {
        name: "get_notes",
        description: "Retrieve all saved notes, tasks, and reminders.",
        parameters: { type: "object", properties: {} },
      }
    );
  }

  if (process.env.RESEND_API_KEY) {
    declarations.push({
      name: "send_email",
      description: "Send an email (free tier: only to your own signup address).",
      parameters: {
        type: "object",
        properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } },
        required: ["to", "subject", "body"],
      },
    });
  }

  return [{ functionDeclarations: declarations }];
}

async function callGemini(contents, tools, attempt = 0) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set in Vercel environment variables.");
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: buildSystemPrompt() }] },
      contents,
      tools,
      generationConfig: { temperature: 0.7 },
    }),
  });
  if (res.status === 429 && attempt < 2) {
    await new Promise((r) => setTimeout(r, 1500 * Math.pow(2, attempt)));
    return callGemini(contents, tools, attempt + 1);
  }
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 429) throw new Error("Free plan-er request limit full — 30 sec wait kore try koro.");
    throw new Error(`Gemini ${res.status}: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return data;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "Use POST" }); return; }
  try {
    const { message, history = [], userId = "default" } = req.body || {};
    if (!message || typeof message !== "string") { res.status(400).json({ error: "Missing message." }); return; }

    const tools = buildTools();
    const contents = history
      .filter((m) => m && m.content)
      .map((m) => ({ role: m.role === "model" ? "model" : "user", parts: [{ text: m.content }] }));
    contents.push({ role: "user", parts: [{ text: message }] });

    const used = [];
    let data = await callGemini(contents, tools);
    let loopCount = 0;

    while (loopCount < 5) {
      const candidate = data.candidates && data.candidates[0];
      const parts = candidate?.content?.parts || [];
      const functionCallPart = parts.find((p) => p.functionCall);
      if (!functionCallPart) break;

      const { name, args } = functionCallPart.functionCall;
      used.push(name);
      let result;
      if (name === "web_search") result = await callTavily(args.query);
      else if (name === "calculate") { try { result = String(safeCalculate(args.expression)); } catch (e) { result = `Calculation error: ${e.message}`; } }
      else if (name === "convert_currency") result = await convertCurrency(args.amount, args.from, args.to);
      else if (name === "save_note") result = await saveNote(userId, args.type, args.content, args.remind_at);
      else if (name === "get_notes") result = await getNotes(userId);
      else if (name === "send_email") result = await sendEmail(args.to, args.subject, args.body);
      else result = `Unknown tool: ${name}`;

      contents.push({ role: "model", parts: [{ functionCall: { name, args } }] });
      contents.push({ role: "function", parts: [{ functionResponse: { name, response: { result } } }] });
      data = await callGemini(contents, tools);
      loopCount += 1;
    }

    const finalParts = data.candidates?.[0]?.content?.parts || [];
    const reply = finalParts.map((p) => p.text || "").join("").trim() || "(No reply generated.)";
    await logMessage(userId, "user", message);
    await logMessage(userId, "model", reply);
    res.status(200).json({ reply, used });
  } catch (e) {
    console.error("chat.js error:", e);
    res.status(500).json({ error: e.message || "Unknown server error" });
  }
};
