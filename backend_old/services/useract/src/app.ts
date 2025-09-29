// src/app.ts
import express from 'express';
import './db';
import userActRoutes from './routes/userActRoutes';

const app = express();

app.use(express.json());
app.use('/useracts', userActRoutes);

export default app;
