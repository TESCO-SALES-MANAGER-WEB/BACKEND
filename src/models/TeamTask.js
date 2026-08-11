const mongoose = require('mongoose');

// Team collaboration tasks (Manager-only). Flexible schema.
const TeamTaskSchema = new mongoose.Schema(
  {
    id: { type: String, index: true },
    title: String,
    assignee: String,
    role: String,
    priority: { type: String, default: 'Medium' },
    status: { type: String, default: 'Pending' },
    dueDate: String,
  },
  { timestamps: true, strict: false }
);

module.exports = mongoose.model('TeamTask', TeamTaskSchema);
