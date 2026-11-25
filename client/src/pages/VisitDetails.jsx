import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { checkInVisit, checkOutVisit, getVisit } from '../api/checkin';
import { cancelVisit } from '../api/visits';
import { getNotifications } from '../api/notifications';
import StatusBadge from '../components/StatusBadge';
import { formatDateTime, formatMinutes } from '../components/VisitTable';

const CHANNEL_NAMES = { email: 'email', push: 'browser push' };

// Says what really happened to the host notifications instead of always "Host notified".
function checkInMessage(result) {
  const notifications = result?.notifications || [];
  const sent = notifications.filter((item) => item.status === 'Sent').map((item) => CHANNEL_NAMES[item.channel]);
  const retrying = notifications.filter((item) => item.status === 'Retrying');
  const queued = notifications.filter((item) => item.status === 'Queued');
  if (sent.length > 0) {
    return `Visitor checked in. Host notified by ${sent.join(' and ')}.`;
  }
  if (queued.length > 0) {
    return 'Visitor checked in. The host notification is being sent; its status appears below in a few seconds.';
  }
  if (retrying.length > 0) {
    return 'Visitor checked in. The host notification hit a temporary error and will be retried automatically.';
  }
  return 'Visitor checked in, but the host could not be notified. Resend it from the notifications below or contact the host.';
}

function Field({ label, children }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-900">{children || '-'}</dd>
    </div>
  );
}

export default function VisitDetails() {
  const { id } = useParams();
  const location = useLocation();
  const { user } = useAuth();
  const isStaff = user.role === 'front-desk' || user.role === 'admin';
  const [visit, setVisit] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState(location.state?.message || '');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getVisit(id);
      setVisit(data);
      const list = await getNotifications({ visitId: id }).catch(() => []);
      setNotifications(list);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // successMessage can be text or a function that builds the text from the API result.
  async function runAction(action, successMessage) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await action(id);
      setMessage(typeof successMessage === 'function' ? successMessage(result) : successMessage);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function handleCancel() {
    if (window.confirm('Cancel this visit? It will stay in the log as Cancelled.')) {
      runAction(cancelVisit, 'Visit cancelled.');
    }
  }

  if (loading && !visit) {
    return <p className="p-6 text-sm text-gray-500">Loading visit...</p>;
  }

  if (!visit) {
    return <p className="m-6 rounded-md bg-red-50 p-3 text-sm text-red-800">{error || 'Visit not found.'}</p>;
  }

  const visitor = visit.visitorId || {};
  const acknowledged = notifications.find((item) => item.acknowledgedAt);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-gray-900">{visitor.fullName || 'Visit'}</h1>
          <StatusBadge status={visit.status} />
        </div>
        <div className="flex flex-wrap gap-2">
          {visit.status === 'Expected' && (
            <>
              <Link
                to={`/visits/${id}/edit`}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                Edit
              </Link>
              <button
                type="button"
                onClick={handleCancel}
                disabled={busy}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                Cancel visit
              </button>
            </>
          )}
          {isStaff && visit.status === 'Expected' && (
            <button
              type="button"
              onClick={() => runAction(checkInVisit, checkInMessage)}
              disabled={busy}
              className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              Check in
            </button>
          )}
          {isStaff && visit.status === 'Checked-in' && (
            <button
              type="button"
              onClick={() => runAction(checkOutVisit, 'Visitor checked out.')}
              disabled={busy}
              className="rounded-md bg-gray-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              Check out
            </button>
          )}
        </div>
      </div>

      {message && <p className="rounded-md bg-green-50 p-3 text-sm text-green-800">{message}</p>}
      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      <section className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Visit details</h2>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Field label="Visitor">{visitor.fullName}</Field>
          <Field label="Company">{visitor.company}</Field>
          {isStaff && <Field label="Email">{visitor.email}</Field>}
          {isStaff && <Field label="Phone">{visitor.phone}</Field>}
          <Field label="Host">{visit.hostId?.name}</Field>
          <Field label="Purpose">{visit.purpose}</Field>
          <Field label="Expected arrival">{formatDateTime(visit.expectedArrival)}</Field>
          <Field label="Registered by">{visit.createdBy?.name}</Field>
          <Field label="Checked in">
            {visit.checkInTime && `${formatDateTime(visit.checkInTime)}${visit.checkedInBy ? ` by ${visit.checkedInBy.name}` : ''}`}
          </Field>
          <Field label="Checked out">
            {visit.checkOutTime && `${formatDateTime(visit.checkOutTime)}${visit.checkedOutBy ? ` by ${visit.checkedOutBy.name}` : ''}`}
          </Field>
          {visit.durationMinutes !== undefined && (
            <Field label={visit.status === 'Checked-in' ? 'On site for' : 'Visit length'}>
              {formatMinutes(visit.durationMinutes)}
              {visit.overstay && ' (overstay)'}
            </Field>
          )}
          {visit.cancelledAt && <Field label="Cancelled">{formatDateTime(visit.cancelledAt)}</Field>}
          <Field label="Created">{formatDateTime(visit.createdAt)}</Field>
        </dl>
      </section>

      {visit.statusHistory?.length > 0 && (
        <section className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Status history</h2>
          <ol className="space-y-2 border-l-2 border-gray-200 pl-4 text-sm">
            {visit.statusHistory.map((entry, index) => (
              <li key={`${entry.to}-${index}`} className="flex flex-wrap items-center gap-2">
                <StatusBadge status={entry.to} />
                <span className="text-gray-700">{formatDateTime(entry.at)}</span>
                {entry.by?.name && <span className="text-gray-500">by {entry.by.name}</span>}
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-gray-900">Host notifications</h2>
          {notifications.length > 0 && (
            <span className={`text-sm font-medium ${acknowledged ? 'text-green-700' : 'text-amber-700'}`}>
              {acknowledged
                ? `Acknowledged by host at ${formatDateTime(acknowledged.acknowledgedAt)}`
                : 'Not acknowledged yet'}
            </span>
          )}
        </div>
        {notifications.length === 0 ? (
          <p className="text-sm text-gray-500">No notifications for this visit yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100 text-sm">
            {notifications.map((item) => (
              <li key={item._id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {item.channel === 'email' ? 'Email' : 'Browser push'} · {formatDateTime(item.createdAt)}
                  {item.resendOf && ' · Resend'}
                </span>
                <span className={item.status === 'Sent' ? 'text-green-700' : 'text-red-700'}>
                  Delivery: {item.status}
                  {(item.status === 'Failed' || item.status === 'Retrying') && item.error && ` (${item.error})`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
