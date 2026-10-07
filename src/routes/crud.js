const express = require('express');

// Generic CRUD router. idField 'id' uses the business id (LD-xxxx); '_id' uses Mongo _id.
module.exports = function makeCrud(Model, opts = {}) {
  const router = express.Router();
  const useMongoId = opts.idField === '_id';

  // GET / — list all (optionally excluding heavy fields like base64 file data)
  router.get('/', async (req, res) => {
    try {
      // Paginated + searchable + scope-filtered mode for fast Lead pickers.
      // Active ONLY when ?limit is present; the full-list behavior below is unchanged.
      if (req.query.limit !== undefined) {
        const lim = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
        const off = Math.max(parseInt(req.query.offset, 10) || 0, 0);
        const esc = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const filter = {};
        const term = (req.query.q || '').toString().trim();
        if (term) { const rx = new RegExp(esc(term), 'i'); filter.$or = [{ id: rx }, { name: rx }, { phone: rx }, { email: rx }]; }
        const mgr = (req.query.manager || '').toString().trim();
        if (mgr) filter.manager = new RegExp('^' + esc(mgr) + '$', 'i');
        const asg = (req.query.assignedTo || '').toString().trim();
        if (asg) filter.assignedTo = new RegExp('^' + esc(asg) + '$', 'i');
        // ?mine=a,b,c — match the manager field against ANY of the caller's assignment
        // keys (name / email / employeeId), so a Manager picker shows only their own leads
        // regardless of which identifier the lead was assigned under.
        const mine = (req.query.mine || '').toString().split(',').map((s) => s.trim()).filter(Boolean);
        if (mine.length) filter.manager = { $in: mine.map((m) => new RegExp('^' + esc(m) + '$', 'i')) };
        const items = await Model.find(filter)
          .select('-history')
          .sort({ createdAt: -1 })
          .skip(off).limit(lim).lean();
        return res.json(items);
      }
      const sel = [opts.listExclude || '', req.query.light ? '-history' : ''].filter(Boolean).join(' ');
      res.json(await Model.find().select(sel).sort({ createdAt: 1 }).lean());
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET /:id — a single document WITH all fields (heavy fields included, for preview/download)
  router.get('/:id', async (req, res) => {
    try {
      const doc = useMongoId
        ? await Model.findById(req.params.id)
        : await Model.findOne({ id: req.params.id });
      if (!doc) return res.status(404).json({ message: 'Not found' });
      res.json(doc);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });

  // POST / — create one (optionally assigning a fresh server-generated business id)
  router.post('/', async (req, res) => {
    try {
      if (typeof opts.genId === 'function') {
        const body = { ...(req.body || {}) };
        delete body.id; // always assign a fresh id on create (ignore any client-supplied id)
        for (let i = 0; i < 50; i++) {
          body.id = await opts.genId(Model);
          try { return res.status(201).json(await Model.create(body)); }
          catch (e) { if (e && e.code === 11000) continue; throw e; }
        }
        throw new Error('Could not allocate a unique id');
      }
      res.status(201).json(await Model.create(req.body));
    } catch (e) {
      res.status(400).json({ message: e.message });
    }
  });

  // POST /bulk — upsert an array (sync from frontend state)
  // A stale snapshot must never wipe an assignment another portal just made, so a
  // blank/"Unassigned" manager in a bulk payload is NOT allowed to overwrite a stored
  // real manager. A genuine re-assignment (a real name) still applies; explicit un-assign
  // goes through the targeted PUT below, not bulk.
  const isBlankAssignment = (v) => v == null || String(v).trim() === '' || /^unassigned$/i.test(String(v).trim());
  router.post('/bulk', async (req, res) => {
    try {
      const arr = req.body;
      if (!Array.isArray(arr)) return res.status(400).json({ message: 'Expected an array' });
      const valid = arr.filter((d) => (useMongoId ? d._id : d.id));

      // Leads (historyAppendOnly): a whole-array bulk sync must NEVER revert an assignment
      // or truncate a timeline — those are owned by the targeted PUT /:id. Bulk only SEEDS
      // manager/assignedTo on insert, and accepts history only when it GROWS (no shrink).
      if (opts.historyAppendOnly) {
        const ids = valid.map((d) => d.id).filter(Boolean);
        const existing = ids.length ? await Model.aggregate([
          { $match: { id: { $in: ids } } },
          { $project: { id: 1, hlen: { $size: { $ifNull: ['$history', []] } } } },
        ]) : [];
        const hlen = new Map(existing.map((e) => [e.id, e.hlen]));
        const known = new Set(existing.map((e) => e.id));
        const ops = valid.map((d) => {
          const { id, _id, manager, assignedTo, history, ...rest } = d;
          const set = { ...rest };
          delete set._id;
          if (Array.isArray(history) && (!known.has(id) || history.length > (hlen.get(id) || 0))) {
            set.history = history;
          }
          const update = { $set: set };
          const onInsert = {};
          if (manager !== undefined) onInsert.manager = manager;
          if (assignedTo !== undefined) onInsert.assignedTo = assignedTo;
          if (Object.keys(onInsert).length) update.$setOnInsert = onInsert;
          return { updateOne: { filter: { id }, update, upsert: true } };
        });
        if (ops.length) await Model.bulkWrite(ops);
        return res.json({ success: true, count: ops.length });
      }

      const ops = valid
        .map((d) => {
          const set = { ...d };
          if (isBlankAssignment(set.manager)) delete set.manager;
          if (isBlankAssignment(set.assignedTo)) delete set.assignedTo;
          return {
            updateOne: {
              filter: useMongoId ? { _id: d._id } : { id: d.id },
              update: { $set: set },
              upsert: true,
            },
          };
        });
      if (ops.length) await Model.bulkWrite(ops);
      res.json({ success: true, count: ops.length });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });

  // PUT /:id — update one
  router.put('/:id', async (req, res) => {
    try {
      const body = { ...req.body };
      delete body._id; delete body.createdAt; delete body.updatedAt; delete body.__v; // never overwrite identity / server-managed fields
      // history is append-only (never shrink): a history-light client snapshot must not
      // replace a stored history with a shorter array. Only runs for history-bearing models.
      if (opts.historyAppendOnly && Array.isArray(body.history)) {
        const cur = useMongoId
          ? await Model.findById(req.params.id).select('history').lean()
          : await Model.findOne({ id: req.params.id }).select('history').lean();
        const stored = (cur && Array.isArray(cur.history)) ? cur.history.length : 0;
        if (body.history.length < stored) delete body.history;
      }
      const doc = useMongoId
        ? await Model.findByIdAndUpdate(req.params.id, { $set: body }, { new: true })
        : await Model.findOneAndUpdate({ id: req.params.id }, { $set: body }, { new: true });
      if (!doc) return res.status(404).json({ message: 'Not found' });
      res.json(doc);
    } catch (e) {
      res.status(400).json({ message: e.message });
    }
  });

  // DELETE / — clear all
  router.delete('/', async (req, res) => {
    try {
      await Model.deleteMany({});
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });

  // DELETE /:id — delete one
  router.delete('/:id', async (req, res) => {
    try {
      const doc = useMongoId
        ? await Model.findByIdAndDelete(req.params.id)
        : await Model.findOneAndDelete({ id: req.params.id });
      if (!doc) return res.status(404).json({ message: 'Not found' });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });

  return router;
};
