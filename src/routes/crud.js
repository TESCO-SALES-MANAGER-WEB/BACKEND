const express = require('express');

// Generic CRUD router. idField 'id' uses the business id (LD-xxxx); '_id' uses Mongo _id.
module.exports = function makeCrud(Model, opts = {}) {
  const router = express.Router();
  const useMongoId = opts.idField === '_id';

  // GET / — list all (optionally excluding heavy fields like base64 file data)
  router.get('/', async (req, res) => {
    try {
      res.json(await Model.find().select(opts.listExclude || '').sort({ createdAt: 1 }));
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
  router.post('/bulk', async (req, res) => {
    try {
      const arr = req.body;
      if (!Array.isArray(arr)) return res.status(400).json({ message: 'Expected an array' });
      const ops = arr
        .filter((d) => (useMongoId ? d._id : d.id))
        .map((d) => ({
          updateOne: {
            filter: useMongoId ? { _id: d._id } : { id: d.id },
            update: { $set: d },
            upsert: true,
          },
        }));
      if (ops.length) await Model.bulkWrite(ops);
      res.json({ success: true, count: ops.length });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });

  // PUT /:id — update one
  router.put('/:id', async (req, res) => {
    try {
      const doc = useMongoId
        ? await Model.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true })
        : await Model.findOneAndUpdate({ id: req.params.id }, { $set: req.body }, { new: true });
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
