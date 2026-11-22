import { apiRequest, toQuery } from './client';

// idempotencyKey stays the same for every retry of one form submission,
// so a double click or a retried request never creates two visits.
export function createVisit(data, idempotencyKey) {
  const headers = idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {};
  return apiRequest('/api/visits', { method: 'POST', body: data, headers });
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