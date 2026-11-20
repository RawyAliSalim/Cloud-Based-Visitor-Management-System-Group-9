import { initializeApp, getApps } from 'firebase/app';
import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;

export function isPushConfigured() {
  return Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.projectId &&
      firebaseConfig.messagingSenderId &&
      firebaseConfig.appId &&
      vapidKey
  );
}

async function getMessagingInstance() {
  if (!isPushConfigured()) {
    throw new Error('Browser notifications are not configured for this deployment');
  }

  if (!(await isSupported())) {
    throw new Error('This browser does not support push notifications');
  }

  const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
  return getMessaging(app);
}

export async function enablePushNotifications() {
  const messaging = await getMessagingInstance();

  const permission = await window.Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted');
  }

  const params = new URLSearchParams(
    Object.entries(firebaseConfig).filter(([, value]) => Boolean(value))
  );
  const registration = await navigator.serviceWorker.register(`/firebase-messaging-sw.js?${params}`);

  const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
  if (!token) {
    throw new Error('Could not get a push token from Firebase');
  }

  return token;
}

export async function listenForForegroundMessages(callback) {
  if (!isPushConfigured() || !(await isSupported())) {
    return () => {};
  }

  const messaging = await getMessagingInstance();
  return onMessage(messaging, callback);
}
