const mongoose = require('mongoose');

// Negotiation center (Manager-only). Flexible schema.
const NegotiationSchema = new mongoose.Schema(
  {
    id: { type: String, index: true },
    leadId: String,
    client: String,
    quoteId: String,
    quotedValue: String,
    targetValue: String,
    stage: { type: String, default: 'Open' },
    status: { type: String, default: 'In Negotiation' },
    nextAction: String,
  },
  { timestamps: true, strict: false }
);

module.exports = mongoose.model('Negotiation', NegotiationSchema);
