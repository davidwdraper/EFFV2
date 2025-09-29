import express from 'express';
import {
  createPlace,
  getAllPlaces,
  getPlaceById,
  updatePlaceById,
  deletePlaceById
} from '../controllers/placeController';

const router = express.Router();

router.post('/', createPlace);
router.get('/', getAllPlaces);
router.get('/:id', getPlaceById);
router.put('/:id', updatePlaceById);
router.delete('/:id', deletePlaceById);

export default router;
