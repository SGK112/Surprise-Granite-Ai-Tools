import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { analyzeImagesAndGenerateEstimate } from '../services/openai.js';
import Estimate from '../models/Estimate.js';
import Project from '../models/Project.js';
import multer from 'multer';

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

// Create a new project and estimate
router.post('/', authenticate, upload.array('images', 10), async (req, res) => {
  const { type, formData } = req.body;
  const images = req.files;

  try {
    // Save project
    const project = new Project({
      userId: req.user.id, // Firebase UID
      type,
      formData: JSON.parse(formData),
      images: images.map((f) => ({ filename: f.filename, originalname: f.originalname, path: f.path })),
    });
    await project.save();

    // Generate estimate
    const estimateDetails = await analyzeImagesAndGenerateEstimate(project, images);
    const estimate = new Estimate({
      userId: req.user.id, // Firebase UID
      projectId: project._id,
      customerNeeds: JSON.stringify(formData),
      estimateDetails,
    });
    await estimate.save();

    res.status(201).json({ project, estimate });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create estimate', details: error.message });
  }
});

// Get all estimates for a user
router.get('/', authenticate, async (req, res) => {
  try {
    const estimates = await Estimate.find({ userId: req.user.id }).populate('projectId');
    res.status(200).json(estimates);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve estimates', details: error.message });
  }
});

// Get a specific estimate
router.get('/:id', authenticate, async (req, res) => {
  try {
    const estimate = await Estimate.findOne({ _id: req.params.id, userId: req.user.id }).populate('projectId');
    if (!estimate) return res.status(404).json({ error: 'Estimate not found' });
    res.status(200).json(estimate);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve estimate', details: error.message });
  }
});

export default router;
