// src/routes/actRoutes.ts
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import Act from '../models/Act';
import { logger } from '@shared/utils/logger';
import { authenticate } from '@shared/middleware/authenticate';
import { dateNowIso } from '@shared/utils/dateUtils';

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authenticate);

// CREATE Act
router.post('/', async (req, res) => {
  try {
    const {
      actType,
      name,
      eMailAddr,
      userOwnerId,
      imageIds,
    } = req.body;

    const userCreateId = req.user?.userId;
    if (!userCreateId) {
      return res.status(401).send({ error: 'Unauthorized: Missing or invalid user token' });
    }

    // Basic validation
    if (!Array.isArray(actType) || actType.length === 0) {
      return res.status(400).send({ error: 'actType must be a non-empty array' });
    }
    if (!name) {
      return res.status(400).send({ error: 'name is required' });
    }

    const now = dateNowIso();

    const act = new Act({
      actId: uuidv4(),
      dateCreated: now,
      dateLastUpdated: now,
      actStatus: 0,
      actType,
      name,
      eMailAddr,
      userCreateId,
      userOwnerId: userOwnerId || userCreateId,
      imageIds: Array.isArray(imageIds) ? imageIds.slice(0, 10) : [],
    });

    await act.save();
    res.status(201).send(act);
  } catch (err) {
    logger.error('[ActService] POST /acts failed', {
      err
