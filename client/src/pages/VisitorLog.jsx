import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getHosts } from '../api/auth';
import { getVisits } from '../api/checkin';
import VisitTable from '../components/VisitTable';

const EMPTY_FILTERS = { visitor: '', status: '', hostId: '', from: '', to: '' };
const inputClass = 'rounded-md border border-gray-300 px-3 py-2 text-sm';

function toQueryFilters(filters) {
  return {
    visitor: filters.visitor.trim(),
    status: filters.status,
    hostId: filters.hostId,
    from: filters.from ? new Date(`${filters.from}T00:00:00`).toISOString() : '',
    to: filters.to ? new Date(`${filters.to}T23:59:59.999`).toISOString() : ''
  };
}

export default function VisitorLog() {
  const { user } = useAuth();
  const isHost = user.role === 'host';
  const [visits, setVisits] = useState([]);
  const [hosts, setHosts] = useState([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [applied, setApplied] = useState(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setVisits(await getVisits(toQueryFilters(applied)));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [applied]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!isHost) {
      getHosts()
        .then(setHosts)
        .catch(() => setHosts([]));
    }
  }, [isHost]);

  function handleChange(event) {
    const { name, value } = event.target;
    setFilters((current) => ({ ...current, [name]: value }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    setApplied({ ...filters });
  }

  function handleClear() {
    setFilters(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold text-gray-900">{isHost ? 'My visits' : 'Visitor log'}</h1>

      <form onSubmit={handleSubmit} className="grid gap-3 rounded-lg border border-gray-200 bg-white p-4 sm:grid-cols-3 lg:grid-cols-6">
        <input name="visitor" value={filters.visitor} onChange={handleChange} placeholder="Visitor name" className={inputClass} />
        <select name="status" value={filters.status} onChange={handleChange} className={inputClass}>
          <option value="">All statuses</option>
          <option value="Expected">Expected</option>
          <option value="Checked-in">Checked-in</option>
          <option value="Checked-out">Checked-out</option>
          <option value="Cancelled">Cancelled</option>
        </select>
        {!isHost && (
          <select name="hostId" value={filters.hostId} onChange={handleChange} className={inputClass}>
            <option value="">All hosts</option>
            {hosts.map((host) => (
              <option key={host._id} value={host._id}>
                {host.name}
              </option>
            ))}
          </select>
        )}
        <input type="date" name="from" value={filters.from} onChange={handleChange} className={inputClass} aria-label="From date" />
        <input type="date" name="to" value={filters.to} onChange={handleChange} className={inputClass} aria-label="To date" />
        <div className="flex gap-2">
          <button type="submit" className="flex-1 rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800">
            Apply
          </button>
          <button type="button" onClick={handleClear} className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
            Clear
          </button>
        </div>
      </form>

      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {loading ? <p className="text-sm text-gray-500">Loading visits...</p> : <VisitTable visits={visits} showHost={!isHost} />}
    </div>
  );
}
