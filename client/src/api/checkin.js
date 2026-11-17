import { apiRequest, toQuery } from './client';

export function getVisits(filters = {}) {
  return apiRequest(`/api/visits${toQuery(filters)}`);
}

export function getOnSiteVisits() {
  return apiRequest('/api/visits/on-site');
}

export function getVisit(id) {
  return apiRequest(`/api/visits/${id}`);
}

export function checkInVisit(id) {
  return apiRequest(`/api/visits/${id}/check-in`, { method: 'POST' });
}

export function checkOutVisit(id) {
  return apiRequest(`/api/visits/${id}/check-out`, { method: 'POST' });
}
