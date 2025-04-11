import mongoose from 'mongoose';

const estimateSchema = new mongoose.Schema({
  userId: { type: String, required: true }, // Firebase UID
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  customerNeeds: { type: String, required: true }, // JSON string of form data
  estimateDetails: { type: String, required: true }, // AI-generated estimate
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model('Estimate', estimateSchema);
