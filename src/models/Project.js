const mongoose = require('mongoose');

// Same schema/collection as the Coordinator CRM.
const ProjectSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true }, // e.g. PRJ-901
    client: String,
    type: String,
    quote: String,
    team: String,
    status: { type: String, default: 'Project File Created' },
    files: { type: Number, default: 0 },
    // Order Confirmation / handover progress (persisted to MongoDB)
    checklist: { type: mongoose.Schema.Types.Mixed, default: {} },
    warrantyStatus: { type: String, default: 'Not Started' },
  },
  { timestamps: true, strict: false }
);

module.exports = mongoose.model('Project', ProjectSchema);
