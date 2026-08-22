const Notification = require('../models/Notification');
const Lead = require('../models/Lead');
const Appointment = require('../models/Appointment');
const Quotation = require('../models/Quotation');
const Payment = require('../models/Payment');
const Order = require('../models/Order');

// --- Small formatting helpers (no invented data — read real fields only) -------------

const toDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

// Best real event time available on a source doc.
const eventTime = (doc, ...prefer) => {
  for (const v of prefer) {
    const d = toDate(v);
    if (d) return d;
  }
  return toDate(doc.updatedAt) || toDate(doc.createdAt) || new Date();
};

// "2026-08-12" / ISO -> "12 Aug"
const shortDate = (v) => {
  const d = toDate(v);
  if (!d) return String(v || '').trim();
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

// 850000 / "₹8,50,000" -> "₹8,50,000"
const money = (v) => {
  if (v == null || v === '') return '';
  let s = String(v).toLowerCase().replace(/[₹,\s]/g, '');
  let x = 1;
  if (s.endsWith('cr')) { x = 1e7; s = s.slice(0, -2); }
  else if (s.endsWith('l')) { x = 1e5; s = s.slice(0, -1); }
  else if (s.endsWith('k')) { x = 1e3; s = s.slice(0, -1); }
  const n = parseFloat(s.replace(/[^0-9.]/g, ''));
  if (Number.isNaN(n)) return '';
  return '₹' + Math.round(n * x).toLocaleString('en-IN');
};

const has = (v) => v != null && String(v).trim() !== '';
const isUnassigned = (v) => !has(v) || /^unassigned$/i.test(String(v).trim());
const clean = (v) => String(v == null ? '' : v).trim();

// Throttle: the sync is called on every notifications load + 30s poll. Keep it cheap by
// running the full scan at most once every WINDOW_MS; between runs, loads just read the
// already-synced docs. Idempotent either way (upsert on dedupeKey).
const WINDOW_MS = 15 * 1000;
let lastSyncAt = 0;
let inFlight = null;

async function runSync() {
  const [leads, appts, quotes, payments, orders] = await Promise.all([
    Lead.find().lean(),
    Appointment.find().lean(),
    Quotation.find().lean(),
    Payment.find().lean(),
    Order.find().lean()
  ]);

  // Map a lead code (LD-xxxx) -> owning manager name, so appointment/quotation/payment/
  // order events (which reference a lead) can be attributed to the right manager.
  const leadManager = new Map();
  for (const l of leads) {
    const code = clean(l.id || l._id);
    const mgr = clean(l.manager);
    if (code && !isUnassigned(mgr)) leadManager.set(code, mgr);
  }

  const ops = [];
  // This app delivers only to the Sales Manager role, and per-manager via recipientName.
  // Prefix every dedupeKey with `mgr:<manager>:` so the shared collection never collides
  // with Sales Head (`head:`) or Coordinator (`coord:`) docs for the same business event.
  const add = (manager, dedupeKey, doc) => {
    const mgr = clean(manager);
    if (isUnassigned(mgr)) return; // only ever attribute to a known manager
    const key = `mgr:${mgr}:${dedupeKey}`;
    ops.push({
      updateOne: {
        filter: { dedupeKey: key },
        // $setOnInsert so re-scanning never overwrites an already-read notification.
        update: {
          $setOnInsert: {
            dedupeKey: key,
            recipientRole: 'Sales Manager',
            recipientName: mgr,
            isRead: false,
            ...doc
          }
        },
        upsert: true
      }
    });
  };

  // --- Leads: assignment + status progression ---------------------------------------
  for (const l of leads) {
    const code = clean(l.id || l._id);
    const mgr = clean(l.manager);
    if (!code || isUnassigned(mgr)) continue;

    add(mgr, `lead-assigned:${code}`, {
      type: 'LEAD_ASSIGNED',
      title: 'New Lead Assigned',
      message: `Lead ${code} has been assigned to you.`,
      entityType: 'lead',
      entityId: code,
      eventAt: eventTime(l, l.createdAt)
    });

    // Only meaningful stage changes — never the initial "New Lead" creation state.
    const status = clean(l.status);
    if (status && !/^new(\s*lead)?s?$/i.test(status) && !/^received$/i.test(status)) {
      add(mgr, `lead-status:${code}:${status}`, {
        type: 'LEAD_STATUS_CHANGED',
        title: 'Lead Status Updated',
        message: `Lead ${code} moved to ${status}.`,
        entityType: 'lead',
        entityId: code,
        eventAt: eventTime(l)
      });
    }
  }

  // --- Appointments: scheduled / rescheduled / completed ----------------------------
  // Appointments carry `manager` directly; fall back to the owning manager of the lead.
  for (const a of appts) {
    const mgr = clean(a.manager) || (has(a.leadId) ? leadManager.get(clean(a.leadId)) : '');
    if (isUnassigned(mgr)) continue;
    const ref = has(a.leadId) ? `Lead ${clean(a.leadId)}` : (clean(a.title) || 'the lead');
    const when = [shortDate(a.date), clean(a.timeStart)].filter(has).join(', ');

    if (has(a.date)) {
      add(mgr, `appt-sched:${a._id}:${clean(a.date)}`, {
        type: 'APPOINTMENT_SCHEDULED',
        title: 'Appointment Scheduled',
        message: `An appointment has been scheduled for ${ref}${when ? ` on ${when}` : ''}.`,
        entityType: 'appointment',
        entityId: String(a._id),
        eventAt: eventTime(a, a.createdAt)
      });
    }

    if (has(a.rescheduledAt)) {
      add(mgr, `appt-resched:${a._id}:${clean(a.rescheduledAt)}`, {
        type: 'APPOINTMENT_RESCHEDULED',
        title: 'Appointment Rescheduled',
        message: `The appointment for ${ref} has been rescheduled${when ? ` to ${when}` : ''}.`,
        entityType: 'appointment',
        entityId: String(a._id),
        eventAt: eventTime(a, a.rescheduledAt)
      });
    }

    const completed = /complet/i.test(clean(a.status)) ||
      /^completed$/i.test(clean(a.progressStatus)) || has(a.completedAt);
    if (completed) {
      add(mgr, `visit-completed:${a._id}:${clean(a.completedAt || a.date)}`, {
        type: 'VISIT_COMPLETED',
        title: 'Visit Completed',
        message: `The site visit for ${ref} has been marked completed.`,
        entityType: 'appointment',
        entityId: String(a._id),
        eventAt: eventTime(a, a.completedAt)
      });
    }
  }

  // --- Quotations: uploaded (Prepared) / approved / rejected ------------------------
  // Attributed to the owning manager of the referenced lead.
  for (const q of quotes) {
    const id = clean(q.id || q._id);
    if (!id) continue;
    const mgr = has(q.leadId) ? leadManager.get(clean(q.leadId)) : '';
    if (isUnassigned(mgr)) continue;
    const forRef = has(q.leadId) ? `Lead ${clean(q.leadId)}` : (clean(q.client) || 'the client');
    const qStatus = clean(q.quotationStatus).toLowerCase();
    const aStatus = clean(q.approvalStatus).toLowerCase();

    if (qStatus === 'prepared' && aStatus !== 'approved' && aStatus !== 'rejected') {
      add(mgr, `quotation-uploaded:${id}`, {
        type: 'QUOTATION_UPLOADED',
        title: 'Quotation Uploaded',
        message: `Quotation ${id} for ${forRef} is ready.`,
        entityType: 'quotation',
        entityId: id,
        eventAt: eventTime(q)
      });
    }
    if (aStatus === 'approved') {
      add(mgr, `quotation-approved:${id}`, {
        type: 'QUOTATION_APPROVED',
        title: 'Quotation Approved',
        message: `The quotation for ${forRef} has been approved.`,
        entityType: 'quotation',
        entityId: id,
        eventAt: eventTime(q, q.reviewedAt)
      });
    }
    if (aStatus === 'rejected') {
      add(mgr, `quotation-rejected:${id}`, {
        type: 'QUOTATION_REJECTED',
        title: 'Quotation Rejected',
        message: `The quotation for ${forRef} has been rejected${has(q.rejectionReason) ? ` — ${clean(q.rejectionReason)}` : ''}.`,
        entityType: 'quotation',
        entityId: id,
        eventAt: eventTime(q, q.reviewedAt)
      });
    }
  }

  // --- Orders: order confirmed ------------------------------------------------------
  // Attributed to the owning manager of the referenced lead.
  for (const o of orders) {
    const id = clean(o.id || o._id);
    if (!id) continue;
    const mgr = has(o.leadId) ? leadManager.get(clean(o.leadId)) : '';
    if (isUnassigned(mgr)) continue;
    const forRef = has(o.leadId) ? `Lead ${clean(o.leadId)}` : (clean(o.client) || 'the client');
    add(mgr, `order-confirmed:${id}`, {
      type: 'ORDER_CONFIRMED',
      title: 'Order Confirmed',
      message: `Order for ${forRef} has been confirmed.`,
      entityType: 'order',
      entityId: id,
      eventAt: eventTime(o, o.orderDate)
    });
  }

  // --- Payments: payment received / updated -----------------------------------------
  // Payments carry `manager`/`salesperson`; fall back to the owning manager of the lead.
  for (const pay of payments) {
    const id = clean(pay.id || pay._id);
    const collected = Number(pay.amountCollected) || 0;
    if (!id || collected <= 0) continue;
    const mgr = clean(pay.manager) || clean(pay.salesperson) ||
      (has(pay.leadId) ? leadManager.get(clean(pay.leadId)) : '');
    if (isUnassigned(mgr)) continue;
    const forRef = has(pay.leadId)
      ? `Lead ${clean(pay.leadId)}`
      : (clean(pay.customer) || clean(pay.clientName) || 'the customer');
    add(mgr, `payment-received:${id}:${collected}`, {
      type: 'PAYMENT_RECEIVED',
      title: 'Payment Received',
      message: `Payment of ${money(collected)} has been recorded for ${forRef}.`,
      entityType: 'payment',
      entityId: id,
      eventAt: eventTime(pay, pay.paymentDate)
    });
  }

  if (ops.length) {
    // ordered:false so one duplicate-key race can't abort the rest of the batch.
    await Notification.bulkWrite(ops, { ordered: false }).catch((e) => {
      // Duplicate-key errors are expected/benign under concurrency — swallow only those.
      if (!e || e.code !== 11000) throw e;
    });
  }
}

// Idempotent, throttled sync. Safe to await at the start of GET handlers.
async function syncNotifications({ force = false } = {}) {
  if (!force && Date.now() - lastSyncAt < WINDOW_MS) return;
  if (inFlight) return inFlight;
  inFlight = runSync()
    .then(() => { lastSyncAt = Date.now(); })
    .catch((e) => { console.error('notificationSync error:', e.message); })
    .finally(() => { inFlight = null; });
  return inFlight;
}

module.exports = { syncNotifications };
