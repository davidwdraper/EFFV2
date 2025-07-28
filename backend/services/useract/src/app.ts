import express from 'express';
import mongoose from 'mongoose';
import userActRoutes from './routes/userActRoutes';

const app = express();
app.use(express.json());

app.use('/useracts', userActRoutes);

const PORT = process.env.PORT || 4007;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/useract';

mongoose.connect(MONGO_URI).then(() => {
  console.log("Connected to MongoDB");
  app.listen(PORT, () => {
    console.log(`UserAct service running on port ${PORT}`);
  });
}).catch(err => {
  console.error("MongoDB connection error:", err);
});
