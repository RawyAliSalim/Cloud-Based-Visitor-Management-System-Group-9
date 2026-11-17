import { apiRequest, toQuery } from './client';

export function getNotifications(filters = {}) {
  return apiRequest(`/api/notifications${toQuery(filters)}`);
}

export function acknowledgeNotification(id) {
  return apiRequest(`/api/notifications/${id}/acknowledge`, { method: 'POST' });
}

export function resendNotification(id) {
  return apiRequest(`/api/notifications/${id}/resend`, { method: 'POST' });
}

export function saveFcmToken(token) {
  return apiRequest('/api/notifications/fcm-token', { method: 'POST', body: { token } });
}
