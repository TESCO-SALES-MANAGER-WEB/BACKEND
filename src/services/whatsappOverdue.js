// services/whatsappOverdue.js
// WhatsApp overdue-lead dispatcher (Meta Cloud API), driven by an EXTERNAL cron.
//
// This does NOT replace or modify the existing in-app notification / overdue / follow-up /
// assignment logic (notificationSync.js is untouched). It is an additional delivery channel:
// it reads the SAME shared `leads` collection and the SAME manager accounts, applies the
// SAME "overdue" definition the Manager UI uses, and sends a WhatsApp Utility template to
// the assigned Manager/BDE — de-duplicated per overdue event + assignee.
//
// Overdue (matches the UI's getFollowUpState === 'overdue', but only for a REAL scheduled
// follow-up that has passed): a lead whose follow-up date/time is in the past, the call is
// not marked done, the lead is still open (not junk/lost/completed/order confirmed), and it
// is assigned to a known manager. Leads with NO follow-up date are intentionally NOT
// WhatsApp'd (there is no "Follow-up Date/Time" to report and it would be noise).

const Lead = require('../models/Lead');
const User = require('../models/User');
const WA = require('../models/WhatsappNotification');
const { sendTemplate, normalizeNumber, isConfigured, cfg } = require('../utils/whatsapp');

const MAX_ATTEMPTS = 6;
// Safety valve: cap WhatsApp SENDS per cron run (0 = unlimited). Prevents a first run from
// blasting hundreds at once / tripping a new number's daily tier. Remaining overdue events
// are picked up on the next run (deduped, so never lost or duplicated).
const MAX_PER_RUN = Math.max(0, parseInt(process.env.WA_MAX_PER_RUN, 10) || 50);
const COOLDOWN_MS = 60 * 1000; // guard against overlapping cron runs double-sending

const clean = (v) => String(v == null ? '' : v).trim();
const has = (v) => clean(v) !== '';
const isUnassigned = (v) => !has(v) || /^unassigned$/i.test(clean(v));
const isClosedStatus = (s) => /junk|lost|completed|order\s*confirmed/i.test(clean(s));

// --- Follow-up parsing (mirrors the Manager frontend parseFollowUp), interpreted in IST ---
function parseFollowUp(v) {
  if (!v || typeof v !== 'string') return null;
  const s = v.trim();
  if (s === 'No Date' || s === 'Pending' || s === '') return null;
  let dPart = '', tPart = '', m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/))) { dPart = `${m[1]}-${m[2]}-${m[3]}`; tPart = `${m[4]}:${m[5]}`; }
  else if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) { dPart = `${m[1]}-${m[2]}-${m[3]}`; }
  else if ((m = s.match(/(\d{2})-(\d{2})-(\d{4})[,\s]+(\d{1,2}):(\d{2})\s*([AaPp][Mm])/))) { let h = parseInt(m[4], 10); const ap = m[6].toUpperCase(); if (ap === 'PM' && h !== 12) h += 12; if (ap === 'AM' && h === 12) h = 0; dPart = `${m[3]}-${m[2]}-${m[1]}`; tPart = `${String(h).padStart(2, '0')}:${m[5]}`; }
  else if ((m = s.match(/(\d{2})-(\d{2})-(\d{4})[,\s]+(\d{2}):(\d{2})/))) { dPart = `${m[3]}-${m[2]}-${m[1]}`; tPart = `${m[4]}:${m[5]}`; }
  else if ((m = s.match(/(\d{2})-(\d{2})-(\d{4})/))) { dPart = `${m[3]}-${m[2]}-${m[1]}`; }
  else { const d = new Date(s); if (!isNaN(d.getTime())) { dPart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; tPart = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; } }
  if (!dPart) return null;
  return { dPart, tPart };
}

