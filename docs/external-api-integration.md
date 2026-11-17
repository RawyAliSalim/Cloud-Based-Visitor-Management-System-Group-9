# External API Integration Guide

Owner: Mohamed Haytham (External API integration lead)
For: Rawy Ali Salim, Mostafa Raafat Mohamed

The system uses two external APIs, both inside the Host Notification Service:

| API | Used for | Server file | Free plan |
|---|---|---|---|
| Brevo (REST API) | Arrival email to the host | `server/services/email.service.js` | 300 emails/day |
| Firebase Cloud Messaging | Browser push to the host | `server/services/push.service.js`, `server/config/firebase.js` | Free |

Your services do not call these APIs directly. You connect to them through the few lines below.

---

## 1. How it fits together

```
Front desk checks visitor in  (Mostafa: POST /api/visits/:id/check-in)
        │
        ▼
sendArrivalNotification(visit)          (Mohamed: notification.service.js)
        │
        ├── Brevo  → email to host
        └── FCM    → push to host's browser(s)
        │
        ▼
2 Notification docs saved (email + push), each "Sent" or "Failed"
        │
        ▼
Host acknowledges → front desk sees it on the visit record (Mostafa: VisitDetails.jsx)
```

`sendArrivalNotification` never throws. If email or push fails, it saves a `Failed` record and returns normally, so check-in always succeeds.

---

## 2. What Rawy needs to add

### 2.1 `server/models/User.js`: push token field
Add inside the User schema:
```js
fcmTokens: { type: [String], default: [] },
```
Without this field, browser tokens are not saved and push always fails with `NO_PUSH_TOKEN`.

The notification code also reads these User fields: `email`, `role`, and `name` (or `fullName`).

### 2.2 `server/app.js`: mount the routes
```js
const notificationRoutes = require('./routes/notifications.routes');
app.use('/api/notifications', notificationRoutes);
```
Mount it after the session middleware and before the error handler.

### 2.3 `client/src/App.jsx`: page route
```jsx
import Notifications from './pages/Notifications';
```
```jsx
<Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
```
Adjust the wrapper to match how `ProtectedRoute` is used for the other pages. Keep the path `/notifications`, because push clicks open that URL.

### 2.4 `client/src/components/Layout.jsx`: nav link
A link to `/notifications` visible to **all roles** (host, front-desk, admin). Hosts see "My notifications" and staff see the full history on the same page.

### 2.5 Contracts my code assumes
Please keep these names, or tell me so I can update my files:

| Item | Assumed |
|---|---|
| `server/middleware/requireAuth.js` | `module.exports = function requireAuth(req, res, next)` |
| `server/middleware/requireRole.js` | `module.exports = (...roles) => (req, res, next)` used as `requireRole('front-desk', 'admin')` |
| Session user | `req.session.user` with `_id` (or `id`) and `role` |
| Role values | `'host'`, `'front-desk'`, `'admin'` |
| Models | Registered as `User`, `Visit`, `Visitor` |
| `client/src/api/client.js` | `export const API_BASE_URL` (no trailing `/api`) |
| `client/src/context/AuthContext.jsx` | `export function useAuth()` returning `{ user }` with `user.role` |
| Requests | Sent with `credentials: 'include'` so the session cookie goes with them |

### 2.6 Visit and Visitor fields used
| Model | Fields read |
|---|---|
| Visit | `_id`, `hostId` (ref `User`), `visitorId` (ref `Visitor`), `status` |
| Visitor | `fullName` (or `name`) |

---

## 3. What Mostafa needs to add

### 3.1 `server/controllers/checkin.controller.js`: trigger the notification
At the top:
```js
const { sendArrivalNotification } = require('../services/notification.service');
```
In the check-in handler, **after** the visit is saved as `Checked-in` and **before** sending the response:
```js
await sendArrivalNotification(visit);
```
- Use `await`. On Vercel the function can be frozen after the response is sent, so the notification must finish first. It is capped at about 5 seconds.
- No `try/catch` is needed, because it never throws.
- It returns the saved Notification docs if you want to include them in the response.

### 3.2 `client/src/pages/VisitDetails.jsx`: show notification status
```jsx
import { getNotifications } from '../api/notifications';
```
```jsx
const [notifications, setNotifications] = useState([]);

useEffect(() => {
  getNotifications({ visitId: visit._id })
    .then(setNotifications)
    .catch(() => setNotifications([]));
}, [visit._id]);
```
```jsx
<ul>
  {notifications.map((n) => (
    <li key={n._id}>
      {n.channel === 'email' ? 'Email' : 'Browser push'}: {n.status}
      {n.acknowledgedAt ? ` · Acknowledged ${new Date(n.acknowledgedAt).toLocaleString()}` : ' · Not acknowledged'}
    </li>
  ))}
</ul>
```
Front-desk and admin can read any visit's notifications. A host only gets their own.

