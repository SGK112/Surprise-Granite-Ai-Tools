import express from 'express';

const router = express.Router();

// Placeholder for future auth endpoints
router.get('/', (req, res) => {
  res.status(200).json({ message: 'Auth routes disabled. Use /api/materials for countertop data.' });
});

export default router;
