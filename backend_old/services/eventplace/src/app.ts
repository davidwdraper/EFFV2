// src/app.ts
import express from 'express';
import './db'; // triggers MongoDB connection
import eventPlaceRoutes from './routes/eventPlaceRoutes';

const app = express();

app.use(express.json());
app.use('/eventplaces', eventPlaceRoutes);

export default app;
