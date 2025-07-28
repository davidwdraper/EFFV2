import express from 'express';
import {
  getEventActsForEvent,
  getEventActsForAct,
  createEventAct,
  deleteEventAct
} from '../controllers/eventActController';

const router = express.Router();

router.get('/event/:eventId', getEventActsForEvent);
router.get('/act/:actId', getEventActsForAct);
router.post('/', createEventAct);
router.delete('/:eventId/:actId', deleteEventAct);

export default router;
