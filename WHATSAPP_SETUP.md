# WhatsApp Overdue-Lead Alerts — Setup (Meta WhatsApp Cloud API)

When a lead's scheduled follow-up date/time passes and the call hasn't been logged, the
assigned **Manager/BDE** gets a WhatsApp message on their **normal personal WhatsApp**
(they do NOT need WhatsApp Business). The company's WhatsApp Business number is the sender.
An **external cron** calls the backend every 5–10 minutes, so alerts fire even when nobody
has the CRM open.

This is an ADDITIONAL delivery channel layered on top of the existing in-app notifications.
It does **not** change the existing overdue / follow-up / assignment / in-app-notification
logic (`notificationSync.js` is untouched).

## What counts as "overdue" (same as the Manager UI)
A lead whose follow-up date/time is in the past (interpreted in IST), the call is **not**
marked done, the lead is still open (not Junk/Lost/Completed/Order Confirmed), and it is
**assigned** to a manager. Leads with no follow-up date are not WhatsApp'd.

## 1. Create the approved UTILITY template in Meta
Meta → WhatsApp Manager → Message templates → **Create template**
- Category: **Utility**  (keeps it transactional + low cost; do NOT use Marketing)
- Name: `overdue_lead_followup`   (must equal `WA_TEMPLATE_NAME`)
- Language: **English** (`en`)   (must equal `WA_TEMPLATE_LANG`)
- Body (5 variables, in this exact order):

```
Hi {{1}}, a lead follow-up is OVERDUE.

Lead ID: {{2}}
Client: {{3}}
Client phone: {{4}}
Follow-up was due: {{5}}

Please follow up with this client as soon as possible.
```

Sample values for approval: {{1}} Saravanan · {{2}} LD-0491 · {{3}} Harish ·
{{4}} 9980107172 · {{5}} 12-08-2026, 02:30 PM

The code fills: {{1}} manager name, {{2}} Lead ID, {{3}} client name, {{4}} client phone,
{{5}} follow-up date/time. If you change the wording, keep the 5 variables in this order.

## 2. Set backend environment variables (Render → the Manager API service → Environment)
See `.env.whatsapp.example`. Required: `WA_PHONE_NUMBER_ID`, `WA_ACCESS_TOKEN`,
`WA_CRON_SECRET`. Set `WA_API_VERSION` to a current version (v27.0+ once v26.0 is retired
on 24 Sep 2026). These live ONLY in the backend — never in any frontend.

## 3. Give managers a WhatsApp number + opt-in
Each Manager/BDE needs a number on file AND opt-in = true, or they are skipped (and logged).
Two ways (pick either):

**A) Per-manager API call** (no DB access needed) — send the shared secret:
```
curl -X POST "https://<MANAGER_API_HOST>/api/wa/managers/set" \
  -H "x-cron-key: <WA_CRON_SECRET>" -H "Content-Type: application/json" \
  -d '{"name":"Saravanan","whatsapp":"9845294041","optIn":true}'
```
Check status anytime (numbers masked):
```
curl "https://<MANAGER_API_HOST>/api/wa/managers" -H "x-cron-key: <WA_CRON_SECRET>"
```

**B) Env fallback map** — set `WA_MANAGER_NUMBERS` (JSON of name→number). A name listed
here is treated as admin-configured (implicit opt-in).

## 4. Set up the external cron (every 5–10 minutes)
Point any cron at this endpoint (Render Cron Job, cron-job.org, GitHub Actions schedule, etc.):
```
POST  https://<MANAGER_API_HOST>/api/wa/cron/overdue
Header:  x-cron-key: <WA_CRON_SECRET>
```
(or `...­/api/wa/cron/overdue?key=<WA_CRON_SECRET>` if the cron can't send headers.)
Schedule: `*/10 * * * *` (every 10 min) or `*/5 * * * *` (every 5 min).

Response is a JSON summary, e.g.
`{ "success":true, "overdue":12, "sent":9, "skipped":2, "failed":0, "alreadySent":1 }`.

## 5. Test
- Dry run (no sends): `GET /api/wa/overdue/preview` with the secret header → lists overdue leads.
- After the cron runs: `GET /api/wa/logs?limit=50` → sent/failed/skipped + Meta message id.

## Behavior guarantees
- **No duplicates**: one message per (lead, that follow-up instance, that assignee), keyed in
  the `whatsappnotifications` collection. Re-running the cron never resends a sent event.
- **Reassignment**: a new assignee is a new dedupe key → the NEW manager gets one message; the
  OLD manager is never re-notified for that lead.
- **Reschedule**: a new follow-up date is a new event → one fresh alert when it becomes overdue.
- **Missing number/opt-in**: skipped and logged (status `skipped`), never sent.
- **Stored status**: every attempt is recorded with status (`sent`/`failed`/`skipped`) and the
  Meta `wamid` message id in the `whatsappnotifications` collection.

## 2026 pricing (Meta WhatsApp Cloud API)
Per-delivered-message pricing. These are **Utility**-category template messages
(business-initiated). As of Oct 1 2026, utility messages are charged at the market utility
rate even inside the 24-hour service window. India's utility rate is about **$0.0014 per
delivered message** — e.g. ~100 overdue alerts/day ≈ $0.14/day. Confirm your exact rate on
Meta's current rate card. Keeping the template **Utility** (not Marketing) is what keeps it
cheap and transactional.
