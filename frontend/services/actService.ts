import api from './api';
import { Act } from '../../shared/interfaces/Act';

export async function getAllActs(): Promise<Act[]> {
  const res = await api.get('/acts');
  return res.data;
}

export async function getAct(actId: string): Promise<Act> {
  const res = await api.get(`/acts/${actId}`);
  return res.data;
}
