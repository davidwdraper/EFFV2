// src/app.ts
import express from 'express';
import dotenv from 'dotenv';
import userRoutes from './routes/userRoutes';
import actRoutes from './routes/actRoutes';
import eventRoutes from './routes/eventRoutes';
import placeRoutes from './routes/placeRoutes';
import imageRoutes from './routes/imageRoutes';
import logRoutes from './routes/logRoutes';

dotenv.config();
const app = express();

app.use(express.json());

// Routes
app.use('/users', userRoutes);
app.use('/acts', actRoutes);
app.use('/events', eventRoutes);
app.use('/places', placeRoutes);
app.use('/logs', logRoutes);
app.use('/images', imageRoutes);

export default app;
