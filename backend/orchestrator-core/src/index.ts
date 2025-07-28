import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';

import userRoutes from './routes/userRoutes';
import actRoutes from './routes/actRoutes';
import placeRoutes from './routes/placeRoutes';
import eventRoutes from './routes/eventRoutes';
import compositeRoutes from './routes/compositeRoutes';

dotenv.config();
const app = express();

// Enable CORS
app.use(cors());

// Body parser
app.use(express.json());

// Service routes
app.use('/users', userRoutes);
app.use('/acts', actRoutes);
app.use('/places', placeRoutes);
app.use('/events', eventRoutes);
app.use('/composite', compositeRoutes);

// Root route for sanity check
app.get('/', (req, res) => {
  res.send('Orchestrator-core running');
});

// Catch-all 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 4010;
app.listen(PORT, () => {
  console.log(`Orchestrator-core listening on port ${PORT}`);
});
