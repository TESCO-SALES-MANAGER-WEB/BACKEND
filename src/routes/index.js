const router = require('express').Router();
const makeCrud = require('./crud');

const Lead = require('../models/Lead');
const Quotation = require('../models/Quotation');
const Appointment = require('../models/Appointment');
const Project = require('../models/Project');
const Measurement = require('../models/Measurement');
const Design = require('../models/Design');
const Negotiation = require('../models/Negotiation');
const Order = require('../models/Order');
const TeamTask = require('../models/TeamTask');
const Payment = require('../models/Payment');
const Pipeline = require('../models/Pipeline');

const notificationsRoutes = require('./notifications.routes');
const authRoutes = require('./auth.routes');
const waRoutes = require('./wa.routes');

router.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// Authentication (shared users collection) — used by the Manager web + mobile apps
router.use('/auth', authRoutes);

// Shared collections (same data as the Coordinator CRM)
// Next sequential lead id: LD-0018 after LD-0017. Only real sequential ids count —
// legacy timestamp ids (13-digit) are ignored so they never poison the sequence.
async function nextLeadId(Model) {
  const rows = await Model.find({ id: /^LD-\d+$/ }).select('id').lean();
  let max = 0;
  for (const r of rows) {
    const n = parseInt(String(r.id).replace(/\D/g, ''), 10);
    if (!Number.isNaN(n) && n < 1000000 && n > max) max = n;
  }
  return `LD-${String(max + 1).padStart(4, '0')}`;
}

router.use('/leads', makeCrud(Lead, { genId: nextLeadId, historyAppendOnly: true }));
router.use('/quotations', makeCrud(Quotation, { listExclude: '-fileData' }));
router.use('/appointments', makeCrud(Appointment, { idField: '_id' }));
router.use('/projects', makeCrud(Project));
router.use('/payments', makeCrud(Payment));

// Sales pipeline opportunities (stored in MongoDB)
router.use('/pipeline', makeCrud(Pipeline));

// Manager-only collections
router.use('/measurements', makeCrud(Measurement));
router.use('/designs', makeCrud(Design));
router.use('/negotiations', makeCrud(Negotiation));
router.use('/orders', makeCrud(Order));
router.use('/team', makeCrud(TeamTask));

// DB-backed, role-scoped (Sales Manager) per-manager notifications
router.use('/notifications', notificationsRoutes);

// WhatsApp overdue-lead alerts (Meta Cloud API) — hit by an EXTERNAL cron every 5-10 min.
// Secret-protected; adds a WhatsApp delivery channel on top of the existing in-app
// notifications (does not modify the overdue/follow-up/assignment logic).
router.use('/wa', waRoutes);

module.exports = router;
