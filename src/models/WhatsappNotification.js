const mongoose = require('mongoose');

// Persisted WhatsApp send log + de-duplication for OVERDUE-lead alerts.
// One document per unique overdue event per recipient (dedupeKey), so the external cron
// can run every few minutes without ever sending a duplicate WhatsApp for the same event.
// This is a SEPARATE delivery log from the in-app `notifications` collection — it does not
// change or duplicate the existing in-app/overdue/follow-up logic; it only records what was
// sent over WhatsApp and the Meta message id / status.
const WhatsappNotificationSchema = new mongoose.Schema(
  {
    // Stable idempotency key: `wa-overdue:<leadId>:<followUpInstance>:<manager>`.
    // Includes the follow-up instance (so a reschedule is a new event) AND the manager
    // (so a reassignment notifies the NEW manager once, and never re-notifies the old one).
    dedupeKey: { type: String, unique: true, required: true },

    event: { type: String, default: 'LEAD_OVERDUE' },
    leadId: { type: String, index: true },     // business id (LD-xxxx)
    leadName: { type: String, default: '' },
    clientPhone: { type: String, default: '' },
    followUp: { type: String, default: '' },    // the stored follow-up value at send time
    followUpAt: { type: Date },                 // parsed absolute instant (IST)

    manager: { type: String, index: true },     // assignee NAME at send time
    toNumber: { type: String, default: '' },     // normalized recipient (digits, country code)

    templateName: { type: String, default: '' },

    // pending -> claimed, about to send; sent -> Meta accepted; failed -> Meta/API error;
    // skipped -> no number / not opted in (logged, never retried).
    status: { type: String, enum: ['pending', 'sent', 'failed', 'skipped'], default: 'pending', index: true },
    metaMessageId: { type: String, default: '' }, // wamid.* returned by Meta
    error: { type: String, default: '' },
    skipReason: { type: String, default: '' },

    attempts: { type: Number, default: 0 },
    lastAttemptAt: { type: Date },
    sentAt: { type: Date },
  },
  { timestamps: true }
);

WhatsappNotificationSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('WhatsappNotification', WhatsappNotificationSchema);
