import express from 'express';
import mongoose from 'mongoose';
import eventActRoutes from './routes/eventActRoutes';

const app = express();
app.use(express.json());

app.use('/eventacts', eventActRoutes);

const PORT = process.env.PORT || 4008;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/eventact';

mongoose.connect(MONGO_URI).then(() => {
  console.log("Connected to MongoDB");
  app.listen(PORT, () => {
    console.log(`EventAct service running on port ${PORT}`);
  });
}).catch(err => {
  console.error("MongoDB connection error:", err);
});
