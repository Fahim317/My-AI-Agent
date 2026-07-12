// api/chat.js — Turjo v3 (recurring reminders + multi-reminder + on/off control)

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const AGENT_NAME = "Turjo";

function buildSystemPrompt() {
  const now = new Date();
  const bdNow = new Date(now.getTime() + 6 * 60 * 60 * 1000);
  const bdStr = bdNow.toISOString().replace("T", " ").slice(0, 16) + " (Asia/Dhaka, UTC+6)";
  const utcStr = now.toISOString().replace("T", " ").slice(0, 16) + " UTC";

  return `You are ${AGENT_NAME}, Fahim's personal AI agent — sharp, fast, warm, a little witty. Built to actually get things done.

CURRENT TIME:
- Dhaka: ${bdStr}
- UTC: ${utcStr}
Use UTC time for all remind_at calculations. Dhaka = UTC+6, so subtract 6 hours to convert.

LANGUAGE RULE: always reply in the EXACT same language/script the user used. Never switch.

━━━ REMINDER RULES (read every single line) ━━━

ONE-TIME REMINDER:
- User says: "remind me at 3pm", "5 minute pore mone korao", "kal subhe 9te"
- Call save_note ONCE with type="reminder", remind_at=exact UTC ISO datetime, recurrence=null

RECURRING REMINDER:
- User says: "protidin", "everyday", "daily", "shob din", "weekly", "weekdays", "monthly"
- Call save_note with type="reminder", remind_at=first occurrence in UTC, recurrence="daily"/"weekly"/"weekdays"/"monthly"
- recurrence options: "daily" | "weekly" | "weekdays" | "monthly"
- Example: "protidin shokal 8te" → remind_at = today 8AM Dhaka = today 2AM UTC, recurrence = "daily"

MULTIPLE REMINDERS IN ONE MESSAGE:
- User says: "8te medicine khabo mone korao, 1te lunch, 10PM sleep"
- Call save_note THREE TIMES in sequence — once per reminder
- Never combine multiple reminders into one save_note call
- Keep calling save_note until ALL reminders from the message are saved

TURNING OFF A REMINDER:
- User says: "morning reminder off koro", "medicine reminder bondho koro"
- Call manage_reminder with action="turn_off" and match_content = key words from reminder
- Confirm which reminder was paused

TURNING ON A REMINDER:
- User says: "morning reminder on koro", "medicine reminder resume koro"
- Call manage_reminder with action="turn_on" and same match_content

LISTING REMINDERS:
- User says: "amar shob reminders dekhao", "ki ki recurring ache"
- Call manage_reminder with action="list_all" OR call get_notes

ABSOLUTE RULES:
- remind_at is MANDATORY for every reminder — calculate it yourself, never ask the user
- NEVER say "ask me later" or "let me know when" — always set the time
- After saving, confirm the DHAKA time to user (convert back: UTC+6)
- If user gives vague time like "shokal" → use 8AM Dhaka; "bikel" → 5PM; "raat" → 9PM; "dupure" → 1PM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

OTHER TOOLS:
- web_search: real-time info, news, prices, anything current — use liberally
- calculate: ALL math — never estimate, always call this tool
- convert_currency: live currency rates (supports BDT)
- generate_image: create AI images from any description — use when user asks for image/picture/photo/design
- search_history: search Fahim's past conversations — use when user asks "age ki bolechi", "আগে কি বানিয়েছিলাম", "amader last project"
- send_email: only when user explicitly asks

━━ CODING & BUILDING ━━
You are a world-class developer. When asked to build ANYTHING — website, app, tool, script, automation, SaaS, landing page, e-commerce, dashboard — write COMPLETE working code. Rules:
- NEVER truncate code with "..." or "// rest of code here" — always write 100% complete code
- For multi-file projects: write EVERY file completely, label each with filename
- Default stack: HTML/CSS/JS for simple sites, Next.js + Vercel for full-stack, Python for scripts
- Always wrap code in proper markdown: \`\`\`html, \`\`\`javascript, \`\`\`python etc.
- After code, add a short "কিভাবে ব্যবহার করবে" section in user's language
- If user says "same project e add koro" or "age jeta baniyechilam" → use search_history to recall it first

━━ ANALYSIS & RESEARCH ━━
- Do deep analysis: market research, competitor analysis, business plans, financial projections
- Use web_search to get current data, then synthesize into actionable insights
- For any topic: give structured, practical breakdown

━━ CONTENT & CREATIVE ━━
- Write any content: social posts, captions, ads, articles, emails, scripts, stories
- Generate image prompts and actual images with generate_image tool
- Brainstorm ideas: product names, campaign ideas, business concepts, feature ideas
- Always tailor content to Bangladeshi context when relevant

━━ MEMORY ━━
- User's important projects/work may be in past conversations — use search_history when context needed
- Explicitly saved notes/reminders are in database — use get_notes to recall them

Reply concise for simple questions, detailed for complex builds. Match the depth to what's asked.`;
}

