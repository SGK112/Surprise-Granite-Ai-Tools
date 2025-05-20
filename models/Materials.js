import mongoose from 'mongoose';

const materialSchema = new mongoose.Schema({
    colorName: { type: String, required: true },
    vendorName: { type: String, required: true },
    material: { type: String, required: true },
    costSqFt: { type: Number, required: true },
    availableSqFt: { type: Number, required: true },
    imageUrl: { type: String }
}, { collection: 'countertop_images' });

export default mongoose.model('Material', materialSchema);
