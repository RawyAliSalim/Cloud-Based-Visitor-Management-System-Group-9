import { useCallback, useEffect, useState } from 'react';
import { checkOutVisit, getOnSiteVisits } from '../api/checkin';
import VisitTable from '../components/VisitTable';

const REFRESH_MS = 15000;

export default function OnSite() {
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [updatedAt, setUpdatedAt] = useState(null);

  // quiet=true refreshes in the background without the loading state.
  const load = useCallback(async (quiet = false) => {
    if (!quiet) {
      setLoading(true);
    }
    setError('');
    try {
      setVisits(await getOnSiteVisits());
      setUpdatedAt(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Keep the board current while the page is open (paused while the tab is hidden).
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        load(true);
      }
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const overstays = visits.filter((visit) => visit.overstay).length;

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

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Visitors on site ({visits.length})</h1>
          <p className="text-xs text-gray-500">
            Updates every {REFRESH_MS / 1000} s{updatedAt && ` · last update ${updatedAt.toLocaleTimeString()}`}
            {overstays > 0 && ` · ${overstays} overstaying`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => load()}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>
      {message && <p className="rounded-md bg-green-50 p-3 text-sm text-green-800">{message}</p>}
      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {loading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : (
        <VisitTable
          visits={visits}
          showDuration
          renderActions={(visit) => (
            <button
              type="button"
              onClick={() => handleCheckOut(visit)}
              disabled={busyId === visit._id}
              className="rounded-md bg-gray-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {busyId === visit._id ? 'Checking out...' : 'Check out'}
            </button>
          )}
        />
      )}
    </div>
  );
}
