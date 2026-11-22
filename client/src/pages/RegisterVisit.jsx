import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getHosts } from '../api/auth';
import { createVisit } from '../api/visits';
import VisitForm, { toLocalInput } from '../components/VisitForm';

function newKey() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export default function RegisterVisit() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isHost = user.role === 'host';
  const [hosts, setHosts] = useState([]);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // One key per attempt: reused if the same submission is retried, replaced after a rejection.
  const idempotencyKey = useRef(newKey());

  useEffect(() => {
    if (isHost) {
      return;
    }
    getHosts()
      .then(setHosts)
      .catch((err) => setError({ message: err.message }));
  }, [isHost]);

  async function handleSubmit(payload) {
    if (submitting) {
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const visit = await createVisit(payload, idempotencyKey.current);
      const message = visit.registration?.returning
        ? 'Visit registered. Returning visitor recognised, saved details were reused.'
        : 'Visit registered.';
      navigate(`/visits/${visit._id}`, { state: { message } });
    } catch (err) {
      if (err.status && err.status < 500) {
        idempotencyKey.current = newKey();
      }
      setError({ message: err.message, code: err.code, details: err.details });
      setSubmitting(false);
    }
  }

  const initialArrival = isHost ? toLocalInput(new Date(Date.now() + 60 * 60 * 1000)) : toLocalInput();

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold text-gray-900">{isHost ? 'Pre-register a visitor' : 'Register a visit'}</h1>
      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          <p>{error.message}</p>
          {error.code === 'DUPLICATE_VISIT' && error.details?.visitId && (
            <Link to={`/visits/${error.details.visitId}`} className="mt-1 inline-block font-medium underline">
              Open the existing visit
            </Link>
          )}
        </div>
      )}
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
