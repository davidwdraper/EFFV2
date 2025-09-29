// src/controllers/eventActController.ts
import { Request, Response } from 'express';
import EventActModel from '../models/EventAct';

export const getEventActsForEvent = async (req: Request, res: Response) => {
  const { eventId } = req.params;
  const docs = await EventActModel.find({ eventId });
  res.status(200).json(docs);
};

export const getEventActsForAct = async (req: Request, res: Response) => {
  const { actId } = req.params;
  const docs = await EventActModel.find({ actId });
  res.status(200).json(docs);
};

export const createEventAct = async (req: Request, res: Response) => {
  try {
    const newJoin = new EventActModel(req.body);
    await newJoin.save();
    res.status(201).json(newJoin);
  } catch (err) {
    res.status(400).json({ error: 'Validation failed', details: err });
  }
};

export const deleteEventAct = async (req: Request, res: Response) => {
  const { eventId, actId } = req.params;
  await EventActModel.findOneAndDelete({ eventId, actId });
  res.status(200).json({ message: 'EventAct deleted' });
};
