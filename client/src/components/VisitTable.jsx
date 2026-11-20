import { Link } from 'react-router-dom';
import StatusBadge from './StatusBadge';

export function formatDateTime(value) {
  return value ? new Date(value).toLocaleString() : '-';
}

export default function VisitTable({ visits, showHost = true, renderActions }) {
  if (visits.length === 0) {
    return <p className="text-sm text-gray-500">No visits found.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
          <tr>
            <th className="px-4 py-3">Visitor</th>
            {showHost && <th className="px-4 py-3">Host</th>}
            <th className="px-4 py-3">Purpose</th>
            <th className="px-4 py-3">Expected</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Checked in</th>
            <th className="px-4 py-3">Checked out</th>
            {renderActions && <th className="px-4 py-3" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {visits.map((visit) => (
            <tr key={visit._id}>
              <td className="px-4 py-3">
                <Link to={`/visits/${visit._id}`} className="font-medium text-blue-700 hover:underline">
                  {visit.visitorId?.fullName || 'Visitor'}
                </Link>
                {visit.visitorId?.company && <div className="text-xs text-gray-500">{visit.visitorId.company}</div>}
              </td>
              {showHost && <td className="px-4 py-3">{visit.hostId?.name || '-'}</td>}
              <td className="px-4 py-3">{visit.purpose}</td>
              <td className="px-4 py-3">{formatDateTime(visit.expectedArrival)}</td>
              <td className="px-4 py-3">
                <StatusBadge status={visit.status} />
              </td>
              <td className="px-4 py-3">{formatDateTime(visit.checkInTime)}</td>
              <td className="px-4 py-3">{formatDateTime(visit.checkOutTime)}</td>
              {renderActions && <td className="px-4 py-3 text-right">{renderActions(visit)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
