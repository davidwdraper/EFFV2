import { Request, Response } from 'express';
import UserAct from '../models/UserAct';

export const createUserAct = async (req: Request, res: Response) => {
  try {
    const userAct = new UserAct(req.body);
    await userAct.save();
    res.status(201).json(userAct);
  } catch (err: any) {
    console.error('[UserActService] createUserAct error:', err.message);
    res.status(500).json({ error: 'Failed to create user-act link' });
  }
};

export const getUserActsForUser = async (req: Request, res: Response) => {
  try {
    const docs = await UserAct.find({ userId: req.params.userId });
    res.json(docs);
  } catch (err: any) {
    console.error('[UserActService] getUserActsForUser error:', err.message);
    res.status(500).json({ error: 'Failed to fetch user-acts' });
  }
};

export const getUserActsForAct = async (req: Request, res: Response) => {
  try {
    const docs = await UserAct.find({ actId: req.params.actId });
    res.json(docs);
  } catch (err: any) {
    console.error('[UserActService] getUserActsForAct error:', err.message);
    res.status(500).json({ error: 'Failed to fetch act-users' });
  }
};

export const deleteUserAct = async (req: Request, res: Response) => {
  try {
    const { actId, userId } = req.params;
    await UserAct.findOneAndDelete({ actId, userId });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[UserActService] deleteUserAct error:', err.message);
    res.status(500).json({ error: 'Failed to delete user-act link' });
  }
};