// Absolute deadline in ms. Date-only follow-ups use end-of-day 23:59 (same as the UI).
// Interpreted in IST (+05:30) so "overdue" matches India wall-clock regardless of the
// server's timezone (Render runs in UTC).
function followUpMillisIST(v) {
  const p = parseFollowUp(v);
  if (!p) return null;
  const ms = new Date(`${p.dPart}T${p.tPart || '23:59'}:00+05:30`).getTime();
  return isNaN(ms) ? null : ms;
}

// "12-08-2026, 02:30 PM" (or date only). For the WhatsApp message + logs.
function fmtFollowUp(v) {
  const p = parseFollowUp(v);
  if (!p) return clean(v);
  const [y, mo, d] = p.dPart.split('-');
  const dateStr = `${d}-${mo}-${y}`;
  if (!p.tPart) return dateStr;
  let h = parseInt(p.tPart.slice(0, 2), 10);
  const mm = p.tPart.slice(3, 5);
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return `${dateStr}, ${String(h).padStart(2, '0')}:${mm} ${ap}`;
}

// Optional env fallback map of manager NAME -> number, for numbers not stored on the user
// doc. JSON, e.g. WA_MANAGER_NUMBERS={"Saravanan":"9198XXXXXXXX","Akash":"9197XXXXXXXX"}.
// A name present here is treated as admin-configured (implicit opt-in).
function envNumberMap() {
  try { const o = JSON.parse(process.env.WA_MANAGER_NUMBERS || '{}'); return (o && typeof o === 'object') ? o : {}; }
  catch (_) { return {}; }
}

// Resolve a manager's WhatsApp recipient. Returns { number } when sendable, or
// { skip:true, reason } when the number/opt-in is missing (caller logs + skips WhatsApp).
async function resolveRecipient(managerName, userByName, envMap) {
  const key = clean(managerName).toLowerCase();
  const u = userByName.get(key);
  if (u && has(u.whatsapp) && u.whatsappOptIn === true) {
    const num = normalizeNumber(u.whatsapp);
    if (num) return { number: num };
    return { skip: true, reason: 'invalid number on user record' };
  }
  // env fallback (admin-configured => opted in)
  const envNum = envMap[clean(managerName)] || envMap[key];
  if (has(envNum)) {
    const num = normalizeNumber(envNum);
    if (num) return { number: num };
    return { skip: true, reason: 'invalid number in WA_MANAGER_NUMBERS' };
  }
  if (u && has(u.whatsapp) && u.whatsappOptIn !== true) return { skip: true, reason: 'manager has not opted in to WhatsApp' };
  return { skip: true, reason: 'no WhatsApp number on file' };
}

// Find all currently-overdue, still-open, assigned leads.
async function scanOverdue() {
  const now = Date.now();
  const leads = await Lead.find().lean();
  const out = [];
  for (const l of leads) {
    const mgr = clean(l.manager);
    if (isUnassigned(mgr)) continue;
    if (l.followUpDone) continue;
    if (isClosedStatus(l.status)) continue;
    const ms = followUpMillisIST(l.followUp);
    if (ms == null) continue;          // no scheduled follow-up -> not a WhatsApp overdue event
    if (ms >= now) continue;           // still upcoming
    out.push({
      leadId: clean(l.id || l._id),
      leadName: clean(l.name),
      clientPhone: clean(l.phone),
      manager: mgr,
      followUp: clean(l.followUp),
      followUpAt: new Date(ms),
      followUpDisplay: fmtFollowUp(l.followUp),
    });
  }
  return out;
}

// Build the ordered template body params. MUST match the approved template placeholders:
//   {{1}} Manager/BDE name   {{2}} Lead ID   {{3}} Client Name
//   {{4}} Client Phone       {{5}} Follow-up Date/Time
function bodyParamsFor(item) {
  return [item.manager, item.leadId, item.leadName, item.clientPhone, item.followUpDisplay];
}

