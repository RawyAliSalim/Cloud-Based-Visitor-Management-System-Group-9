import { useCallback, useEffect, useState } from 'react';
import { checkInVisit, checkOutVisit, getVisits } from '../api/checkin';
import VisitTable from '../components/VisitTable';

function summarizeNotifications(notifications = []) {
  if (notifications.length === 0) {
    return 'Host notification could not be recorded.';
  }
  return notifications
    .map((item) => `${item.channel === 'email' ? 'Email' : 'Push'}: ${item.status}`)
    .join(', ');
}

export default function CheckInOut() {
  const [expected, setExpected] = useState([]);
  const [checkedIn, setCheckedIn] = useState([]);
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [expectedVisits, checkedInVisits] = await Promise.all([
        getVisits({ status: 'Expected', visitor: applied }),
        getVisits({ status: 'Checked-in', visitor: applied })
      ]);
      setExpected(expectedVisits);
      setCheckedIn(checkedInVisits);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [applied]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCheckIn(visit) {
    setBusyId(visit._id);
    setError('');
    setMessage('');
    try {
      const result = await checkInVisit(visit._id);
      setMessage(`${result.visitorId?.fullName || 'Visitor'} checked in. ${summarizeNotifications(result.notifications)}`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleCheckOut(visit) {
    setBusyId(visit._id);
    setError('');
    setMessage('');
    try {
      const result = await checkOutVisit(visit._id);
      setMessage(`${result.visitorId?.fullName || 'Visitor'} checked out.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  function handleSearch(event) {
    event.preventDefault();
    setApplied(search.trim());
  }

  const buttonClass = 'rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50';

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-gray-900">Check-in / Check-out</h1>
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Visitor name"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <button type="submit" className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white">
            Search
          </button>
        </form>
      </div>

      {message && <p className="rounded-md bg-green-50 p-3 text-sm text-green-800">{message}</p>}
      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-500">Loading visits...</p>
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-gray-900">Expected visitors</h2>
            <VisitTable
              visits={expected}
              renderActions={(visit) => (
                <button
                  type="button"
                  onClick={() => handleCheckIn(visit)}
                  disabled={busyId === visit._id}
                  className={`${buttonClass} bg-green-600 hover:bg-green-700`}
                >
                  {busyId === visit._id ? 'Checking in...' : 'Check in'}
                </button>
              )}
            />
          </section>
          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-gray-900">Checked-in visitors</h2>
            <VisitTable
              visits={checkedIn}
              renderActions={(visit) => (
                <button
                  type="button"
                  onClick={() => handleCheckOut(visit)}
                  disabled={busyId === visit._id}
                  className={`${buttonClass} bg-gray-700 hover:bg-gray-800`}
                >
                  {busyId === visit._id ? 'Checking out...' : 'Check out'}
                </button>
              )}
            />
          </section>
        </>
      )}
    </div>
  );
}
