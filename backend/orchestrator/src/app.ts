// src/app.ts
import express from 'express';
import dotenv from 'dotenv';
import authenticate from './middleware/authenticate';
//import userRoutes from './routes/userRoutes';
import actRoutes from './routes/actRoutes';
import eventRoutes from './routes/eventRoutes';
import placeRoutes from './routes/placeRoutes';
import logRoutes from './routes/logRoutes';
import router from './routes/userRoutes';

dotenv.config();
const app = express();

app.use(express.json());
app.use(authenticate); // Global auth middleware

// Routes
app.use('/', router);
// app.use('/users', userRoutes);
// app.use('/acts', actRoutes);
// app.use('/events', eventRoutes);
// app.use('/places', placeRoutes);
// app.use('/logs', logRoutes);

export default app;
