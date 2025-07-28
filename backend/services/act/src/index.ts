import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import actRoutes from './routes/actRoutes';

dotenv.config();
const app = express();
app.use(express.json());
app.use('/acts', actRoutes);

mongoose.connect(process.env.MONGO_URI!)
  .then(() => {
    app.listen(process.env.PORT, () =>
      console.log(`Act service listening on port ${process.env.PORT}`)
    );
  }).catch(console.error);