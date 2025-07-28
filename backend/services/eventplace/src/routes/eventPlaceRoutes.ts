import express from 'express';
import {
  getEventPlacesForEvent,
  getEventPlacesForPlace,
  createEventPlace,
  deleteEventPlace
} from '../controllers/eventPlaceController';

const router = express.Router();

router.get('/event/:eventId', getEventPlacesForEvent);
router.get('/place/:placeId', getEventPlacesForPlace);
router.post('/', createEventPlace);
router.delete('/:eventId/:placeId', deleteEventPlace);

export default router;
