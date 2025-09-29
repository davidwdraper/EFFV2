import express from 'express';
import {
  createEvent,
  getAllEvents,
  getEventById,
  updateEventById,
  deleteEventById
} from '../controllers/eventController';

const router = express.Router();

router.post('/', createEvent);
router.get('/', getAllEvents);
router.get('/:id', getEventById);
router.put('/:id', updateEventById);
router.delete('/:id', deleteEventById);

export default router;
