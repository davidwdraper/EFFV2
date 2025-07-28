import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import placeRoutes from './routes/placeRoutes';

dotenv.config();
const app = express();
app.use(express.json());
app.use('/places', placeRoutes);

mongoose.connect(process.env.MONGO_URI!)
  .then(() => {
    app.listen(process.env.PORT, () =>
      console.log(`Place service listening on port ${process.env.PORT}`)
    );
  }).catch(console.error);