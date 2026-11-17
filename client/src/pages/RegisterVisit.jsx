import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getHosts } from '../api/auth';
import { createVisit } from '../api/visits';
import VisitForm, { toLocalInput } from '../components/VisitForm';

export default function RegisterVisit() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isHost = user.role === 'host';
  const [hosts, setHosts] = useState([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isHost) {
      return;
    }
    getHosts()
      .then(setHosts)
      .catch((err) => setError(err.message));
  }, [isHost]);

  async function handleSubmit(payload) {
    setError('');
    setSubmitting(true);
    try {
      const visit = await createVisit(payload);
      navigate(`/visits/${visit._id}`, { state: { message: 'Visit registered.' } });
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  const initialArrival = isHost ? toLocalInput(new Date(Date.now() + 60 * 60 * 1000)) : toLocalInput();

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold text-gray-900">{isHost ? 'Pre-register a visitor' : 'Register a visit'}</h1>
      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <VisitForm
        initialValues={{ expectedArrival: initialArrival }}
        hosts={hosts}
        canChooseHost={!isHost}
        canLookup={!isHost}
        submitLabel="Register visit"
        submitting={submitting}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
