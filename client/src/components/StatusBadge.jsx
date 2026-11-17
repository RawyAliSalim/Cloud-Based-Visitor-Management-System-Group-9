const STYLES = {
  Expected: 'bg-blue-100 text-blue-800',
  'Checked-in': 'bg-green-100 text-green-800',
  'Checked-out': 'bg-gray-200 text-gray-800',
  Cancelled: 'bg-red-100 text-red-800'
};

export default function StatusBadge({ status }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${STYLES[status] || 'bg-gray-100 text-gray-800'}`}>
      {status}
    </span>
  );
}
