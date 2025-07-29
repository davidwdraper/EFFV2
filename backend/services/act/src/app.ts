// src/app.ts
import express from 'express';
import './db'; // triggers MongoDB connection

const app = express();

// If you have routes, add them here:
// import actRoutes from './routes/actRoutes';
// app.use('/acts', actRoutes);

app.use(express.json());

export default app;
