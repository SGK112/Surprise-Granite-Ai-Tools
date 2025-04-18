import mongoose from 'mongoose';

const estimateSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  customerNeeds: { type: String, required: true },
  estimateDetails: {
    materialCost: { type: Number, required: true },
    laborCost: { type: Number, required: true },
    additionalServices: { type: Number, required: true },
    total: { type: Number, required: true },
  },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model('Estimate', estimateSchema);
