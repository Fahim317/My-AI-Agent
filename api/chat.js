// api/chat.js
// Vercel serverless function — the agent's brain + hands.
// POST { message: string, history: [{role,content}], userId: string }
// Returns { reply: string, used: string[] }

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const AGENT_NAME = "Turjo"; // change this one line to rename your agent

function buildSystemPrompt() {
  const now = new Date();
  // Fahim is in Dhaka (UTC+6) — give the model real wall-clock context for that timezone
  // so it can correctly resolve "tomorrow 5pm", "tonight", etc. into exact UTC instants.
  const bdNow = new Date(now.getTime() + 6 * 60 * 60 * 1000);
  const bdNowStr = bdNow.toISOString().replace("T", " ").slice(0, 16) + " (Asia/Dhaka, UTC+6)";

  return `You are ${AGENT_NAME}, Fahim's personal AI agent — sharp, fast, warm, a little witty, never robotic or stiff. You're built to feel like a capable assistant who actually gets things done, not just a chatbot.

Current date/time: ${bdNowStr}. Use this to resolve relative times ("tomorrow", "tonight", "in an hour") into exact moments. Assume the user means Asia/Dhaka time unless they say otherwise.

Language rule: always reply in the same language/script the user just used. Bangla script in -> Bangla script out. Banglish in -> Banglish out. English in -> English out. Never force a language switch.

Tools available to you:
- web_search: use whenever the answer depends on current/real-time info (prices, news, "today", anything not certain to still be true).
- calculate: use for any arithmetic/math the user asks for — never compute math in your head, always call this tool so the number is exact.
- convert_currency: use for any currency conversion question.
- save_note: save a note, task, or reminder. For type "reminder", ALWAYS also pass remind_at as an exact ISO 8601 UTC datetime computed from the current time above — this is what triggers the actual notification, so get it right.
- get_notes: recall previously saved notes/tasks/reminders.
- send_email: only if the user explicitly asks to email something.
- If a tool isn't available (not configured by the user yet), say so plainly instead of pretending you did it.
- After any tool call returns, answer in your own words — never dump raw data verbatim.

Keep replies concise and conversational unless the user clearly wants depth.`;
}

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

// ---------- calculator: small safe arithmetic evaluator (no eval(), no Function()) ----------
function safeCalculate(expression) {
  const tokens = String(expression).match(/\d+(\.\d+)?|\+|-|\*|\/|\^|\(|\)|%/g);
  if (!tokens) throw new Error("Couldn't parse that expression.");
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpr() {
    let v = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = next();
      const rhs = parseTerm();
      v = op === "+" ? v + rhs : v - rhs;
    }
    return v;
  }
  function parseTerm() {
    let v = parseFactor();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = next();
      const rhs = parseFactor();
      if ((op === "/" || op === "%") && rhs === 0) throw new Error("Division by zero.");
      v = op === "*" ? v * rhs : op === "/" ? v / rhs : v % rhs;
    }
    return v;
  }
  function parseFactor() {
    let v = parsePow();
    return v;
  }
  function parsePow() {
    let v = parseUnary();
    if (peek() === "^") {
      next();
      const rhs = parsePow();
      v = Math.pow(v, rhs);
    }
    return v;
  }
  function parseUnary() {
    if (peek() === "-") {
      next();
      return -parseUnary();
    }
    return parseAtom();
  }
  function parseAtom() {
    if (peek() === "(") {
      next();
      const v = parseExpr();
      if (peek() !== ")") throw new Error("Mismatched parentheses.");
      next();
      return v;
    }
    const tok = next();
    const n = parseFloat(tok);
    if (Number.isNaN(n)) throw new Error(`Unexpected token: ${tok}`);
    return n;
  }

  const result = parseExpr();
  if (pos !== tokens.length) throw new Error("Unexpected trailing characters.");
  if (!Number.isFinite(result)) throw new Error("Result is not a finite number.");
  return result;
}

