# WhatsApp Overdue Alerts — Step-by-Step Setup (start to finish)

Backend API (already live on Render): `https://api-salesmanager.tescomanagement.com`
All WhatsApp endpoints live under `.../api/wa/...`.

Do the parts in order. Parts 1–4 are one-time Meta setup. Parts 5–6 turn it on.
Parts 7–10 configure, test and schedule it.

Time: ~30–45 min of work + waiting for Meta template approval (minutes to a few hours).

────────────────────────────────────────────────────────────────────────
## PART 0 — What you need before you start
────────────────────────────────────────────────────────────────────────
1. A Facebook account that will own the setup.
2. A **Meta Business Account** (Business Manager). If you don't have one:
   go to https://business.facebook.com → Create Account → follow prompts.
3. A phone number to be the **sender** (the company WhatsApp Business number).
   - It must NOT already be registered on the normal WhatsApp/WhatsApp Business app.
     If it is, delete that WhatsApp account first, or use a fresh number.
   - Managers/BDEs do NOT need anything special — they receive on their normal WhatsApp.
4. Access to your **Render** dashboard (the Sales Manager API service).
5. Access to push code to the repo (so Render redeploys the backend).

────────────────────────────────────────────────────────────────────────
## PART 1 — Create a Meta app and add WhatsApp
────────────────────────────────────────────────────────────────────────
1. Go to https://developers.facebook.com → log in → **My Apps** → **Create App**.
2. If asked "What do you want to build?/Use case", choose **Other** → **Next**.
3. App type: choose **Business** → **Next**.
4. App name: e.g. `Tesco CRM WhatsApp` → pick your Business Account → **Create app**.
5. In the app dashboard, find **WhatsApp** in the product list → click **Set up**.
6. When prompted, select your **Meta Business Account** → **Continue**.

You are now on **WhatsApp → API Setup** (also called "Getting started"). Keep this tab open.

────────────────────────────────────────────────────────────────────────
## PART 2 — Get the sender number + Phone Number ID
────────────────────────────────────────────────────────────────────────
On **WhatsApp → API Setup** you'll see a "From" section with a test number already created.

Option A — quick test first (recommended before going live):
1. Note the **Phone number ID** shown under the "From" number. This is `WA_PHONE_NUMBER_ID`.
2. In "To", add YOUR OWN personal number as a recipient and verify it with the OTP.
   (The free test number can only message recipients you add here, until you add a real
   number — fine for the first end-to-end test.)

Option B — add the real company number (do this to go live):
1. In the "From" dropdown click **Add phone number**.
2. Enter the company number, verify by SMS/call.
3. Set the display name and complete business verification if Meta asks.
4. Select that number as the "From" — copy its **Phone number ID** → this is `WA_PHONE_NUMBER_ID`.

Also copy the **WhatsApp Business Account ID** (shown on the same page) — keep it for reference.

────────────────────────────────────────────────────────────────────────
## PART 3 — Create a PERMANENT access token (System User)
────────────────────────────────────────────────────────────────────────
The temporary token on the API Setup page expires in 24h. Create a permanent one:

1. Go to https://business.facebook.com/settings (Business Settings).
2. Left menu → **Users → System users** → **Add**.
   - Name: `crm-whatsapp-bot`, Role: **Admin** (or Employee) → **Create**.
3. Select the new system user → **Add assets** → **Apps** → pick your app →
   enable **Full control** (Manage app) → **Save changes**.
   Also add the **WhatsApp Account** asset and give **Full control**.
4. Click **Generate new token** → select your app.
5. Token expiration: **Never**.
6. Permissions: tick **whatsapp_business_messaging** and **whatsapp_business_management**
   → **Generate token**.
7. **Copy the token now and store it safely** — you can't see it again. This is `WA_ACCESS_TOKEN`.

────────────────────────────────────────────────────────────────────────
## PART 4 — Create the UTILITY message template (and get it approved)
────────────────────────────────────────────────────────────────────────
1. Go to https://business.facebook.com/wa/manage/message-templates (WhatsApp Manager →
   Message templates) → **Create template**.
