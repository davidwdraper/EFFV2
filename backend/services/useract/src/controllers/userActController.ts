import { Request, Response } from 'express';
import { UserAct } from '../models/UserAct';

export const getUserActsForAct = async (req: Request, res: Response) => {
  const { actId } = req.params;
  const records = await UserAct.find({ actId });
  res.json(records);
};

export const getUserActsForUser = async (req: Request, res: Response) => {
  const { userId } = req.params;
  const records = await UserAct.find({ userId });
  res.json(records);
};

export const createUserAct = async (req: Request, res: Response) => {
  try {
    const newJoin = new UserAct(req.body);
    await newJoin.save();
    res.status(201).send();
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

export const deleteUserAct = async (req: Request, res: Response) => {
  const { actId, userId } = req.params;
  await UserAct.deleteOne({ actId, userId });
  res.status(204).send();
};
