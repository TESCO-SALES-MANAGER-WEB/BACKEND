const mongoose = require('mongoose');

// Same schema/collection as the Coordinator CRM.
const QuotationSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true }, // e.g. QT-5001
    leadId: String,
    client: String,
    project: String,
    amount: String,
    gst: String,
    approvalStatus: { type: String, default: 'Pending' },
    quotationStatus: { type: String, default: 'In Preparation' },
    revision: { type: String, default: 'Rev 0' },
    fileName: { type: String, default: null },
    fileData: { type: String, default: null }, // base64 data URI of the uploaded PDF (for Sales Head review/download)
  },
  { timestamps: true }
);

module.exports = mongoose.model('Quotation', QuotationSchema);
