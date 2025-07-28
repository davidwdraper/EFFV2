import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import logRoutes from './routes/logRoutes';

dotenv.config();
const app = express();
app.use(express.json());
app.use('/logs', logRoutes);

mongoose.connect(process.env.MONGO_URI!)
  .then(() => {
    app.listen(process.env.PORT, () =>
      console.log(`Log service listening on port ${process.env.PORT}`)
    );
  }).catch(console.error);