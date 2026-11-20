import { apiRequest, toQuery } from './client';

export function createVisit(data) {
  return apiRequest('/api/visits', { method: 'POST', body: data });
}

export function updateVisit(id, data) {
  return apiRequest(`/api/visits/${id}`, { method: 'PATCH', body: data });
}

export function cancelVisit(id) {
  return apiRequest(`/api/visits/${id}/cancel`, { method: 'POST' });
}

export function searchVisitors(search) {
  return apiRequest(`/api/visitors${toQuery({ search })}`);
}
