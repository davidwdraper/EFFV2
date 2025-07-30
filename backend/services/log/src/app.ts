// src/app.ts
import express from 'express';
import './db';
import logRoutes from './routes/logRoutes';

const app = express();

app.use(express.json());
app.use('/log', logRoutes);

export default app;
