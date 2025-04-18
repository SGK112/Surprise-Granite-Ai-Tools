import express from 'express';

const router = express.Router();

router.post('/sync', (req, res) => {
  res.status(200).json({ message: 'Auth sync placeholder' });
});

export default router;
