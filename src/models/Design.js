const mongoose = require('mongoose');

// Design coordination (Manager-only). Flexible schema.
const DesignSchema = new mongoose.Schema(
  {
    id: { type: String, index: true },
    leadId: String,
    client: String,
    project: String,
    designer: String,
    stage: { type: String, default: 'Concept' },
    status: { type: String, default: 'In Progress' },
    dueDate: String,
  },
  { timestamps: true, strict: false }
);

module.exports = mongoose.model('Design', DesignSchema);
