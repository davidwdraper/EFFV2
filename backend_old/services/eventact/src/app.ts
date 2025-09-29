// src/app.ts
import express from 'express';
import './db'; // connect to DB
import eventActRoutes from './routes/eventActRoutes';

const app = express();
app.use(express.json());

app.use('/eventacts', eventActRoutes);

export default app;
