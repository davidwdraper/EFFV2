import express from 'express';
import mongoose from 'mongoose';
import eventPlaceRoutes from './routes/eventPlaceRoutes';

const app = express();
app.use(express.json());

app.use('/eventplaces', eventPlaceRoutes);

const PORT = process.env.PORT || 4009;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/eventplace';

mongoose.connect(MONGO_URI).then(() => {
  console.log("Connected to MongoDB");
  app.listen(PORT, () => {
    console.log(`EventPlace service running on port ${PORT}`);
  });
}).catch(err => {
  console.error("MongoDB connection error:", err);
});
