import api from './api';
import { EventAct } from '../../shared/interfaces/EventAct';

export async function getEventActsForEvent(eventId: string): Promise<EventAct[]> {
  const res = await api.get(`/eventacts/event/${eventId}`);
  return res.data;
}

export async function getEventActsForAct(actId: string): Promise<EventAct[]> {
  const res = await api.get(`/eventacts/act/${actId}`);
  return res.data;
}

export async function createEventAct(join: EventAct): Promise<void> {
  await api.post('/eventacts', join);
}

export async function deleteEventAct(eventId: string, actId: string): Promise<void> {
  await api.delete(`/eventacts/${eventId}/${actId}`);
}
