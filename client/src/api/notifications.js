import { API_BASE_URL } from './client';

async function request(path, options = {}) {
  const headers = options.body ? { 'Content-Type': 'application/json' } : {};

  const response = await fetch(`${API_BASE_URL}/api/notifications${path}`, {
    method: options.method || 'GET',
    credentials: 'include',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(data?.error?.message || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.code = data?.error?.code;
    throw error;
  }

  return data;
}

export function getNotifications(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) {
      params.append(key, value);
    }
  });
  const query = params.toString();
  return request(query ? `?${query}` : '');
}

export function acknowledgeNotification(id) {
  return request(`/${id}/acknowledge`, { method: 'POST' });
}

export function resendNotification(id) {
  return request(`/${id}/resend`, { method: 'POST' });
}

export function saveFcmToken(token) {
  return request('/fcm-token', { method: 'POST', body: { token } });
}
