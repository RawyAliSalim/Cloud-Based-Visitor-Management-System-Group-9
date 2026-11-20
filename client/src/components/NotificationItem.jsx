const STATUS_STYLES = {
  Sent: 'bg-green-100 text-green-800',
  Failed: 'bg-red-100 text-red-800'
};

const CHANNEL_LABELS = {
  email: 'Email',
  push: 'Browser push'
};

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : '-';
}

function personName(person) {
  return person && typeof person === 'object' ? person.fullName || person.name || '' : '';
}

function refId(value) {
  return value && typeof value === 'object' ? value._id : value;
}

export default function NotificationItem({ notification, canAcknowledge, canResend, busy, onAcknowledge, onResend }) {
  const visit = notification.visitId;
  const visitorName = personName(visit && visit.visitorId) || 'Visitor';
  const hostName = personName(notification.hostId);
  const acknowledged = Boolean(notification.acknowledgedAt);
  const failed = notification.status === 'Failed';

  return (
    <li className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="font-medium text-gray-900">{visitorName} checked in</p>
          <p className="text-sm text-gray-600">
            {CHANNEL_LABELS[notification.channel] || notification.channel}
            {hostName && ` · Host: ${hostName}`}
          </p>
          <p className="text-xs text-gray-500">Visit ID: {refId(visit)}</p>
          <p className="text-xs text-gray-500">
            Attempted: {formatDate(notification.createdAt)}
            {notification.resendOf && ' · Resend attempt'}
          </p>
          {failed && notification.error && (
            <p className="text-xs text-red-600">Reason: {notification.error}</p>
          )}
        </div>

        <div className="flex flex-col items-end gap-2">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[notification.status] || 'bg-gray-100 text-gray-800'}`}>
            {notification.status}
          </span>
          <span className={`text-xs ${acknowledged ? 'text-green-700' : 'text-gray-500'}`}>
            {acknowledged ? `Acknowledged ${formatDate(notification.acknowledgedAt)}` : 'Not acknowledged'}
          </span>

          {canAcknowledge && !acknowledged && (
            <button
              type="button"
              onClick={() => onAcknowledge(notification._id)}
              disabled={busy}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? 'Saving...' : 'Acknowledge'}
            </button>
          )}

          {canResend && failed && (
            <button
              type="button"
              onClick={() => onResend(notification._id)}
              disabled={busy}
              className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {busy ? 'Resending...' : 'Resend'}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
