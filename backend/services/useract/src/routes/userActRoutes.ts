import express from 'express';
import {
  getUserActsForAct,
  getUserActsForUser,
  createUserAct,
  deleteUserAct
} from '../controllers/userActController';

const router = express.Router();

router.get('/act/:actId', getUserActsForAct);
router.get('/user/:userId', getUserActsForUser);
router.post('/', createUserAct);
router.delete('/:actId/:userId', deleteUserAct);

export default router;