### 3.3 Deployment (cloud deployment lead)
- `client/public/firebase-messaging-sw.js` must be served at the site root as `/firebase-messaging-sw.js`. Make sure `vercel.json` rewrites do not send it to `index.html`.
- Add the environment variables from section 5 in **Vercel → Settings → Environment Variables**, then redeploy.
- `firebase-admin` must be installed where the serverless function runs. It is already in root and `server/package.json`.

### 3.4 Logging and monitoring
Delivery failures are logged only as short codes (for example `EMAIL_PROVIDER_ERROR_401`). No keys, tokens or email addresses go into logs.

---

## 4. Notification API reference

All routes need a logged-in session.

| Method | Endpoint | Roles | Success | Errors |
|---|---|---|---|---|
| GET | `/api/notifications?visitId=&hostId=&status=` | host (own only), front-desk, admin | 200 | 400, 401, 403 |
| POST | `/api/notifications/:id/acknowledge` | host (recipient only) | 200 | 400, 401, 403, 404, 409 |
| POST | `/api/notifications/:id/resend` | front-desk, admin | 201 | 400, 401, 403, 404, 409 |
| POST | `/api/notifications/fcm-token` body `{ "token": "..." }` | any logged-in user | 200 | 400, 401, 404, 415 |

Error shape:
```json
{ "error": { "code": "NOTIFICATION_ALREADY_ACKNOWLEDGED", "message": "Notification has already been acknowledged" } }
```

Example list item:
```json
{
  "_id": "665f...",
  "visitId": { "_id": "665a...", "status": "Checked-in", "visitorId": { "_id": "6659...", "fullName": "Sara Ali" } },
  "hostId": { "_id": "6650...", "name": "Dr. Ahmed" },
  "channel": "email",
  "status": "Sent",
  "sentAt": "2026-11-17T09:30:00.000Z",
  "acknowledgedAt": null,
  "createdAt": "2026-11-17T09:30:00.000Z"
}
```
Host emails and push tokens are never returned.

---

## 5. Environment variables

Already listed in `.env.example`. Real values go in a local `.env` and in Vercel only, never in git.

| Variable | Where | Source |
|---|---|---|
| `EMAIL_API_KEY` | server | Brevo → SMTP & API → API Keys |
| `EMAIL_FROM` | server | A sender email verified in Brevo |
| `FIREBASE_PROJECT_ID` | server | Firebase service account JSON `project_id` |
| `FIREBASE_CLIENT_EMAIL` | server | Firebase service account JSON `client_email` |
| `FIREBASE_PRIVATE_KEY` | server | Firebase service account JSON `private_key`, in quotes, with the `\n` characters kept |
| `APP_URL` | server | Deployed site URL, e.g. `https://<project>.vercel.app` |
| `VITE_FIREBASE_API_KEY` | client | Firebase web app config `apiKey` |
| `VITE_FIREBASE_AUTH_DOMAIN` | client | `authDomain` |
| `VITE_FIREBASE_PROJECT_ID` | client | `projectId` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | client | `messagingSenderId` |
| `VITE_FIREBASE_APP_ID` | client | `appId` |
| `VITE_FIREBASE_VAPID_KEY` | client | Firebase → Cloud Messaging → Web Push certificates |

Locally, Vite reads `VITE_*` variables from the `client/` folder unless `envDir` is set in `vite.config.js`.

---

## 6. Failure behaviour

| Situation | Saved as | `error` code |
|---|---|---|
| Email keys missing | Failed | `EMAIL_NOT_CONFIGURED` |
| Host has no email | Failed | `HOST_EMAIL_MISSING` |
| Brevo rejects the request | Failed | `EMAIL_PROVIDER_ERROR_<status>` |
| Firebase keys missing | Failed | `PUSH_NOT_CONFIGURED` |
| Host never enabled browser notifications | Failed | `NO_PUSH_TOKEN` |
| FCM rejects all tokens | Failed | FCM code, e.g. `messaging/registration-token-not-registered` |
| Host user not found | Failed | `HOST_NOT_FOUND` |

Dead push tokens are removed from the user automatically. Front desk can then use **Resend** on any `Failed` notification.

---

## 7. Integration test checklist

1. Log in as a host and click **Enable browser notifications** on `/notifications`.
2. Log in as front desk and check in a visitor for that host.
3. The host gets an email and a browser push, and 2 `Sent` docs appear in `/notifications`.
4. The host clicks **Acknowledge**, and the visit details page shows "Acknowledged".
5. Set a wrong `EMAIL_API_KEY`, then check in another visitor. The email doc is `Failed`, and check-in still succeeds.
6. Restore the key. Front desk clicks **Resend**, and a new `Sent` doc appears with `resendOf` set.
7. Run the Postman folder **Notifications** in `tests/postman/visitor-management.postman_collection.json`.
