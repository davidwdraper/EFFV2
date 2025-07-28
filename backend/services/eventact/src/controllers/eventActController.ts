import { Request, Response } from 'express';
import { EventAct } from '../models/EventAct';

export const getEventActsForEvent = async (req: Request, res: Response) => {
  const { eventId } = req.params;
  const records = await EventAct.find({ eventId });
  res.json(records);
};

export const getEventActsForAct = async (req: Request, res: Response) => {
  const { actId } = req.params;
  const records = await EventAct.find({ actId });
  res.json(records);
};

export const createEventAct = async (req: Request, res: Response) => {
  try {
    const newJoin = new EventAct(req.body);
    await newJoin.save();
    res.status(201).send();
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

export const deleteEventAct = async (req: Request, res: Response) => {
  const { eventId, actId } = req.params;
  await EventAct.deleteOne({ eventId, actId });
  res.status(204).send();
};
