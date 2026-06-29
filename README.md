# My AI Agent

A free, personal AI agent — chat in any language, voice in/out, installable on phone + PC, and it can actually *do* things: search the web and remember notes/tasks for you.

No coding needed to deploy — just copy-paste API keys into Vercel's website (not a terminal, so the mobile env-var headache from before won't happen here).

---

## 1. Get your free API keys (5 min)

**Gemini (the brain) — required**
1. Go to https://aistudio.google.com/app/apikey
2. Sign in, click "Create API key"
3. Copy it somewhere safe

**Tavily (web search) — required for the search command**
1. Go to https://app.tavily.com → sign up (no card needed)
2. Copy your API key from the dashboard

**Supabase (cross-device memory) — optional, skip if you just want single-device chat**
1. Go to https://supabase.com → New project (free tier)
2. Once created: Project Settings → API → copy the **Project URL** and the **`service_role`** key (NOT the `anon` key — service_role is the one that's allowed to write data)
3. Go to the SQL Editor → paste the contents of `supabase-schema.sql` from this project → Run

---

## 2. Put the code on GitHub

1. Create a new repo (e.g. `my-ai-agent`) on https://github.com/new
2. Upload all the files from this project into it (drag-and-drop works fine on github.com, even from phone)

---

## 3. Deploy on Vercel

1. Go to https://vercel.com → Add New → Project → Import your GitHub repo
2. Before clicking Deploy, open **Environment Variables** and add:
   - `GEMINI_API_KEY` → paste your Gemini key
   - `TAVILY_API_KEY` → paste your Tavily key
   - `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` → only if you set up Supabase
3. Click **Deploy**. Wait ~30 seconds. Done — you'll get a URL like `my-ai-agent.vercel.app`

That's it. No build step, no CLI, no terminal.

---

## 4. Install it like an app

- **Phone (Android/Chrome):** open the URL → tap the "Add to Home Screen" prompt (or menu → Install app)
- **Phone (iPhone/Safari):** open the URL → Share button → Add to Home Screen
- **PC:** just bookmark it, or Chrome menu → Install App

---

## 5. Using the same memory on phone + PC

Tap ⚙ in the app → you'll see a 6-character **sync code**. Type that *same* code into the ⚙ panel on your other device, and both will share the same saved notes and chat history (only works if Supabase is set up).

---

## What it can do right now

- Talk in English, Bangla, or Banglish — it replies in whatever language you used
- 🎙 Tap the mic and just talk — it transcribes and replies, optionally reading the answer back (🔊)
- "Search the web for…" → pulls live info via Tavily
- "Save a note / reminder / task: …" → remembers it
- "Show my notes" → recalls everything saved

## What to add next (when you're ready)

This is built to be extended — more tools = more "commands." Easy next additions:
- Send actual SMS/WhatsApp/email when asked (needs a free-tier provider like Resend for email)
- Calendar/reminders that actually notify you (needs push notifications or a cron job)
- Calculator / currency conversion as dedicated tools (currently the model just estimates)

Just tell me which one you want next and I'll build it into `api/chat.js`.

## If something breaks on first deploy

Open the deployed site, send a message, and if you get a red error bubble — copy the exact text and send it to me. Most likely causes: a typo'd API key, or Gemini's function-call response shape needing a small tweak (the API evolves; I wrote this against the current docs but can't test-call it from here).
