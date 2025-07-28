import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import eventRoutes from './routes/eventRoutes';

dotenv.config();
const app = express();
app.use(express.json());
app.use('/events', eventRoutes);

mongoose.connect(process.env.MONGO_URI!)
  .then(() => {
    app.listen(process.env.PORT, () =>
      console.log(`Event service listening on port ${process.env.PORT}`)
    );
  }).catch(console.error);