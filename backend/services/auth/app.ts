import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import authRoutes from './routes/auth';

dotenv.config();
const app = express();
app.use(express.json());

app.use('/auth', authRoutes);

mongoose.connect(process.env.MONGO_URI!).then(() => {
  console.log('Auth service connected to MongoDB');
  app.listen(process.env.PORT, () => {
    console.log(`Auth service running on port ${process.env.PORT}`);
  });
}).catch(err => console.error('MongoDB connection error:', err));