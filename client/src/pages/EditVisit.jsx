import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getHosts } from '../api/auth';
import { getVisit } from '../api/checkin';
import { updateVisit } from '../api/visits';
import VisitForm, { toLocalInput } from '../components/VisitForm';

export default function EditVisit() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isHost = user.role === 'host';
  const [visit, setVisit] = useState(null);
  const [hosts, setHosts] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setLoading(true);
    getVisit(id)
      .then(setVisit)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    if (!isHost) {
      getHosts()
        .then(setHosts)
        .catch((err) => setError(err.message));
    }
  }, [id, isHost]);

  async function handleSubmit(payload) {
    setError('');
    setSubmitting(true);
    const changes = { ...payload };
    delete changes.visitorId;
    if (changes.expectedArrival === new Date(visit.expectedArrival).toISOString()) {
      delete changes.expectedArrival;
    }
    if (!changes.email) {
      delete changes.email;
    }
    if (!changes.phone) {
      delete changes.phone;
    }
    try {
      await updateVisit(id, changes);
      navigate(`/visits/${id}`, { state: { message: 'Visit updated.' } });
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  if (loading) {
    return <p className="p-6 text-sm text-gray-500">Loading visit...</p>;
  }

  if (!visit) {
    return <p className="m-6 rounded-md bg-red-50 p-3 text-sm text-red-800">{error || 'Visit not found.'}</p>;
  }

  if (visit.status !== 'Expected') {
    return (
      <div className="mx-auto max-w-3xl space-y-3 p-6">
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          Only Expected visits can be edited. This visit is {visit.status}.
        </p>
        <Link to={`/visits/${id}`} className="text-sm text-blue-700 hover:underline">
          Back to visit
        </Link>
      </div>
    );
  }

  const visitor = visit.visitorId || {};

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold text-gray-900">Edit visit</h1>
      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <VisitForm
        initialValues={{
          fullName: visitor.fullName || '',
          email: visitor.email || '',
          phone: visitor.phone || '',
          company: visitor.company || '',
          hostId: visit.hostId?._id || '',
          purpose: visit.purpose,
          expectedArrival: toLocalInput(visit.expectedArrival)
        }}
        hosts={hosts}
        canChooseHost={!isHost}
        canLookup={false}
        submitLabel="Save changes"
        submitting={submitting}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
