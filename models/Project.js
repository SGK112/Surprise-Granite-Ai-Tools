import mongoose from 'mongoose';

const projectSchema = new mongoose.Schema({
  userId: { type: String, required: true }, // Firebase UID
  type: { type: String, required: true }, // e.g., kitchen, bathroom
  formData: { type: Object, required: true }, // Customer input data
  images: [
    {
      filename: { type: String, required: true },
      originalname: { type: String, required: true },
      path: { type: String, required: true },
    },
  ],
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model('Project', projectSchema);