async function dispatchOverdue() {
  const summary = { configured: isConfigured(), scanned: 0, overdue: 0, sent: 0, failed: 0, skipped: 0, alreadySent: 0 };

  const overdue = await scanOverdue();
  summary.overdue = overdue.length;

  // Preload manager accounts once (Sales Manager role = Managers AND BDEs).
  const mgrUsers = await User.find({ role: 'Sales Manager' }).select('name whatsapp whatsappOptIn isActive').lean();
  const userByName = new Map(mgrUsers.map((u) => [clean(u.name).toLowerCase(), u]));
  const envMap = envNumberMap();
  const { templateName } = cfg();
  summary.scanned = mgrUsers.length;

  for (const item of overdue) {
    if (MAX_PER_RUN && (summary.sent + summary.failed) >= MAX_PER_RUN) { summary.deferred = (summary.deferred || 0) + 1; continue; }
    // dedupeKey: one WhatsApp per (lead, this follow-up instance, this assignee). A reschedule
    // changes followUpAt => new event; a reassignment changes manager => the NEW manager gets
    // one and the OLD one is never re-notified.
    const fuInstance = item.followUpAt ? item.followUpAt.toISOString() : item.followUp;
    const dedupeKey = `wa-overdue:${item.leadId}:${fuInstance}:${clean(item.manager).toLowerCase()}`;

    const existing = await WA.findOne({ dedupeKey }).lean();
    if (existing && existing.status === 'sent') { summary.alreadySent++; continue; }
    if (existing && existing.status === 'failed' && (existing.attempts || 0) >= MAX_ATTEMPTS) { continue; }
    if (existing && existing.lastAttemptAt && (Date.now() - new Date(existing.lastAttemptAt).getTime() < COOLDOWN_MS)) { continue; }

    const rcpt = await resolveRecipient(item.manager, userByName, envMap);
    const baseInsert = {
      dedupeKey, event: 'LEAD_OVERDUE', leadId: item.leadId, leadName: item.leadName,
      clientPhone: item.clientPhone, followUp: item.followUp, followUpAt: item.followUpAt,
    };

    if (rcpt.skip) {
      // Log + skip WhatsApp (never retried into a send; recorded for visibility).
      try {
        await WA.updateOne(
          { dedupeKey, status: { $ne: 'sent' } },
          { $setOnInsert: baseInsert, $set: { manager: item.manager, status: 'skipped', skipReason: rcpt.reason, templateName, lastAttemptAt: new Date() }, $inc: { attempts: 1 } },
          { upsert: true }
        );
      } catch (e) { if (!(e && e.code === 11000)) throw e; }
      console.warn(`[wa-overdue] skipped lead ${item.leadId} -> ${item.manager}: ${rcpt.reason}`);
      summary.skipped++;
      continue;
    }

    // Atomically claim the event (never touches an already-sent doc) before sending.
    let claim;
    try {
      claim = await WA.findOneAndUpdate(
        { dedupeKey, status: { $ne: 'sent' } },
        { $setOnInsert: baseInsert, $set: { manager: item.manager, toNumber: rcpt.number, templateName, status: 'pending', lastAttemptAt: new Date() }, $inc: { attempts: 1 } },
        { upsert: true, new: true }
      );
    } catch (e) {
      if (e && e.code === 11000) { summary.alreadySent++; continue; } // concurrent run already handling/sent
      throw e;
    }

    const result = await sendTemplate({ to: rcpt.number, bodyParams: bodyParamsFor(item), templateName });
    if (result.ok) {
      await WA.updateOne({ _id: claim._id }, { $set: { status: 'sent', metaMessageId: result.messageId || '', toNumber: result.toNumber || rcpt.number, error: '', sentAt: new Date() } });
      summary.sent++;
    } else {
      await WA.updateOne({ _id: claim._id }, { $set: { status: 'failed', error: result.error || 'send failed' } });
      console.warn(`[wa-overdue] FAILED lead ${item.leadId} -> ${item.manager}: ${result.error}`);
      summary.failed++;
    }
  }

  return summary;
}

module.exports = { dispatchOverdue, scanOverdue, followUpMillisIST, parseFollowUp, fmtFollowUp };
