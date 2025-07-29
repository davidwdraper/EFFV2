import mongoose from 'mongoose';
import { config } from './config';

// NOT NEEDED UNTIL WE DETERMINE THAT DB ACCESS IS NECESSARY
// export const connectToDB = async () => {
//   try {
//     await mongoose.connect(config.mongoUri);
//     console.log('[orchestrator-core] Connected to MongoDB');
//   } catch (err) {
//     console.error('[orchestrator-core] MongoDB connection failed:', err);
//     process.exit(1);
//   }
// };
