const STATUS_STYLES = {
  Pending: 'bg-blue-100 text-blue-800',
  Sent: 'bg-green-100 text-green-800',
  Retrying: 'bg-amber-100 text-amber-800',
  Failed: 'bg-red-100 text-red-800',
  Cancelled: 'bg-gray-200 text-gray-700'
};

const REASON_LABELS = {
  ALREADY_ACKNOWLEDGED: 'Stopped: host already acknowledged',
  VISIT_NO_LONGER_ON_SITE: 'Stopped: visitor already left'
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
  const failed = notification.status === 'Failed' || notification.status === 'Retrying';
  // channelConfigured comes from the server: false means this channel is not set up right now,
  // so a resend could never succeed and the button is hidden.
  const channelReady = notification.channelConfigured !== false;
  const resendable = failed && !notification.supersededBy && !acknowledged && channelReady;

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
            {notification.attempts > 1 && ` · ${notification.attempts} delivery attempts`}
          </p>
          {notification.status === 'Retrying' && notification.nextRetryAt && (
            <p className="text-xs text-amber-700">Next automatic retry: {formatDate(notification.nextRetryAt)}</p>
          )}
          {failed && notification.error && (
            <p className="text-xs text-red-600">Reason: {notification.error}</p>
          )}
          {notification.status === 'Cancelled' && (
            <p className="text-xs text-gray-500">{REASON_LABELS[notification.error] || 'Retries stopped'}</p>
          )}
          {notification.supersededBy && <p className="text-xs text-gray-500">Already resent</p>}
          {canResend && failed && !channelReady && !notification.supersededBy && !acknowledged && (
            <p className="text-xs text-gray-500">
              Resend not available: {CHANNEL_LABELS[notification.channel] || notification.channel} is not set up on this
              server.
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-2">
          <span
            title="Whether the email or push message reached the host (separate from acknowledgement)"
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[notification.status] || 'bg-gray-100 text-gray-800'}`}
          >
            Delivery: {notification.status}
          </span>
          <span className={`text-xs ${acknowledged ? 'text-green-700' : 'text-gray-500'}`}>
            {acknowledged ? `Acknowledged ${formatDate(notification.acknowledgedAt)}` : 'Not acknowledged'}
          </span>

          {canAcknowledge && !acknowledged && visit?.status === 'Checked-in' && (
            <button
              type="button"
              onClick={() => onAcknowledge(notification._id)}
              disabled={busy}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? 'Saving...' : 'Acknowledge'}
            </button>
          )}

          {canResend && resendable && (
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
