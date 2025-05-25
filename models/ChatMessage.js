import mongoose from 'mongoose';

const ChatMessageSchema = new mongoose.Schema({
  sessionId: String,
  from: String,
  message: String,
  files: [{
    url: String,
    public_id: String,
    originalname: String,
    mimetype: String,
    uploadedAt: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now }
});

const ChatMessage = mongoose.model('ChatMessage', ChatMessageSchema);
export default ChatMessage;
