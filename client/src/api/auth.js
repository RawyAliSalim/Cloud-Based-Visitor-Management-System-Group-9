import { apiRequest } from './client';

export function login(email, password) {
  return apiRequest('/api/auth/login', { method: 'POST', body: { email, password } });
}

export function logout() {
  return apiRequest('/api/auth/logout', { method: 'POST' });
}

export function getCurrentUser() {
  return apiRequest('/api/auth/me');
}

export function getHosts() {
  return apiRequest('/api/auth/hosts');
}
