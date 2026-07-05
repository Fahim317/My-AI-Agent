# Turjo — Personal AI Agent (v2)

Tomar personal AI agent. Joto language e likhbe/bolbe shei bhashay reply dibe.
Web search, calculator, currency convert (BDT shoho), note/reminder save, real push notification, voice input/output, phone+PC sync — shob free.

---

## Files overview

```
turjo/
├── index.html              ← main app (UI + PWA)
├── sw.js                   ← service worker (offline shell + push notifications)
├── manifest.json           ← PWA install config
├── icon-192.png / icon-512.png
├── package.json            ← web-push dependency
├── vercel.json             ← free daily cron config
├── supabase-schema.sql     ← run once in Supabase
├── .env.example            ← all env vars with comments
└── api/
    ├── chat.js             ← main brain (Gemini + all tools)
    ├── history.js          ← cross-device chat history sync
    ├── save-subscription.js← saves device push subscriptions
    ├── cron-daily.js       ← Vercel free daily cron → morning push
    └── cron-reminders.js   ← checks + fires due reminders (ping from cron-job.org)
```

---

## Step 1 — Free API keys collect koro (10 min total)

### A. Gemini (required — agent-er brain)
1. যাও: **aistudio.google.com/app/apikey**
2. "Create API key" → copy koro

### B. Tavily (required — web search)
1. যাও: **app.tavily.com** → Sign up (no card)
2. Dashboard-e key already thakbe → copy koro

### C. Supabase (strongly recommended — notes, reminders, sync)
1. যাও: **supabase.com** → New project (free)
2. Project Settings → API → copy:
   - **Project URL** (looks like `https://xxxx.supabase.co`)
   - **service_role** key — NOT the anon/public key
3. SQL Editor → New query → paste the full contents of `supabase-schema.sql` → Run

### D. VAPID keys (required for push notifications)
Already generated for this project — just use these as-is in Vercel:
```
VAPID_PUBLIC_KEY=BJws9-BS5KFJa6o-5EDajJz0U3FnayR4PFSnC8xKudTnNy-pT3jHDaP5XMuddPEoa2rxYqRTQT2vQtRTgDlX-Zo
VAPID_PRIVATE_KEY=H_Gth7l3kNVeIFDrbZsRNmF9pshyBit1AXAn52C52c8
```
(These are specific to your project. If you ever regenerate them, the old subscriptions stop working — so don't change unless needed.)

### E. CRON_SECRET (protects your reminder endpoint)
Pick any random string, e.g.: `turjo-cron-2026-secret`

### F. Resend (optional — email sending)
1. যাও: **resend.com** → Sign up free
2. API Keys → Create key → copy
3. Free tier-e domain verify na korle shudhu tomar own email-e pathate parbe

---

## Step 2 — GitHub e upload

1. **github.com** → "+" → New repository (e.g. `turjo`)
2. Repo page → **"uploading an existing file"**
3. Ei project-er **shob file** drag-drop kore upload koro (api folder shoho)
4. **Commit changes**

---

## Step 3 — Vercel deploy

1. **vercel.com** → Continue with GitHub → tomar repo → **Import**
2. Deploy korar age **Environment Variables** section-e add koro:

| Variable | Value |
|---|---|
| `GEMINI_API_KEY` | tomar Gemini key |
| `TAVILY_API_KEY` | tomar Tavily key |
| `SUPABASE_URL` | tomar Supabase project URL |
| `SUPABASE_SERVICE_KEY` | service_role key (NOT anon) |
| `VAPID_PUBLIC_KEY` | উপরের public key |
| `VAPID_PRIVATE_KEY` | উপরের private key |
| `CRON_SECRET` | tomar chosen secret string |
| `RESEND_API_KEY` | (optional) Resend key |

3. **Deploy** → ~30 second wait → live URL pabe

---

## Step 4 — Real-time reminder notifications setup (free, 2 min)

Vercel-er free tier cron only once-a-day chalate pare. Real-time reminder-er jonno (5-15 min-e check) ekta free external service use korbo:

1. যাও: **cron-job.org** → Free sign up
2. "Create cronjob":
   - **URL**: `https://TOMAR-PROJECT.vercel.app/api/cron-reminders`
   - **Schedule**: every 5 or 15 minutes (tumi decide koro)
   - **Request method**: GET
   - **Headers**: `Authorization: Bearer TOMAR_CRON_SECRET`
     *(ei secret ta Vercel-e set kora CRON_SECRET-er shathe match korbe)*
3. Save koro

Bas! Ekhon "amake remind koriye dio meeting-er 30 min age" bolte parbe — Turjo actually alert korbe.

---

## Step 5 — Phone-e install

**Android (Chrome):**
Site open kore Chrome-er ⋮ menu → "Add to Home screen" / "Install app"

**iPhone (Safari):**
Share icon (□↑) → "Add to Home Screen"

---

## Step 6 — Notifications enable koro

App-e ⚙ icon → **"Enable" button** → browser permission diye dao

---

## Step 7 — Cross-device sync

App-e ⚙ → sync code dekha jabe (6 char, e.g. `XK7P2M`)
Same code phone + PC dujayegai set korle notes + history share hobe.

---

## Ki ki korte paro ekhon

| Command (jokono bhashay) | Ki hobe |
|---|---|
| "Dollar rate aaj koto?" | Web search kore real rate dibe |
| "1000 USD to BDT" | Live rate convert korbe |
| "120 × 3.5 / 2 = ?" | Exact calculation dibe |
| "Note rakhho: client meeting Thursday 3pm" | Supabase-e save hobe |
| "Amake remind koriye dio kal shokal 9-e medicine khete" | Save + notification pathabe |
| "Amar shob notes dekhao" | Shob recall korbe |
| 🎙 tap → Bangla/English-e bolo | Transcribe kore reply dibe |
| 🔊 tap → reply enable | Reply audio-te shunbe |

---

## Kichhu problem hoile

Red error bubble ashle exact text copy kore Fahim-ke pathao — chatei fix kore debo.

Most common issues:
- **429 error**: Free tier rate limit — 30s wait kore retry
- **Notification not working**: Browser setting-e site permission check koro
- **Reminder missing**: cron-job.org-e job active ache kina confirm koro
- **Notes save hocche na**: Supabase env vars thik ache kina check koro (service_role key, NOT anon)
