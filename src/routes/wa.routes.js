// routes/wa.routes.js
// WhatsApp overdue-lead endpoints. ALL endpoints require a shared secret (env WA_CRON_SECRET)
// passed as header `x-cron-key: <secret>` or query `?key=<secret>`. No Meta credentials are
// ever returned to any client.
const router = require('express').Router();
const User = require('../models/User');
const WA = require('../models/WhatsappNotification');
const { dispatchOverdue, scanOverdue } = require('../services/whatsappOverdue');
const { isConfigured, normalizeNumber } = require('../utils/whatsapp');

// --- auth guard: shared secret only (no user session; this is for the external cron) ---
function requireCronSecret(req, res, next) {
  const expected = process.env.WA_CRON_SECRET || '';
  const got = req.get('x-cron-key') || req.query.key || '';
  if (!expected) return res.status(503).json({ success: false, message: 'WA_CRON_SECRET not set on the server' });
  if (String(got) !== String(expected)) return res.status(403).json({ success: false, message: 'Forbidden' });
  next();
}

// POST /api/wa/cron/overdue — the EXTERNAL cron hits this every 5–10 minutes.
// Scans overdue leads and sends one WhatsApp per new overdue event to the assigned
// Manager/BDE. Idempotent (deduped), safe to call repeatedly.
router.post('/cron/overdue', requireCronSecret, async (req, res) => {
  try {
    const summary = await dispatchOverdue();
    res.json({ success: true, ...summary, at: new Date().toISOString() });
  } catch (e) {
    console.error('[wa-overdue] cron error:', e && e.message);
    res.status(500).json({ success: false, message: e && e.message });
  }
});

// GET /api/wa/overdue/preview — dry run: what WOULD be considered overdue right now
// (no messages sent). Useful to validate the overdue set before/while wiring the cron.
router.get('/overdue/preview', requireCronSecret, async (req, res) => {
  try {
    const list = await scanOverdue();
    res.json({ success: true, configured: isConfigured(), count: list.length, leads: list });
  } catch (e) {
    res.status(500).json({ success: false, message: e && e.message });
  }
});

// GET /api/wa/managers — manager WhatsApp configuration status (number MASKED).
router.get('/managers', requireCronSecret, async (req, res) => {
  try {
    const users = await User.find({ role: 'Sales Manager' }).select('name whatsapp whatsappOptIn isActive').lean();
    const mask = (n) => { const d = String(n || '').replace(/\D/g, ''); return d ? `•••••${d.slice(-4)}` : ''; };
    res.json({
      success: true,
      configuredSender: isConfigured(),
      managers: users.map((u) => ({ name: u.name, isActive: u.isActive !== false, hasNumber: !!(u.whatsapp && u.whatsapp.trim()), optIn: u.whatsappOptIn === true, numberMasked: mask(u.whatsapp) })),
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e && e.message });
  }
});

// POST /api/wa/managers/set — set a Manager/BDE's WhatsApp number + opt-in (no Mongo access
// needed). Body: { name, whatsapp, optIn }. Matches the Sales Manager user by exact name.
router.post('/managers/set', requireCronSecret, async (req, res) => {
  try {
    const { name, whatsapp, optIn } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ success: false, message: 'name is required' });
    const set = {};
    if (whatsapp !== undefined) {
      const norm = normalizeNumber(whatsapp);
      if (whatsapp && !norm) return res.status(400).json({ success: false, message: `Invalid WhatsApp number: ${whatsapp}` });
      set.whatsapp = whatsapp ? norm : '';
    }
    if (optIn !== undefined) set.whatsappOptIn = !!optIn;
    if (!Object.keys(set).length) return res.status(400).json({ success: false, message: 'Provide whatsapp and/or optIn' });
    const u = await User.findOneAndUpdate(
      { role: 'Sales Manager', name: new RegExp('^' + String(name).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') },
      { $set: set },
      { new: true }
    ).select('name whatsapp whatsappOptIn').lean();
    if (!u) return res.status(404).json({ success: false, message: `No Sales Manager named "${name}"` });
    res.json({ success: true, manager: { name: u.name, hasNumber: !!u.whatsapp, optIn: u.whatsappOptIn === true } });
  } catch (e) {
    res.status(500).json({ success: false, message: e && e.message });
  }
});

// GET /api/wa/logs — recent WhatsApp send log (newest first) for monitoring/debugging.
router.get('/logs', requireCronSecret, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
    const logs = await WA.find().sort({ updatedAt: -1 }).limit(limit).lean();
    res.json({ success: true, count: logs.length, logs });
  } catch (e) {
    res.status(500).json({ success: false, message: e && e.message });
  }
});

module.exports = router;