// ── Image generation (Pollinations.ai — free, no API key) ──
async function generateImage(prompt, width = 1024, height = 768) {
  const seed = Date.now();
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&nologo=true&seed=${seed}`;
  // Return special marker frontend will render as <img>
  return `[IMAGE:${url}|${prompt}]`;
}

// ── Search past conversation history ──
async function searchHistory(userId, query) {
  if (!supabaseReady()) return "Memory not set up.";
  try {
    const rows = await sbReq(
      `messages?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=200`,
      { method: "GET", prefer: "" }
    );
    if (!rows?.length) return "No past conversations found.";
    const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 2);
    const relevant = rows
      .filter(r => keywords.some(k => r.content.toLowerCase().includes(k)))
      .slice(0, 15);
    if (!relevant.length) return `No past conversations found matching "${query}".`;
    return relevant.map(r =>
      `[${r.role} — ${new Date(r.created_at).toLocaleString()}]\n${r.content.slice(0, 400)}`
    ).join("\n\n---\n\n");
  } catch (e) {
    return `History search failed: ${e.message}`;
  }
}
async function callTavily(query) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return "Web search not set up — add TAVILY_API_KEY in Vercel env vars.";
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
      out += data.results.slice(0, 5).map(r => `- ${r.title}: ${(r.content||"").slice(0,200)} (${r.url})`).join("\n");
    }
    return out || "No results.";
  } catch (e) { return `Search error: ${e.message}`; }
}

// ── Safe calculator ──
function safeCalculate(expression) {
  const tokens = String(expression).match(/\d+(\.\d+)?|\+|-|\*|\/|\^|\(|\)|%/g);
  if (!tokens) throw new Error("Cannot parse expression.");
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  function parseExpr() {
    let v = parseTerm();
    while (peek()==="+" || peek()==="-") { const op=next(); const r=parseTerm(); v=op==="+"?v+r:v-r; }
    return v;
  }
  function parseTerm() {
    let v = parsePow();
    while (peek()==="*"||peek()==="/"||peek()==="%") {
      const op=next(); const r=parsePow();
      if((op==="/"||op==="%")&&r===0) throw new Error("Division by zero.");
      v=op==="*"?v*r:op==="/"?v/r:v%r;
    }
    return v;
  }
  function parsePow() { let v=parseUnary(); if(peek()==="^"){next();v=Math.pow(v,parsePow());} return v; }
  function parseUnary() { if(peek()==="-"){next();return -parseUnary();} return parseAtom(); }
  function parseAtom() {
    if(peek()==="("){next();const v=parseExpr();if(peek()!==")")throw new Error("Mismatched ()");next();return v;}
    const t=next(); const n=parseFloat(t); if(isNaN(n))throw new Error(`Bad token: ${t}`); return n;
  }
  const result=parseExpr();
  if(pos!==tokens.length) throw new Error("Trailing characters.");
  if(!isFinite(result)) throw new Error("Not finite.");
  return result;
}

// ── Currency convert ──
async function convertCurrency(amount, from, to) {
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${from.toUpperCase()}`);
    const data = await res.json();
    if (data.result !== "success" || !data.rates?.[to.toUpperCase()])
      return `Conversion failed for ${from}→${to}. Try web_search.`;
    const converted = (amount * data.rates[to.toUpperCase()]).toFixed(4).replace(/\.?0+$/, "");
    return `${amount} ${from.toUpperCase()} = ${converted} ${to.toUpperCase()} (${data.time_last_update_utc})`;
  } catch (e) { return `Currency error: ${e.message}`; }
}

