import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ roles, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <p className="p-6 text-sm text-gray-500">Loading...</p>;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (roles && !roles.includes(user.role)) {
    return (
      <div className="p-6">
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">You do not have access to this page.</p>
      </div>
    );
  }

  return children;
}
