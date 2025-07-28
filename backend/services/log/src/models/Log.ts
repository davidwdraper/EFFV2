import mongoose from 'mongoose';

const logSchema = new mongoose.Schema({
  endpoint: String,
  method: String,
  userId: { type: String, default: 'anonymous' },
  timestamp: { type: Date, default: Date.now },
  payload: mongoose.Schema.Types.Mixed
});

const Log = mongoose.model('Log', logSchema);
export default Log;