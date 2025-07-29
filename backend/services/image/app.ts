import express from 'express';
import cors from 'cors';
import imageRoutes from './routes/imageRoutes';

const app = express();

app.use(cors());
app.use(express.json());
app.use('/images', imageRoutes);

export default app;
