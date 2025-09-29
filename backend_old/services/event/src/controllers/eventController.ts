import { Request, Response } from 'express';
import Event from '../models/Event';

export const createEvent = async (req: Request, res: Response) => {
  try {
    const {
      eventId,
      dateCreated,
      dateLastUpdated,
      type,
      name,
      startDateTime,
      endDateTime,
      repeatDay,
      userCreateId,
      userOwnerId
    } = req.body;

    if (
      !eventId || !dateCreated || !dateLastUpdated ||
      !type || !Array.isArray(type) || type.length === 0 ||
      !name || !startDateTime || !endDateTime ||
      !repeatDay || !Array.isArray(repeatDay) || repeatDay.length === 0 ||
      !userCreateId || !userOwnerId
    ) {
      return res.status(400).json({ error: 'Missing or invalid required fields' });
    }

    const event = new Event(req.body);
    await event.save();
    res.status(201).json(event);
  } catch (err: any) {
    console.error('[Create Event] Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getAllEvents = async (_req: Request, res: Response) => {
  try {
    const events = await Event.find();
    res.json(events);
  } catch (err: any) {
    console.error('[Get All Events] Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getEventById = async (req: Request, res: Response) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json(event);
  } catch (err: any) {
    console.error('[Get Event By ID] Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateEventById = async (req: Request, res: Response) => {
  try {
    const update = req.body;

    if (!update || Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'Update payload is empty' });
    }

    const event = await Event.findByIdAndUpdate(req.params.id, update, { new: true });

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json(event);
  } catch (err: any) {
    console.error('[Update Event] Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
};


export const deleteEventById = async (req: Request, res: Response) => {
  try {
    const result = await Event.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: 'Event not found' });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[Delete Event] Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
};