2. Category: **Utility**  (NOT Marketing — Utility keeps it transactional and cheap).
3. Name: `overdue_lead_followup`  (exactly — this is `WA_TEMPLATE_NAME`).
4. Language: **English** → code `en`  (this is `WA_TEMPLATE_LANG`).
5. In the **Body** box paste exactly:

   Hi {{1}}, a lead follow-up is OVERDUE.

   Lead ID: {{2}}
   Client: {{3}}
   Client phone: {{4}}
   Follow-up was due: {{5}}

   Please follow up with this client as soon as possible.

6. Meta will ask for **sample values** for {{1}}–{{5}}. Use:
   {{1}} Saravanan  ·  {{2}} LD-0491  ·  {{3}} Harish  ·  {{4}} 9980107172  ·  {{5}} 12-08-2026, 02:30 PM
7. No buttons/header/footer needed. **Submit**.
8. Wait for status to become **Approved** (usually minutes, sometimes a few hours).
   You can continue with Parts 5–7 while you wait, but the first send only works once Approved.

If you reword the text later, keep the SAME 5 variables in the SAME order, or update the code's
parameter order to match.

────────────────────────────────────────────────────────────────────────
## PART 5 — Deploy the backend code
────────────────────────────────────────────────────────────────────────
The WhatsApp code is already in the Sales Manager backend. Deploy it:
1. Commit and push the Manager backend changes (new files under `backend/src/...` + the
   edits to `User.js` and `routes/index.js`).
2. Render auto-deploys on push. Wait until the service shows **Live** with the new deploy.
   (If auto-deploy is off: Render dashboard → the Sales Manager API service → **Manual Deploy**.)
3. Sanity check it's up: open `https://api-salesmanager.tescomanagement.com/api/health`
   in a browser — it should return `{"status":"ok",...}`.

────────────────────────────────────────────────────────────────────────
## PART 6 — Set environment variables on Render
────────────────────────────────────────────────────────────────────────
Render dashboard → the **Sales Manager API** service → **Environment** → add these keys:

| Key                 | Value                                                        |
|---------------------|--------------------------------------------------------------|
| WA_PHONE_NUMBER_ID  | (from Part 2)                                                |
| WA_ACCESS_TOKEN     | (the permanent token from Part 3)                            |
| WA_API_VERSION      | v23.0  (use v27.0+ after v26.0 retires on 24 Sep 2026)       |
| WA_TEMPLATE_NAME    | overdue_lead_followup                                        |
| WA_TEMPLATE_LANG    | en                                                           |
| WA_CRON_SECRET      | a long random string you invent (e.g. 32+ chars)            |
| WA_DEFAULT_COUNTRY_CODE | 91                                                       |
| WA_MAX_PER_RUN      | 50                                                           |

Click **Save changes** — Render restarts the service automatically. These are backend-only;
they are never exposed to any frontend.

Tip for `WA_CRON_SECRET`: generate one, e.g. run in any terminal:
`node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`

────────────────────────────────────────────────────────────────────────
## PART 7 — Add each Manager/BDE's WhatsApp number + opt-in
────────────────────────────────────────────────────────────────────────
A manager only gets alerts if they have a number on file AND opt-in = true.
Run one command per manager (replace SECRET with your `WA_CRON_SECRET`), from any terminal:

