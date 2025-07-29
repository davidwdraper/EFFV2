// src/controllers/eventPlaceController.ts
import { Request, Response } from 'express';
import EventPlaceModel from '../models/EventPlace';

export const getEventPlacesForEvent = async (req: Request, res: Response) => {
  const { eventId } = req.params;
  const docs = await EventPlaceModel.find({ eventId });
  res.status(200).json(docs);
};

export const getEventPlacesForPlace = async (req: Request, res: Response) => {
  const { placeId } = req.params;
  const docs = await EventPlaceModel.find({ placeId });
  res.status(200).json(docs);
};

export const createEventPlace = async (req: Request, res: Response) => {
  try {
    const newJoin = new EventPlaceModel(req.body);
    await newJoin.save();
    res.status(201).json(newJoin);
  } catch (err) {
    res.status(400).json({ error: 'Validation failed', details: err });
  }
};

export const deleteEventPlace = async (req: Request, res: Response) => {
  const { eventId, placeId } = req.params;
  await EventPlaceModel.findOneAndDelete({ eventId, placeId });
  res.status(200).json({ message: 'EventPlace deleted' });
};
