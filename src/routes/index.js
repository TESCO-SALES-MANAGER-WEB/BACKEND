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

router.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// Authentication (shared users collection) — used by the Manager web + mobile apps
router.use('/auth', authRoutes);

// Shared collections (same data as the Coordinator CRM)
router.use('/leads', makeCrud(Lead));
router.use('/quotations', makeCrud(Quotation));
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

module.exports = router;
