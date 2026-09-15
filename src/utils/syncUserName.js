// utils/syncUserName.js
// Retroactive display-name propagation.
//
// The CRM records reference people by their DISPLAY NAME (manager / assignedTo /
// salesperson / designer / …) rather than by a stable user id, so when an account
// is renamed the old name is otherwise left stranded on every historical record.
// This helper rewrites the old name to the new name across every shared `salescrm`
// collection, so a rename in Settings (or by the Sales Head) updates old leads,
// appointments, payments, etc. as well as the account itself.
//
// It runs against the RAW MongoDB collections (via the active mongoose connection)
// so it also covers collections this particular backend has no Mongoose model for —
// all three backends (Coordinator / Manager / Head) share the one salescrm database.
const mongoose = require('mongoose');

// collection name -> the fields in that collection that hold a person's display name
const NAME_FIELDS = {
  leads:        ['manager', 'assignedTo', 'mgr_name', 'mgr_display_name'],
  appointments: ['manager', 'assignedTo', 'mgr_name', 'mgr_display_name'],
  quotations:   ['manager', 'salesperson', 'preparedBy'],
  payments:     ['manager', 'salesperson'],
  pipelines:    ['manager', 'assignedTo'],
  projects:     ['team', 'manager'],
  designs:      ['designer', 'manager'],
  measurements: ['engineer', 'manager'],
  teamtasks:    ['assignee'],
};

/**
 * Rewrite `oldName` -> `newName` across all name-bearing fields.
 * Safe to call unconditionally: it no-ops unless both names are present and differ.
 * Never throws — a failure on one field is logged and the rest continue.
 * @returns {Promise<{changed:number}>} total documents modified
 */
async function syncUserName(oldName, newName) {
  const from = String(oldName == null ? '' : oldName).trim();
  const to = String(newName == null ? '' : newName).trim();
  if (!from || !to || from === to) return { changed: 0 };

  const db = mongoose.connection && mongoose.connection.db;
  if (!db) return { changed: 0 };

  let changed = 0;
  for (const coll of Object.keys(NAME_FIELDS)) {
    for (const field of NAME_FIELDS[coll]) {
      try {
        const r = await db.collection(coll).updateMany(
          { [field]: from },
          { $set: { [field]: to } }
        );
        changed += (r && r.modifiedCount) || 0;
      } catch (e) {
        // A missing collection / field is harmless — keep going.
        console.warn(`[syncUserName] ${coll}.${field}: ${e && e.message}`);
      }
    }
  }
  if (changed) console.log(`[syncUserName] "${from}" -> "${to}": ${changed} record(s) updated`);
  return { changed };
}

module.exports = { syncUserName };