// ---------- currency conversion (free, no API key — exchangerate-api.com open access) ----------
// Chosen over frankfurter.app specifically because this one supports BDT.
async function convertCurrency(amount, from, to) {
  try {
    const url = `https://open.er-api.com/v6/latest/${encodeURIComponent(from.toUpperCase())}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.result !== "success" || !data.rates || !(to.toUpperCase() in data.rates)) {
      return `Conversion failed for ${from}->${to}: ${JSON.stringify(data).slice(0, 200)}. Fall back to web_search for this rate.`;
    }
    const rate = data.rates[to.toUpperCase()];
    const converted = (amount * rate).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
    return `${amount} ${from.toUpperCase()} = ${converted} ${to.toUpperCase()} (rate updated: ${data.time_last_update_utc}, via exchangerate-api.com)`;
  } catch (e) {
    return `Currency API error: ${e.message}. Fall back to web_search for this rate.`;
  }
}

// ---------- email (optional — Resend) ----------
async function sendEmail(to, subject, body) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return "Email isn't set up yet — add RESEND_API_KEY in Vercel env vars.";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Agent <onboarding@resend.dev>",
        to: [to],
        subject,
        text: body,
      }),
    });
    const data = await res.json();
    if (!res.ok) return `Email failed: ${JSON.stringify(data).slice(0, 300)} (note: on Resend's free tier without a verified domain, you can only send to the email address you signed up with).`;
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
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

async function saveNote(userId, type, content, remindAt) {
  if (!supabaseReady()) return "Memory storage isn't set up yet — add SUPABASE_URL and SUPABASE_SERVICE_KEY in Vercel env vars.";
  try {
    const row = { user_id: userId, type: type || "note", content };
    if (type === "reminder" && remindAt) row.remind_at = remindAt;
    await supabaseRequest("notes", { method: "POST", body: JSON.stringify(row) });
    if (type === "reminder" && remindAt) {
      return `Reminder saved for ${remindAt}. (Make sure notifications are enabled in Settings, or this won't be able to alert you.)`;
    }
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
    return rows
      .map((r) => `[${r.type}] ${r.content}${r.remind_at ? ` (remind: ${r.remind_at})` : ""} (${new Date(r.created_at).toLocaleString()})`)
      .join("\n");
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
    console.error("logMessage failed:", e.message);
  }
}

function buildTools() {
  const declarations = [
    {
      name: "web_search",
      description: "Search the live web for current information.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "What to search for" } },
        required: ["query"],
      },
    },
    {
      name: "calculate",
      description: "Evaluate an exact arithmetic expression (+ - * / ^ % and parentheses).",
      parameters: {
        type: "object",
        properties: { expression: { type: "string", description: "e.g. (120*3.5)/2" } },
        required: ["expression"],
      },
    },
    {
      name: "convert_currency",
      description: "Convert an amount from one currency to another using live rates.",
      parameters: {
        type: "object",
        properties: {
          amount: { type: "number" },
          from: { type: "string", description: "3-letter currency code, e.g. USD" },
          to: { type: "string", description: "3-letter currency code, e.g. BDT" },
        },
        required: ["amount", "from", "to"],
      },
    },
  ];

  if (supabaseReady()) {
    declarations.push(
      {
        name: "save_note",
        description: "Save a note, task, or reminder for later recall.",
        parameters: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["note", "task", "reminder"] },
            content: { type: "string", description: "What to remember" },
            remind_at: { type: "string", description: "Required for type=reminder. Exact ISO 8601 UTC datetime to trigger the alert." },
          },
          required: ["content"],
        },
      },
      {
        name: "get_notes",
        description: "Retrieve previously saved notes, tasks, and reminders.",
        parameters: { type: "object", properties: {} },
      }
    );
  }

  if (process.env.RESEND_API_KEY) {
    declarations.push({
      name: "send_email",
      description: "Send an email. On the free tier this can only reliably reach the address the user signed up to Resend with.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string" },
          subject: { type: "string" },
          body: { type: "string" },
        },
        required: ["to", "subject", "body"],
      },
    });
  }

  return [{ functionDeclarations: declarations }];
}

async function callGemini(contents, tools, attempt = 0) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set in Vercel environment variables.");
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

  // Free-tier rate limit hit (429) -> wait briefly and retry automatically,
  // instead of immediately surfacing a scary error to the user.
  if (res.status === 429 && attempt < 2) {
    const waitMs = 1500 * Math.pow(2, attempt); // 1.5s, then 3s
    await new Promise((r) => setTimeout(r, waitMs));
    return callGemini(contents, tools, attempt + 1);
  }

  const data = await res.json();
  if (!res.ok) {
    if (res.status === 429) {
      throw new Error("Free plan-er request limit ekhon full — ektu wait kore (~30 sec) abar try koro.");
    }
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
      else if (name === "calculate") {
        try {
          result = String(safeCalculate(args.expression));
        } catch (e) {
          result = `Calculation error: ${e.message}`;
        }
      } else if (name === "convert_currency") result = await convertCurrency(args.amount, args.from, args.to);
      else if (name === "save_note") result = await saveNote(userId, args.type, args.content, args.remind_at);
      else if (name === "get_notes") result = await getNotes(userId);
      else if (name === "send_email") result = await sendEmail(args.to, args.subject, args.body);
      else result = `Unknown tool: ${name}`;

      contents.push({ role: "model", parts: [{ functionCall: { name, args } }] });
      contents.push({ role: "function", parts: [{ functionResponse: { name, response: { result } } }] });

      data = await callGemini(contents, tools);
      loopCount += 1;
    }

    const finalCandidate = data.candidates && data.candidates[0];
    const finalParts = finalCandidate?.content?.parts || [];
    const reply = finalParts.map((p) => p.text || "").join("").trim() || "(No reply generated.)";

    await logMessage(userId, "user", message);
    await logMessage(userId, "model", reply);

    res.status(200).json({ reply, used });
  } catch (e) {
    console.error("chat.js error:", e);
    res.status(500).json({ error: e.message || "Unknown server error" });
  }
};
