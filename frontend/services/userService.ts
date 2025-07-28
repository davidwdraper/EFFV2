import api from './api';

export async function searchUsers(query: string) {
  const res = await api.get(`/users/search?q=${encodeURIComponent(query)}`);
  return res.data;
}

export async function getUser(userId: string) {
  const res = await api.get(`/users/${userId}`);
  return res.data;
}
