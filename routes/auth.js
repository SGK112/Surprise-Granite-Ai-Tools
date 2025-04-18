// routes/auth.js
import express from 'express';
import admin from 'firebase-admin';

const router = express.Router();

// Sync endpoint to verify Firebase token and process user data
router.post('/sync', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const decodedToken = await admin.auth().verifyIdToken(token);
    const { email, name } = req.body;
    // Optional: Save user data to MongoDB (uncomment and adjust if you have a User model)
    /*
    await UserModel.findOneAndUpdate(
      { uid: decodedToken.uid },
      { email, name },
      { upsert: true }
    );
    */
    res.status(200).json({ message: 'Sync successful', uid: decodedToken.uid });
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
});

export default router; // Default export
