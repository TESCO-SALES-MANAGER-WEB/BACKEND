const mongoose = require('mongoose');

// Persisted, de-duplicated business notifications for the Sales Manager app.
// Docs are UPSERTED by the notificationSync service off the real shared collections
// (leads, appointments, quotations, payments, orders), keyed by a stable `dedupeKey`
// so re-scanning on every load produces NO duplicates and never resets read state.
const NotificationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [
        'LEAD_ASSIGNED',
        'LEAD_STATUS_CHANGED',
        'APPOINTMENT_SCHEDULED',
        'APPOINTMENT_RESCHEDULED',
        'VISIT_COMPLETED',
        'QUOTATION_UPLOADED',
        'QUOTATION_APPROVED',
        'QUOTATION_REJECTED',
        'ORDER_CONFIRMED',
        'PAYMENT_RECEIVED',
        'PAYMENT_UPDATED'
      ],
      required: true
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    entityType: String, // 'lead' | 'appointment' | 'quotation' | 'payment' | 'order'
    entityId: String,   // the business id (LD-xxxx / QT-xxxx / INV-xxxx / _id)
    // Role-based delivery — a notification only appears for its intended recipient role.
    // Shared `notifications` collection across the Sales Head / Manager / Coordinator apps,
    // so every app filters by its own recipientRole (and recipientName for per-manager).
    recipientRole: {
      type: String,
      enum: ['Sales Head', 'Sales Manager', 'Sales Coordinator'],
      required: true,
      index: true
    },
    recipientName: { type: String, default: null }, // per-person delivery (managers)
    // Stable, idempotent key per real business event. Unique so upserts never duplicate.
    // Prefixed by recipient scope (e.g. `head:` / `mgr:<name>:` / `coord:`) so the same
    // business event can create one doc per recipient without key collisions.
    dedupeKey: { type: String, unique: true, sparse: true },
    // Real event time (source doc updatedAt/createdAt) — used to order newest-first.
    eventAt: { type: Date, default: Date.now },
    isRead: { type: Boolean, default: false },
    readAt: Date
  },
  { timestamps: true }
);

// Newest-first ordering by real event time, scoped per recipient.
NotificationSchema.index({ recipientRole: 1, recipientName: 1, eventAt: -1 });

module.exports = mongoose.model('Notification', NotificationSchema);
