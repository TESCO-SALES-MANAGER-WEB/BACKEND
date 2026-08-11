const mongoose = require('mongoose');

// Orders & confirmations (Manager-only). Flexible schema.
const OrderSchema = new mongoose.Schema(
  {
    id: { type: String, index: true },
    leadId: String,
    client: String,
    project: String,
    value: String,
    orderDate: String,
    status: { type: String, default: 'Confirmed' },
  },
  { timestamps: true, strict: false }
);

module.exports = mongoose.model('Order', OrderSchema);
