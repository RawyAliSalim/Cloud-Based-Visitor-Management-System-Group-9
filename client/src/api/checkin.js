import { API_BASE_URL, apiRequest, toQuery } from './client';

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

export function getActivityReport(filters = {}) {
  return apiRequest(`/api/visits/reports/activity${toQuery(filters)}`);
}

export function visitExportUrl(filters = {}) {
  return `${API_BASE_URL}/api/visits/reports/export${toQuery(filters)}`;
}
