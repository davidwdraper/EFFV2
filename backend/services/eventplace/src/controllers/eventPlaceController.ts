import { Request, Response } from 'express';
import { EventPlace } from '../models/EventPlace';

export const getEventPlacesForEvent = async (req: Request, res: Response) => {
  const { eventId } = req.params;
  const records = await EventPlace.find({ eventId });
  res.json(records);
};

export const getEventPlacesForPlace = async (req: Request, res: Response) => {
  const { placeId } = req.params;
  const records = await EventPlace.find({ placeId });
  res.json(records);
};

export const createEventPlace = async (req: Request, res: Response) => {
  try {
    const newJoin = new EventPlace(req.body);
    await newJoin.save();
    res.status(201).send();
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

export const deleteEventPlace = async (req: Request, res: Response) => {
  const { eventId, placeId } = req.params;
  await EventPlace.deleteOne({ eventId, placeId });
  res.status(204).send();
};
