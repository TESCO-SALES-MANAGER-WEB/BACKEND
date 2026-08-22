const router = require('express').Router();
const Notification = require('../models/Notification');
const { syncNotifications } = require('../services/notificationSync');

// This app only ever shows Sales Manager notifications from the shared collection, and
// only those addressed to the currently-logged-in manager. The frontend passes the
// manager's name via `?recipient=<name>` (GET) or `{ recipient }` (read-all body).
const roleScope = { recipientRole: 'Sales Manager' };
const scopeFor = (recipient) => ({ ...roleScope, recipientName: String(recipient || '').trim() });
const hasRecipient = (recipient) => String(recipient || '').trim() !== '';

// GET /api/notifications?recipient=<name> — newest-first list (limit 50) + unreadCount.
// Syncs from the real shared collections first so the list reflects current DB state.
router.get('/', async (req, res) => {
  try {
    await syncNotifications();
    const recipient = req.query.recipient;
    if (!hasRecipient(recipient)) return res.json({ notifications: [], unreadCount: 0 });
    const scope = scopeFor(recipient);
    const [notifications, unreadCount] = await Promise.all([
      Notification.find(scope).sort({ eventAt: -1, createdAt: -1 }).limit(50).lean(),
      Notification.countDocuments({ ...scope, isRead: false })
    ]);
    res.json({ notifications, unreadCount });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/notifications/unread-count?recipient=<name> — just the badge number.
router.get('/unread-count', async (req, res) => {
  try {
    await syncNotifications();
    const recipient = req.query.recipient;
    if (!hasRecipient(recipient)) return res.json({ unreadCount: 0 });
    const unreadCount = await Notification.countDocuments({ ...scopeFor(recipient), isRead: false });
    res.json({ unreadCount });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/notifications/:id/read?recipient=<name> — mark one notification read.
// Defense-in-depth: the doc must belong to this manager before it can be marked read.
router.patch('/:id/read', async (req, res) => {
  try {
    const recipient = req.query.recipient || (req.body && req.body.recipient);
    if (!hasRecipient(recipient)) return res.status(400).json({ message: 'recipient is required' });
    const notif = await Notification.findOneAndUpdate(
      { _id: req.params.id, ...scopeFor(recipient) },
      { $set: { isRead: true, readAt: new Date() } },
      { new: true }
    );
    if (!notif) return res.status(404).json({ message: 'Notification not found' });
    res.json({ success: true, notification: notif });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PATCH /api/notifications/read-all — mark all of this manager's unread notifications read.
router.patch('/read-all', async (req, res) => {
  try {
    const recipient = (req.body && req.body.recipient) || req.query.recipient;
    if (!hasRecipient(recipient)) return res.status(400).json({ message: 'recipient is required' });
    const result = await Notification.updateMany(
      { ...scopeFor(recipient), isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );
    res.json({ success: true, updated: result.modifiedCount || 0 });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