```
curl -X POST "https://api-salesmanager.tescomanagement.com/api/wa/managers/set" ^
  -H "x-cron-key: SECRET" -H "Content-Type: application/json" ^
  -d "{\"name\":\"Saravanan\",\"whatsapp\":\"9845294041\",\"optIn\":true}"
```
(Windows CMD uses `^` for line breaks as above; in Mac/Linux use `\`.)

- `name` must match the manager's name EXACTLY as it appears in the CRM (the same name used
  in the lead's "Assign To").
- `whatsapp` can be a plain 10-digit Indian number — the code adds +91 automatically.

Check who is configured (numbers are masked):
```
curl "https://api-salesmanager.tescomanagement.com/api/wa/managers" -H "x-cron-key: SECRET"
```
You want `hasNumber: true` and `optIn: true` for each manager who should receive alerts.

(Alternative to the API: set the env var `WA_MANAGER_NUMBERS` to a JSON map, e.g.
`{"Saravanan":"9845294041","Akash":"9812345678"}` — names listed there are treated as opted-in.)

────────────────────────────────────────────────────────────────────────
## PART 8 — Test before scheduling
────────────────────────────────────────────────────────────────────────
1. **See what's overdue (no messages sent):**
```
curl "https://api-salesmanager.tescomanagement.com/api/wa/overdue/preview" -H "x-cron-key: SECRET"
```
   It lists the leads currently considered overdue and their assigned manager.

2. **Send for real, once** (do this only after the template is Approved and at least one
   manager — ideally YOU, added as a test manager/number — is configured):
```
curl -X POST "https://api-salesmanager.tescomanagement.com/api/wa/cron/overdue" -H "x-cron-key: SECRET"
```
   You'll get a summary like `{"overdue":12,"sent":9,"skipped":2,"failed":0,"alreadySent":0}`.

3. **Check the log** (status + Meta message id per attempt):
```
curl "https://api-salesmanager.tescomanagement.com/api/wa/logs?limit=50" -H "x-cron-key: SECRET"
```
4. Confirm the WhatsApp actually arrived on the test phone.
5. Run the cron command again immediately — the same events should show as `alreadySent`
   (proves no duplicates).

────────────────────────────────────────────────────────────────────────
## PART 9 — Schedule the external cron (every 5–10 minutes)
────────────────────────────────────────────────────────────────────────
Pick ONE.

### Option A — cron-job.org (free, easiest)
1. Sign up at https://cron-job.org → **Create cronjob**.
2. Title: `CRM overdue WhatsApp`.
3. URL: `https://api-salesmanager.tescomanagement.com/api/wa/cron/overdue`
4. Schedule: **Every 10 minutes** (or every 5).
5. Advanced → **Request method: POST**.
6. Advanced → **Headers** → add: `x-cron-key` = your `WA_CRON_SECRET`.
   (If it won't let you add a header, instead use the URL
   `https://api-salesmanager.tescomanagement.com/api/wa/cron/overdue?key=YOUR_SECRET`.)
7. Save → **Enable**. Open its execution history after 10–20 min to confirm 200 OK responses.

### Option B — Render Cron Job
1. Render dashboard → **New +** → **Cron Job**.
2. Schedule: `*/10 * * * *`.
3. Command:
```
curl -X POST "https://api-salesmanager.tescomanagement.com/api/wa/cron/overdue" -H "x-cron-key: $WA_CRON_SECRET"
```
4. Add an env var `WA_CRON_SECRET` on the cron job equal to the backend's value → **Create**.

────────────────────────────────────────────────────────────────────────
## PART 10 — Go live
────────────────────────────────────────────────────────────────────────
1. Switch the sender to the REAL company number (Part 2, Option B) if you tested on the free number.
2. Make sure every real Manager/BDE is configured (`hasNumber:true, optIn:true`).
3. Leave the cron enabled. That's it — overdue alerts now fire 24/7.

────────────────────────────────────────────────────────────────────────
## Troubleshooting
────────────────────────────────────────────────────────────────────────
- **403 Forbidden** on the endpoints → wrong/missing `x-cron-key`. It must equal `WA_CRON_SECRET`.
- **503 "WA_CRON_SECRET not set"** → you didn't set that env var on Render (Part 6).
- **failed: "WhatsApp not configured"** → `WA_PHONE_NUMBER_ID` / `WA_ACCESS_TOKEN` missing.
- **failed: template error / "template name does not exist"** → template not Approved yet, or
  `WA_TEMPLATE_NAME`/`WA_TEMPLATE_LANG` don't match the template exactly.
- **failed: "(#131030) Recipient not in allowed list"** → you're still on the free test number;
  add the recipient under "To" in API Setup, or switch to the real number.
- **skipped: "no WhatsApp number on file" / "not opted in"** → run the Part 7 command for that
  manager (name must match the CRM exactly).
- **failed: invalid/expired token** → regenerate the permanent System User token (Part 3) and
  update `WA_ACCESS_TOKEN`.
- **Nothing overdue but you expected some** → check the lead has a real follow-up date in the
  past, isn't marked done, isn't Junk/Lost/Completed/Order Confirmed, and is assigned.

────────────────────────────────────────────────────────────────────────
## Cost (2026)
────────────────────────────────────────────────────────────────────────
Per-delivered-message. These are Utility templates. India utility ≈ $0.0014/message, so even
~100 alerts/day is a few cents. Confirm your exact rate on Meta's current rate card.
