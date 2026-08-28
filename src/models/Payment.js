const mongoose = require('mongoose');

// One invoice / payment record for the Payment Collection page.
// Shares the SAME collection as the Coordinator CRM so records appear in both apps.
// All monetary fields are numeric so KPI totals can be computed from real data.
const PaymentSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true }, // e.g. INV-1024
    leadId: String,            // optional link back to a lead
    customer: String,          // customer name
    orderValue: { type: Number, default: 0 },
    amountCollected: { type: Number, default: 0 },
    pendingPayments: { type: Number, default: 0 },
    upcomingDues: { type: Number, default: 0 },
    overduePayments: { type: Number, default: 0 },
    invoiceValue: { type: Number, default: 0 },
    dueDate: String,           // 'YYYY-MM-DD'
    method: { type: String, default: '' }, // Bank Transfer / Cheque / Cash / UPI / ...
    transactionId: { type: String, default: '' }, // TXN / cheque number
    paymentDate: String,       // 'YYYY-MM-DD' — when the payment was received
    notes: { type: String, default: '' }, // payment notes & remarks
    manager: String,           // salesperson / manager
    status: String,            // optional stored status; derived on the client when absent

    // ── Payment Collection detail drawer — billing & client details ──
    clientName: { type: String, default: '' },
    projectLocation: { type: String, default: '' },
    contactDetails: { type: String, default: '' },
    billingName: { type: String, default: '' },
    mobileNumber: { type: String, default: '' },
    altMobile: { type: String, default: '' },
    siteAddress: { type: String, default: '' },
    billingAddress: { type: String, default: '' },
    gstNumber: { type: String, default: '' },
    email: { type: String, default: '' },
    salesperson: { type: String, default: '' },

    // ── Upload Invoice (stored inline as base64) ──
    invoiceFileName: { type: String, default: '' },
    invoiceFileData: { type: String, default: '' }, // data URL / base64

    // ── Timeline + notes log + reminder ──
    timeline: { type: Array, default: [] },   // [{ label, date }]
    notesLog: { type: Array, default: [] },   // [{ text, timestamp }]
    reminderSentAt: { type: String, default: '' },
  },
  { timestamps: true, strict: false }
);

module.exports = mongoose.model('Payment', PaymentSchema);
