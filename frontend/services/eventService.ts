import api from './api';
import { Event } from '../../shared/interfaces/Event';

export async function getAllEvents(): Promise<Event[]> {
  const res = await api.get('/events');
  return res.data;
}

export async function getEvent(eventId: string): Promise<Event> {
  const res = await api.get(`/events/${eventId}`);
  return res.data;
}
