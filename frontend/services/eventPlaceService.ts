import api from './api';
import { EventPlace } from '../../shared/interfaces/EventPlace';

export async function getEventPlacesForEvent(eventId: string): Promise<EventPlace[]> {
  const res = await api.get(`/eventplaces/event/${eventId}`);
  return res.data;
}

export async function getEventPlacesForPlace(placeId: string): Promise<EventPlace[]> {
  const res = await api.get(`/eventplaces/place/${placeId}`);
  return res.data;
}

export async function createEventPlace(join: EventPlace): Promise<void> {
  await api.post('/eventplaces', join);
}

export async function deleteEventPlace(eventId: string, placeId: string): Promise<void> {
  await api.delete(`/eventplaces/${eventId}/${placeId}`);
}
