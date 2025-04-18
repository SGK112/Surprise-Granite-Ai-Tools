// routes/estimates.js
import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { analyzeImagesAndGenerateEstimate } from '../services/openai.js';
import Estimate from '../models/Estimate.js';
import Project from '../models/Project.js';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only images are allowed'));
    }
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

// Create a new project and estimate
router.post('/', authenticate, upload.array('images', 10), async (req, res) => {
  const { type, formData } = req.body;
  const images = req.files;

  try {
    // Validate formData
    let parsedFormData;
    try {
      parsedFormData = JSON.parse(formData);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid formData format' });
    }

    // Upload images to Cloudinary
    const uploadedImages = await Promise.all(
      images.map(async (file) => {
        const result = await new Promise((resolve, reject) => {
          cloudinary.uploader
            .upload_stream(
              {
                public_id: `slabs/${Date.now()}_${file.originalname}`,
                folder: 'surprise_granite',
              },
              (error, result) => {
                if (error) return reject(error);
                resolve(result);
              }
            )
            .end(file.buffer);
        });
        return { url: result.secure_url, public_id: result.public_id };
      })
    );

    // Save project
    const project = new Project({
      userId: req.user.id,
      type,
      formData: parsedFormData,
      images: uploadedImages,
    });
    await project.save();

    // Generate estimate
    const estimateDetails = await analyzeImagesAndGenerateEstimate(project, uploadedImages);
    const estimate = new Estimate({
      userId: req.user.id,
      projectId: project._id,
      customerNeeds: formData,
      estimateDetails,
    });
    await estimate.save();

    res.status(201).json({ project, estimate });
  } catch (error) {
    console.error('Error creating estimate:', error);
    res.status(500).json({ error: 'Failed to create estimate', details: error.message });
  }
});

// Get all estimates for a user
router.get('/', authenticate, async (req, res) => {
  try {
    const estimates = await Estimate.find({ userId: req.user.id }).populate('projectId');
    res.status(200).json(estimates);
  } catch (error) {
    console.error('Error retrieving estimates:', error);
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
    console.error('Error retrieving estimate:', error);
    res.status(500).json({ error: 'Failed to retrieve estimate', details: error.message });
  }
});

export default router;
