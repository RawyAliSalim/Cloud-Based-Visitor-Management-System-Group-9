import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import NotificationItem from '../components/NotificationItem';
import {
  getNotifications,
  acknowledgeNotification,
  resendNotification,
  saveFcmToken
} from '../api/notifications';
import { enablePushNotifications, isPushConfigured, listenForForegroundMessages } from '../firebase';

const EMPTY_FILTERS = { visitId: '', hostId: '', status: '' };

export default function Notifications() {
  const { user } = useAuth();
  const isHost = user?.role === 'host';
  const isStaff = user?.role === 'front-desk' || user?.role === 'admin';

  const [notifications, setNotifications] = useState([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pushStatus, setPushStatus] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getNotifications(isHost ? {} : appliedFilters);
      setNotifications(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [isHost, appliedFilters]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!isHost || !isPushConfigured() || !('Notification' in window) || window.Notification.permission !== 'granted') {
      return;
    }
    enablePushNotifications()
      .then(saveFcmToken)
      .then(() => setPushStatus('Browser notifications are on.'))
      .catch(() => {});
  }, [isHost]);

  useEffect(() => {
    if (!isHost) {
      return undefined;
    }
    let active = true;
    let unsubscribe = () => {};
    listenForForegroundMessages((payload) => {
      setMessage(payload.notification?.body || 'A visitor has arrived.');
      load();
    })
      .then((stop) => {
        if (active) {
          unsubscribe = stop;
        } else {
          stop();
        }
      })
      .catch(() => {});
    return () => {
      active = false;
      unsubscribe();
    };
  }, [isHost, load]);

  async function handleEnablePush() {
    setError('');
    setPushStatus('');
    try {
      const token = await enablePushNotifications();
      const result = await saveFcmToken(token);
      setPushStatus(result.message);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleAcknowledge(id) {
    setBusyId(id);
    setError('');
    setMessage('');
    try {
      const updated = await acknowledgeNotification(id);
      setNotifications((list) =>
        list.map((item) => (item._id === id ? { ...item, acknowledgedAt: updated.acknowledgedAt } : item))
      );
      setMessage('Notification acknowledged.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleResend(id) {
    setBusyId(id);
    setError('');
    setMessage('');
    try {
      const attempt = await resendNotification(id);
      setMessage(
        attempt.status === 'Sent'
          ? 'Notification resent successfully.'
          : `Resend attempt failed: ${attempt.error || 'unknown reason'}`
      );
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  function handleFilterChange(event) {
    const { name, value } = event.target;
    setFilters((current) => ({ ...current, [name]: value }));
  }

  function handleFilterSubmit(event) {
    event.preventDefault();
    setAppliedFilters({
      visitId: filters.visitId.trim(),
      hostId: filters.hostId.trim(),
      status: filters.status
    });
  }

  function handleClearFilters() {
    setFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-gray-900">
          {isHost ? 'My notifications' : 'Notification history'}
        </h1>
        <button
          type="button"
          onClick={load}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {isHost && isPushConfigured() && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm text-blue-900">
            {pushStatus || 'Turn on browser notifications to be alerted when your visitor arrives.'}
          </p>
          <button
            type="button"
            onClick={handleEnablePush}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Enable browser notifications
          </button>
        </div>
      )}

      {isStaff && (
        <form onSubmit={handleFilterSubmit} className="grid gap-3 rounded-lg border border-gray-200 bg-white p-4 sm:grid-cols-4">
          <input
            name="visitId"
            value={filters.visitId}
            onChange={handleFilterChange}
            placeholder="Visit ID"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            name="hostId"
            value={filters.hostId}
            onChange={handleFilterChange}
            placeholder="Host ID"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <select
            name="status"
            value={filters.status}
            onChange={handleFilterChange}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">All statuses</option>
            <option value="Sent">Sent</option>
            <option value="Failed">Failed</option>
          </select>
          <div className="flex gap-2">
            <button type="submit" className="flex-1 rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800">
              Apply
            </button>
            <button
              type="button"
              onClick={handleClearFilters}
              className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Clear
            </button>
          </div>
        </form>
      )}

      {message && <p className="rounded-md bg-green-50 p-3 text-sm text-green-800">{message}</p>}
      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-500">Loading notifications...</p>
      ) : notifications.length === 0 ? (
        <p className="text-sm text-gray-500">No notifications found.</p>
      ) : (
        <ul className="space-y-3">
          {notifications.map((notification) => (
            <NotificationItem
              key={notification._id}
              notification={notification}
              canAcknowledge={isHost}
              canResend={isStaff}
              busy={busyId === notification._id}
              onAcknowledge={handleAcknowledge}
              onResend={handleResend}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
