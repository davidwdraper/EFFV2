import api from './api';
import { Place } from '../../shared/interfaces/Place';

export async function getAllPlaces(): Promise<Place[]> {
  const res = await api.get('/places');
  return res.data;
}

export async function getPlace(placeId: string): Promise<Place> {
  const res = await api.get(`/places/${placeId}`);
  return res.data;
}
