// src/app.ts
import express from 'express';
import './db'; // triggers MongoDB connection
import actRoutes from './routes/actRoutes'; // ✅ Import your routes

const app = express();

app.use(express.json());

// ✅ Mount your routes under /acts
app.use('/acts', actRoutes);

export default app;