// ── Email ──
async function sendEmail(to, subject, body) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return "Email not set up — add RESEND_API_KEY.";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "Turjo <onboarding@resend.dev>", to: [to], subject, text: body }),
    });
    const data = await res.json();
    return res.ok ? `Email sent to ${to}.` : `Email failed: ${JSON.stringify(data).slice(0,300)}`;
  } catch (e) { return `Email error: ${e.message}`; }
}

// ── Supabase helper ──
function supabaseReady() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
}
async function sbReq(path, options = {}) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Supabase ${res.status}: ${t.slice(0,300)}`); }
  return res.status === 204 ? null : res.json();
}

// ── Save note / reminder ──
async function saveNote(userId, type, content, remindAt, recurrence) {
  if (!supabaseReady()) return "Memory not set up — add SUPABASE_URL + SUPABASE_SERVICE_KEY.";
  try {
    if (type === "reminder" && !remindAt) {
      remindAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    }
    const row = { user_id: userId, type: type || "note", content, active: true };
    if (type === "reminder") {
      if (remindAt) row.remind_at = remindAt;
      if (recurrence) row.recurrence = recurrence;
      row.sent = false;
    }
    await sbReq("notes", { method: "POST", body: JSON.stringify(row) });

    if (type === "reminder" && remindAt) {
      const dhakaTime = new Date(new Date(remindAt).getTime() + 6*60*60*1000)
        .toISOString().replace("T"," ").slice(0,16);
      const recurStr = recurrence ? ` (🔁 ${recurrence})` : "";
      return `Reminder saved${recurStr}. First alert: ${dhakaTime} Dhaka time.`;
    }
    return `Saved as ${type || "note"}.`;
  } catch (e) { return `Save failed: ${e.message}`; }
}

// ── Get notes ──
async function getNotes(userId) {
  if (!supabaseReady()) return "Memory not set up.";
  try {
    const rows = await sbReq(
      `notes?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=30`,
      { method: "GET", prefer: "" }
    );
    if (!rows?.length) return "No saved notes yet.";
    return rows.map(r => {
      let line = `[${r.type}] ${r.content}`;
      if (r.remind_at) {
        const dhakaTime = new Date(new Date(r.remind_at).getTime()+6*60*60*1000)
          .toISOString().replace("T"," ").slice(0,16);
        const recur = r.recurrence ? ` 🔁${r.recurrence}` : "";
        const status = r.active === false ? " ⏸paused" : r.sent ? " ✅done" : " ⏳pending";
        line += ` → ${dhakaTime} Dhaka${recur}${status}`;
      }
      return line;
    }).join("\n");
  } catch (e) { return `Fetch failed: ${e.message}`; }
}

// ── Manage reminder (turn on/off/list) ──
async function manageReminder(userId, action, matchContent) {
  if (!supabaseReady()) return "Memory not set up.";
  try {
    if (action === "list_all") {
      const rows = await sbReq(
        `notes?user_id=eq.${encodeURIComponent(userId)}&type=eq.reminder&order=created_at.desc&limit=20`,
        { method: "GET", prefer: "" }
      );
      if (!rows?.length) return "No reminders saved yet.";
      return rows.map(r => {
        const dhakaTime = r.remind_at
          ? new Date(new Date(r.remind_at).getTime()+6*60*60*1000).toISOString().replace("T"," ").slice(0,16)
          : "no time set";
        const recur = r.recurrence ? ` 🔁${r.recurrence}` : " (one-time)";
        const state = r.active === false ? "⏸ PAUSED" : r.sent ? "✅ done" : "⏳ pending";
        return `• ${r.content}${recur} | next: ${dhakaTime} Dhaka | ${state} | id:${r.id}`;
      }).join("\n");
    }

    // Find matching reminder
    const rows = await sbReq(
      `notes?user_id=eq.${encodeURIComponent(userId)}&type=eq.reminder&order=created_at.desc&limit=30`,
      { method: "GET", prefer: "" }
    );
    const match = (rows||[]).find(r =>
      !matchContent || r.content.toLowerCase().includes(matchContent.toLowerCase())
    );
    if (!match) return `No reminder found matching "${matchContent}". Use manage_reminder with action="list_all" to see all reminders.`;

    const active = action === "turn_on";
    const updates = { active };
    // If turning on a recurring reminder that's already past, reset remind_at to next future occurrence
    if (active && match.recurrence && match.remind_at) {
      const remindDate = new Date(match.remind_at);
      if (remindDate < new Date()) {
        // Advance to next future occurrence
        let next = new Date(remindDate);
        const interval = match.recurrence === "weekly" ? 7*24*60*60*1000 : 24*60*60*1000;
        while (next < new Date()) { next = new Date(next.getTime() + interval); }
        updates.remind_at = next.toISOString();
        updates.sent = false;
      }
    }
    await sbReq(`notes?id=eq.${match.id}`, {
      method: "PATCH", prefer: "return=minimal",
      body: JSON.stringify(updates),
    });

    const dhakaTime = updates.remind_at
      ? new Date(new Date(updates.remind_at).getTime()+6*60*60*1000).toISOString().replace("T"," ").slice(0,16)
      : null;
    const nextInfo = dhakaTime ? ` Next alert: ${dhakaTime} Dhaka.` : "";
    return active
      ? `✅ "${match.content}" reminder turned ON.${nextInfo}`
      : `⏸ "${match.content}" reminder paused. Say "on koro" anytime to resume.`;
  } catch (e) { return `manage_reminder error: ${e.message}`; }
}

// ── Log message ──
async function logMessage(userId, role, content) {
  if (!supabaseReady()) return;
  try {
    await sbReq("messages", {
      method: "POST", prefer: "return=minimal",
      body: JSON.stringify({ user_id: userId, role, content }),
    });
  } catch (e) { console.error("log failed:", e.message); }
}

// ── Build tool list ──
function buildTools() {
  const decls = [
    {
      name: "web_search",
      description: "Search the live web for current information.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
    {
      name: "generate_image",
      description: "Generate an AI image from a text description. Use when user asks for image, picture, photo, design, illustration, poster, banner, logo idea etc.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Detailed English description of the image to generate. Be specific about style, colors, subject." },
          width: { type: "number", description: "Width in pixels. Default 1024. Use 1080 for square, 1920 for landscape, 768 for portrait." },
          height: { type: "number", description: "Height in pixels. Default 768." },
        },
        required: ["prompt"],
      },
    },
    {
      name: "search_history",
      description: "Search Fahim's past conversation history. Use when user asks about previous projects, past work, 'age ki bolechi', 'amader last project', or needs context from earlier conversations.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to search for in past conversations" },
        },
        required: ["query"],
      },
    },
    {
      name: "calculate",
      description: "Exact arithmetic. Always use this for math, never compute in your head.",
      parameters: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] },
    },
    {
      name: "convert_currency",
      description: "Live currency conversion. Supports BDT.",
      parameters: {
        type: "object",
        properties: { amount: { type: "number" }, from: { type: "string" }, to: { type: "string" } },
        required: ["amount", "from", "to"],
      },
    },
  ];

  if (supabaseReady()) {
    decls.push(
      {
        name: "save_note",
        description: "Save a note, task, or reminder. For multiple reminders — call this tool MULTIPLE TIMES, once per reminder. remind_at is REQUIRED for reminders.",
        parameters: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["note", "task", "reminder"] },
            content: { type: "string" },
            remind_at: { type: "string", description: "ISO 8601 UTC datetime. REQUIRED for reminders. Calculate from UTC time in system prompt." },
            recurrence: { type: "string", enum: ["daily", "weekly", "weekdays", "monthly"], description: "For recurring reminders. Omit for one-time." },
          },
          required: ["type", "content"],
        },
      },
      {
        name: "get_notes",
        description: "Retrieve saved notes, tasks, and reminders.",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "manage_reminder",
        description: "Turn a reminder ON or OFF, or list all reminders. Use turn_off to pause, turn_on to resume.",
        parameters: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["turn_off", "turn_on", "list_all"] },
            match_content: { type: "string", description: "Key words from the reminder content to find it. Required for turn_on/turn_off." },
          },
          required: ["action"],
        },
      }
    );
  }

  if (process.env.RESEND_API_KEY) {
    decls.push({
      name: "send_email",
      description: "Send an email.",
      parameters: {
        type: "object",
        properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } },
        required: ["to", "subject", "body"],
      },
    });
  }

  return [{ functionDeclarations: decls }];
}

// ── Gemini call with auto-retry ──
async function callGemini(contents, tools, attempt = 0) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set.");
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: buildSystemPrompt() }] },
      contents, tools,
      generationConfig: { temperature: 0.7 },
    }),
  });
  if (res.status === 429 && attempt < 2) {
    await new Promise(r => setTimeout(r, 1500 * Math.pow(2, attempt)));
    return callGemini(contents, tools, attempt + 1);
  }
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 429) {
      // Extract exact retry seconds from Gemini error message
      let retryAfterSeconds = 60;
      try {
        const raw = JSON.stringify(data);
        const m = raw.match(/retry in (\d+(\.\d+)?)s/i);
        if (m) retryAfterSeconds = Math.ceil(parseFloat(m[1]));
      } catch (_) {}
      const err = new Error("rate_limit");
      err.retryAfterSeconds = retryAfterSeconds;
      throw err;
    }
    throw new Error(`Gemini ${res.status}: ${JSON.stringify(data).slice(0,500)}`);
  }
  return data;
}

// ── Main handler ──
module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "Use POST" }); return; }
  try {
    const { message, history = [], userId = "default" } = req.body || {};
    if (!message) { res.status(400).json({ error: "Missing message." }); return; }

    const tools = buildTools();
    const contents = history
      .filter(m => m?.content)
      .map(m => ({ role: m.role === "model" ? "model" : "user", parts: [{ text: m.content }] }));
    contents.push({ role: "user", parts: [{ text: message }] });

    const used = [];
    let data = await callGemini(contents, tools);

    // Agent loop — up to 8 iterations (handles multiple save_note calls in one turn)
    for (let i = 0; i < 8; i++) {
      const parts = data.candidates?.[0]?.content?.parts || [];
      const fnCall = parts.find(p => p.functionCall);
      if (!fnCall) break;

      const { name, args } = fnCall.functionCall;
      if (!used.includes(name)) used.push(name);

      let result;
      if (name === "web_search") result = await callTavily(args.query);
      else if (name === "generate_image") result = await generateImage(args.prompt, args.width, args.height);
      else if (name === "search_history") result = await searchHistory(userId, args.query);
      else if (name === "calculate") {
        try { result = String(safeCalculate(args.expression)); }
        catch (e) { result = `Calc error: ${e.message}`; }
      }
      else if (name === "convert_currency") result = await convertCurrency(args.amount, args.from, args.to);
      else if (name === "save_note") result = await saveNote(userId, args.type, args.content, args.remind_at, args.recurrence);
      else if (name === "get_notes") result = await getNotes(userId);
      else if (name === "manage_reminder") result = await manageReminder(userId, args.action, args.match_content);
      else if (name === "send_email") result = await sendEmail(args.to, args.subject, args.body);
      else result = `Unknown tool: ${name}`;

      contents.push({ role: "model", parts: [{ functionCall: { name, args } }] });
      contents.push({ role: "function", parts: [{ functionResponse: { name, response: { result } } }] });
      data = await callGemini(contents, tools);
    }

    const reply = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("").trim() || "(No reply.)";
    await logMessage(userId, "user", message);
    await logMessage(userId, "model", reply);
    res.status(200).json({ reply, used });
  } catch (e) {
    console.error("chat.js error:", e);
    const payload = { error: e.message || "Server error" };
    if (e.retryAfterSeconds) payload.retryAfterSeconds = e.retryAfterSeconds;
    res.status(500).json(payload);
  }
};
