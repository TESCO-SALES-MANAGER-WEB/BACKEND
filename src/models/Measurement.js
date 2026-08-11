const mongoose = require('mongoose');

// Site measurements (Manager-only). Flexible schema so the frontend payload persists as-is.
const MeasurementSchema = new mongoose.Schema(
  {
    id: { type: String, index: true },
    leadId: String,
    client: String,
    site: String,
    engineer: String,
    date: String,
    status: { type: String, default: 'Scheduled' },
  },
  { timestamps: true, strict: false }
);

module.exports = mongoose.model('Measurement', MeasurementSchema);
