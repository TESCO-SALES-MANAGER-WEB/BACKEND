// utils/push.js
// Expo push delivery for the mobile apps.
//
// This mirrors the in-app notifications: whenever notificationSync INSERTS a new
// Notification document, we resolve the recipient user(s)' registered Expo push
// tokens and send a system (tray) notification via Expo's push service, which
// delivers through FCM on Android.
//
// Tokens are stored on the User document (User.pushTokens[]). A device registers
// its token on login (POST /api/auth/push-token) and clears it on logout.
const User = require('../models/User');

const EXPO_URL = 'https://exp.host/--/api/v2/push/send';
const isExpoToken = (t) =>
  typeof t === 'string' && /^Expo(nent)?PushToken\[/.test(t);

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// POST messages to Expo in batches of <=100. Returns a tickets array the SAME
// length/order as `messages` (missing entries are null) so callers can map a
// ticket back to the token that produced it.
async function postToExpo(messages) {
  const tickets = [];
  if (typeof fetch !== 'function') {
    console.warn('[push] global fetch unavailable (Node < 18) — skipping push send');
    return messages.map(() => null);
  }
  for (const batch of chunk(messages, 100)) {
    let data = [];
    try {
      const res = await fetch(EXPO_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(batch),
      });
      const json = await res.json().catch(() => null);
      if (json && Array.isArray(json.data)) data = json.data;
    } catch (e) {
      console.warn('[push] Expo send failed:', e && e.message);
    }
    for (let i = 0; i < batch.length; i++) tickets.push(data[i] || null);
  }
  return tickets;
}

// Resolve the unique Expo tokens for a recipient scope.
// recipientName set  -> that one person (per-manager delivery).
// recipientName null -> everyone holding that role (role-wide delivery).
async function tokensFor(recipientRole, recipientName) {
  const q = { role: recipientRole, isActive: true };
  if (recipientName) q.name = recipientName;
  const users = await User.find(q).select('pushTokens').lean();
  const tokens = [];
  for (const u of users) for (const t of u.pushTokens || []) if (isExpoToken(t)) tokens.push(t);
  return Array.from(new Set(tokens));
}

// Fire system pushes for freshly-inserted notification docs. Each `doc` is the
// `$setOnInsert` payload from notificationSync (recipientRole / recipientName /
// title / message / type / entityType / entityId). Never throws.
async function notifyNewDocs(docs) {
  try {
    if (!Array.isArray(docs) || docs.length === 0) return;
    const messages = [];
    const cache = new Map();
    for (const d of docs) {
      if (!d || !d.title) continue;
      const key = `${d.recipientRole}|${d.recipientName || ''}`;
      let tokens = cache.get(key);
      if (!tokens) { tokens = await tokensFor(d.recipientRole, d.recipientName); cache.set(key, tokens); }
      for (const to of tokens) {
        messages.push({
          to,
          title: d.title,
          body: d.message,
          sound: 'default',
          priority: 'high',
          channelId: 'default',
          data: { type: d.type, entityType: d.entityType, entityId: d.entityId },
        });
      }
    }
    if (!messages.length) return;
    const tickets = await postToExpo(messages);
    // Prune tokens Expo reports as no longer valid so we stop sending to dead devices.
    const dead = [];
    tickets.forEach((t, i) => {
      if (t && t.status === 'error' && t.details && t.details.error === 'DeviceNotRegistered') {
        const to = messages[i] && messages[i].to;
        if (to) dead.push(to);
      }
    });
    if (dead.length) {
      await User.updateMany(
        { pushTokens: { $in: dead } },
        { $pull: { pushTokens: { $in: dead } } }
      ).catch((e) => console.warn('[push] token prune failed:', e && e.message));
    }
  } catch (e) {
    console.warn('[push] notifyNewDocs error:', e && e.message);
  }
}

module.exports = { notifyNewDocs, tokensFor, sendExpoPush: postToExpo };
