import { Request, Response } from 'express';
import Place from '../models/Place';

export const createPlace = async (req: Request, res: Response) => {
  try {
    const place = new Place(req.body);
    await place.save();
    res.status(201).json(place);
  } catch (err: any) {
    console.error('[PlaceService] createPlace error:', err.message);
    res.status(500).json({ error: 'Failed to create place' });
  }
};

export const getAllPlaces = async (_req: Request, res: Response) => {
  try {
    const places = await Place.find();
    res.json(places);
  } catch (err: any) {
    console.error('[PlaceService] getAllPlaces error:', err.message);
    res.status(500).json({ error: 'Failed to fetch places' });
  }
};

export const getPlaceById = async (req: Request, res: Response) => {
  try {
    const place = await Place.findById(req.params.id);
    if (!place) return res.status(404).json({ error: 'Place not found' });
    res.json(place);
  } catch (err: any) {
    console.error('[PlaceService] getPlaceById error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve place' });
  }
};

export const updatePlaceById = async (req: Request, res: Response) => {
  try {
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({ error: 'Update payload is empty' });
    }

    const place = await Place.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!place) return res.status(404).json({ error: 'Place not found' });

    res.json(place);
  } catch (err: any) {
    console.error('[PlaceService] updatePlaceById error:', err.message);
    res.status(500).json({ error: 'Failed to update place' });
  }
};

export const deletePlaceById = async (req: Request, res: Response) => {
  try {
    const result = await Place.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: 'Place not found' });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[PlaceService] deletePlaceById error:', err.message);
    res.status(500).json({ error: 'Failed to delete place' });
  }
};
