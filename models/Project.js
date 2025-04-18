import mongoose from 'mongoose';

const projectSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  type: { type: String, required: true, enum: ['kitchen', 'bathroom', 'other'] },
  formData: { type: Object, required: true },
  images: [{ url: String, public_id: String }],
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model('Project', projectSchema);
