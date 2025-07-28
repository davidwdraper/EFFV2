import mongoose from 'mongoose';

const actSchema = new mongoose.Schema({
  name: String,
  type: String,
  address: String,
  members: [String] // User IDs
});

const Act = mongoose.model('Act', actSchema);
export default Act;