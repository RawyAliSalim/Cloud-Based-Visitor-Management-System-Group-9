import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getActivityReport, visitExportUrl } from '../api/checkin';
import { formatDateTime } from '../components/VisitTable';

function toDateInput(date) {
  return date.toISOString().slice(0, 10);
}

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">{value ?? '-'}</p>
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

function percent(value) {
  return `${Math.round((value || 0) * 100)}%`;
}

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export default function Reports() {
  const [from, setFrom] = useState(toDateInput(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)));
  const [to, setTo] = useState(toDateInput(new Date()));
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const filters = {
    from: new Date(`${from}T00:00:00`).toISOString(),
    to: new Date(`${to}T23:59:59`).toISOString(),
    tz: timezone
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setReport(await getActivityReport(filters));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const maxDay = report ? Math.max(1, ...report.byDay.map((day) => day.registered)) : 1;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold text-gray-900">Visitor activity report</h1>
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <label className="flex flex-col">
            <span className="text-xs text-gray-500">From</span>
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1.5" />
          </label>
          <label className="flex flex-col">
            <span className="text-xs text-gray-500">To</span>
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1.5" />
          </label>
          <a
            href={visitExportUrl(filters)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-gray-700 hover:bg-gray-50"
          >
            Export CSV
          </a>
        </div>
      </div>

      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {loading && !report && <p className="text-sm text-gray-500">Loading report...</p>}

      {report && (
        <>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Registered" value={report.totals.registered} />
            <Stat label="On site now" value={report.totals.onSite} />
            <Stat label="Completed" value={report.totals.checkedOut} />
            <Stat label="Cancelled" value={report.totals.cancelled} hint={`${percent(report.rates.cancellationRate)} of visits`} />
            <Stat label="No-shows" value={report.totals.noShows} hint="Expected, never arrived" />
            <Stat label="Attendance" value={percent(report.rates.attendanceRate)} />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Average visit" value={report.visitLength.averageMinutes !== null ? `${report.visitLength.averageMinutes} min` : '-'} hint={`${report.visitLength.completedVisits} completed visits`} />
            <Stat label="Longest visit" value={report.visitLength.longestMinutes !== null ? `${report.visitLength.longestMinutes} min` : '-'} />
            <Stat
              label="Late arrivals"
              value={report.punctuality.lateArrivals}
              hint={`More than ${report.punctuality.lateThresholdMinutes} min after the expected time`}
            />
          </div>

          <section className="rounded-lg border border-gray-200 bg-white p-6">
            <h2 className="mb-3 text-lg font-semibold text-gray-900">Visits per day</h2>
            {report.byDay.length === 0 ? (
              <p className="text-sm text-gray-500">No visits in this period.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {report.byDay.map((day) => (
                  <li key={day.date} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-gray-600">{day.date}</span>
                    <span className="h-3 rounded bg-blue-500" style={{ width: `${(day.registered / maxDay) * 60}%` }} />
                    <span className="text-gray-700">
                      {day.registered} registered · {day.checkedIn} arrived · {day.cancelled} cancelled
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-lg border border-gray-200 bg-white p-6">
              <h2 className="mb-3 text-lg font-semibold text-gray-900">By host</h2>
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs uppercase text-gray-500">
                  <tr>
                    <th className="py-1">Host</th>
                    <th className="py-1">Visits</th>
                    <th className="py-1">Completed</th>
                    <th className="py-1">Avg min</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {report.byHost.map((row) => (
                    <tr key={row.hostId}>
                      <td className="py-1.5">{row.name}</td>
                      <td className="py-1.5">{row.visits}</td>
                      <td className="py-1.5">{row.checkedOut}</td>
                      <td className="py-1.5">{row.averageMinutes ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="rounded-lg border border-gray-200 bg-white p-6">
              <h2 className="mb-3 text-lg font-semibold text-gray-900">Busiest check-in hours</h2>
              {report.peakHours.length === 0 ? (
                <p className="text-sm text-gray-500">No check-ins in this period.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {report.peakHours.slice(0, 6).map((row) => (
                    <li key={row.hour}>
                      {String(row.hour).padStart(2, '0')}:00 – {String(row.hour).padStart(2, '0')}:59 · {row.checkIns} check-ins
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="rounded-lg border border-gray-200 bg-white p-6">
            <h2 className="mb-3 text-lg font-semibold text-gray-900">
              On site longer than {Math.round(report.overstayThresholdMinutes / 60)} hours
            </h2>
            {report.overstays.length === 0 ? (
              <p className="text-sm text-gray-500">Nobody is overstaying.</p>
            ) : (
              <ul className="divide-y divide-gray-100 text-sm">
                {report.overstays.map((row) => (
                  <li key={row.visitId} className="flex flex-wrap justify-between gap-2 py-2">
                    <Link to={`/visits/${row.visitId}`} className="font-medium text-blue-700 hover:underline">
                      {row.visitor || 'Visitor'}
                    </Link>
                    <span className="text-gray-600">
                      Host {row.host || '-'} · since {formatDateTime(row.checkInTime)} · {Math.round(row.minutesOnSite / 60)} h
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <p className="text-xs text-gray-500">Generated {formatDateTime(report.generatedAt)} · times in {timezone}</p>
        </>
      )}
    </div>
  );
}
