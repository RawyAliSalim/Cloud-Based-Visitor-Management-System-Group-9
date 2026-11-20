import { useState } from 'react';
import { searchVisitors } from '../api/visits';

export function toLocalInput(value) {
  const date = value ? new Date(value) : new Date();
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

const EMPTY_VALUES = {
  visitorId: '',
  fullName: '',
  email: '',
  phone: '',
  company: '',
  hostId: '',
  purpose: '',
  expectedArrival: toLocalInput()
};

const inputClass = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm';

export default function VisitForm({
  initialValues,
  hosts = [],
  canChooseHost,
  canLookup,
  submitLabel,
  submitting,
  onSubmit
}) {
  const [values, setValues] = useState({ ...EMPTY_VALUES, ...initialValues });
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [lookupError, setLookupError] = useState('');
  const [searching, setSearching] = useState(false);

  function handleChange(event) {
    const { name, value } = event.target;
    setValues((current) => ({ ...current, [name]: value }));
  }

  async function handleLookup() {
    setLookupError('');
    setResults([]);
    if (search.trim().length < 2) {
      setLookupError('Type at least 2 characters to search.');
      return;
    }
    setSearching(true);
    try {
      const visitors = await searchVisitors(search.trim());
      setResults(visitors);
      if (visitors.length === 0) {
        setLookupError('No returning visitor found.');
      }
    } catch (err) {
      setLookupError(err.message);
    } finally {
      setSearching(false);
    }
  }

  function selectVisitor(visitor) {
    setValues((current) => ({
      ...current,
      visitorId: visitor._id,
      fullName: visitor.fullName || '',
      email: visitor.email || '',
      phone: visitor.phone || '',
      company: visitor.company || ''
    }));
    setResults([]);
    setSearch('');
  }

  function clearVisitor() {
    setValues((current) => ({ ...current, visitorId: '', fullName: '', email: '', phone: '', company: '' }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    const payload = {
      fullName: values.fullName.trim(),
      email: values.email.trim(),
      phone: values.phone.trim(),
      company: values.company.trim(),
      purpose: values.purpose.trim(),
      expectedArrival: new Date(values.expectedArrival).toISOString()
    };
    if (values.visitorId) {
      payload.visitorId = values.visitorId;
    }
    if (canChooseHost) {
      payload.hostId = values.hostId;
    }
    onSubmit(payload);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border border-gray-200 bg-white p-6">
      {canLookup && (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">Returning visitor lookup</label>
          <div className="flex gap-2">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name, email or phone"
              className={inputClass}
            />
            <button
              type="button"
              onClick={handleLookup}
              disabled={searching}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {searching ? 'Searching...' : 'Search'}
            </button>
          </div>
          {lookupError && <p className="text-sm text-gray-500">{lookupError}</p>}
          {results.length > 0 && (
            <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
              {results.map((visitor) => (
                <li key={visitor._id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span>
                    {visitor.fullName}
                    {visitor.company && ` · ${visitor.company}`}
                    {visitor.email && ` · ${visitor.email}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => selectVisitor(visitor)}
                    className="rounded-md bg-gray-900 px-2.5 py-1 text-xs font-medium text-white"
                  >
                    Use
                  </button>
                </li>
              ))}
            </ul>
          )}
          {values.visitorId && (
            <p className="text-sm text-green-700">
              Using saved details for {values.fullName}.{' '}
              <button type="button" onClick={clearVisitor} className="underline">
                New visitor instead
              </button>
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Visitor full name *</label>
          <input name="fullName" value={values.fullName} onChange={handleChange} required minLength={2} maxLength={100} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Company</label>
          <input name="company" value={values.company} onChange={handleChange} maxLength={100} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
          <input type="email" name="email" value={values.email} onChange={handleChange} maxLength={254} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Phone</label>
          <input name="phone" value={values.phone} onChange={handleChange} maxLength={20} className={inputClass} />
        </div>
        {canChooseHost && (
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Host *</label>
            <select name="hostId" value={values.hostId} onChange={handleChange} required className={inputClass}>
              <option value="">Select a host</option>
              {hosts.map((host) => (
                <option key={host._id} value={host._id}>
                  {host.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Expected arrival *</label>
          <input
            type="datetime-local"
            name="expectedArrival"
            value={values.expectedArrival}
            onChange={handleChange}
            required
            className={inputClass}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-gray-700">Purpose of visit *</label>
          <input name="purpose" value={values.purpose} onChange={handleChange} required maxLength={200} className={inputClass} />
        </div>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {submitting ? 'Saving...' : submitLabel}
      </button>
    </form>
  );
}
