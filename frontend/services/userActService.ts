import api from './api';
import { UserAct } from '../../shared/interfaces/UserAct';

export async function getUserActsForAct(actId: string): Promise<UserAct[]> {
  const res = await api.get(`/useracts/act/${actId}`);
  return res.data;
}

export async function getUserActsForUser(userId: string): Promise<UserAct[]> {
  const res = await api.get(`/useracts/user/${userId}`);
  return res.data;
}

export async function createUserAct(join: UserAct): Promise<void> {
  await api.post('/useracts', join);
}

export async function deleteUserAct(actId: string, userId: string): Promise<void> {
  await api.delete(`/useracts/${actId}/${userId}`);
}
