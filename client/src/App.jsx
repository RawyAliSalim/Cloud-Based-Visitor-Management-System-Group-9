import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import VisitorLog from './pages/VisitorLog';
import RegisterVisit from './pages/RegisterVisit';
import EditVisit from './pages/EditVisit';
import VisitDetails from './pages/VisitDetails';
import CheckInOut from './pages/CheckInOut';
import OnSite from './pages/OnSite';
import Notifications from './pages/Notifications';

const STAFF_ROLES = ['front-desk', 'admin'];

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/visits" replace />} />
        <Route path="visits" element={<VisitorLog />} />
        <Route path="visits/new" element={<RegisterVisit />} />
        <Route path="visits/:id" element={<VisitDetails />} />
        <Route path="visits/:id/edit" element={<EditVisit />} />
        <Route
          path="check-in"
          element={
            <ProtectedRoute roles={STAFF_ROLES}>
              <CheckInOut />
            </ProtectedRoute>
          }
        />
        <Route
          path="on-site"
          element={
            <ProtectedRoute roles={STAFF_ROLES}>
              <OnSite />
            </ProtectedRoute>
          }
        />
        <Route path="notifications" element={<Notifications />} />
      </Route>
      <Route path="*" element={<Navigate to="/visits" replace />} />
    </Routes>
  );
}
