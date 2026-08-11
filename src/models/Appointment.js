const mongoose = require('mongoose');

// Same schema/collection as the Coordinator CRM.
const AppointmentSchema = new mongoose.Schema(
  {
    title: String,
    date: String, // 'YYYY-MM-DD'
    timeStart: String, // '04:00 PM'
    timeEnd: String, // '05:00 PM'
    manager: String,
    phone: String,
    location: String,
    status: { type: String, default: 'Waiting' },
    type: { type: String, default: 'Appointment' },
  },
  // strict:false lets the Manager app persist its richer visit fields
  // (progressStatus, measurementNote, visitType, etc.) on the same collection.
  { timestamps: true, strict: false }
);

module.exports = mongoose.model('Appointment', AppointmentSchema);
