import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const LINKS = [
  { to: '/visits', label: 'Visitor log', roles: ['host', 'front-desk', 'admin'], end: true },
  { to: '/visits/new', label: 'Register visit', roles: ['host', 'front-desk', 'admin'] },
  { to: '/check-in', label: 'Check-in / out', roles: ['front-desk', 'admin'] },
  { to: '/on-site', label: 'On site', roles: ['front-desk', 'admin'] },
  { to: '/notifications', label: 'Notifications', roles: ['host', 'front-desk', 'admin'] }
];

const ROLE_LABELS = { host: 'Host', 'front-desk': 'Front desk', admin: 'Admin' };

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  const links = LINKS.filter((link) => link.roles.includes(user.role));

  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-3">
          <span className="text-lg font-semibold text-gray-900">Visitor Management</span>
          <nav className="flex flex-wrap gap-1">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 text-sm font-medium ${
                    isActive ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">
              {user.name} · {ROLE_LABELS[user.role] || user.role}
            </span>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              Log out
            </button>
          </div>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
