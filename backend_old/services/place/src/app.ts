// src/app.ts
import express from 'express';
import './db';
import placeRoutes from './routes/placeRoutes';

const app = express();

app.use(express.json());
app.use('/places', placeRoutes);

export default app;
