const mongoose = require('mongoose');

// One sales-pipeline opportunity for the Sales Pipeline page.
// Stored in MongoDB (no hardcoded seed data on the client).
const PipelineSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true }, // e.g. OP-1007
    customer: String,
    company: String,
    service: String,
    stage: { type: String, default: 'New' },       // New / Hot / Warm / Cold / Appointment Fixed / Lost
    assignedTo: String,
    expectedClose: String,
    value: { type: Number, default: 0 },
    lastActivity: String,
    followUp: String,           // 'YYYY-MM-DD'
    manager: String,            // manager who created / owns the opportunity
  },
  { timestamps: true }
);

module.exports = mongoose.model('Pipeline', PipelineSchema);
