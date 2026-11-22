// Visitor activity reports for front-desk staff and administrators.
// Everything is computed in MongoDB with one aggregation, so it also works on serverless.
const mongoose = require('mongoose');
const Visit = require('../models/Visit');
const User = require('../models/User');
const { overstayMinutes } = require('./visit.service');

const EXPORT_LIMIT = 5000;
const LATE_ARRIVAL_MINUTES = 15;

function noShowCutoff() {
  const hours = Number(process.env.CHECKIN_LATE_HOURS);
  const windowHours = Number.isFinite(hours) && hours > 0 ? hours : 12;
  return new Date(Date.now() - windowHours * 60 * 60 * 1000);
}

const minutesBetween = (start, end) => ({ $divide: [{ $subtract: [end, start] }, 60000] });
const countIf = (condition) => ({ $sum: { $cond: [condition, 1, 0] } });
const round = (value) => (value === null || value === undefined ? null : Math.round(value));

function baseMatch({ from, to, hostId }) {
  const match = { expectedArrival: { $gte: from, $lte: to } };
  if (hostId) {
    match.hostId = new mongoose.Types.ObjectId(hostId);
  }
  return match;
}

async function activityReport({ from, to, hostId, timezone }) {
  const completed = { $and: [{ $ifNull: ['$checkInTime', false] }, { $ifNull: ['$checkOutTime', false] }] };

  const [facets] = await Visit.aggregate([
    { $match: baseMatch({ from, to, hostId }) },
    {
      $facet: {
        byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
        durations: [
          { $match: { status: 'Checked-out', checkInTime: { $type: 'date' }, checkOutTime: { $type: 'date' } } },
          { $project: { minutes: minutesBetween('$checkInTime', '$checkOutTime') } },
          { $group: { _id: null, average: { $avg: '$minutes' }, longest: { $max: '$minutes' }, count: { $sum: 1 } } }
        ],
        punctuality: [
          { $match: { checkInTime: { $type: 'date' } } },
          { $project: { late: minutesBetween('$expectedArrival', '$checkInTime') } },
          {
            $group: {
              _id: null,
              averageMinutesLate: { $avg: '$late' },
              lateArrivals: countIf({ $gt: ['$late', LATE_ARRIVAL_MINUTES] })
            }
          }
        ],
        noShows: [{ $match: { status: 'Expected', expectedArrival: { $lt: noShowCutoff() } } }, { $count: 'count' }],
        byHost: [
          {
            $group: {
              _id: '$hostId',
              visits: { $sum: 1 },
              checkedOut: countIf({ $eq: ['$status', 'Checked-out'] }),
              cancelled: countIf({ $eq: ['$status', 'Cancelled'] }),
              averageMinutes: { $avg: { $cond: [completed, minutesBetween('$checkInTime', '$checkOutTime'), null] } }
            }
          },
          { $sort: { visits: -1 } },
          { $limit: 50 }
        ],
        byDay: [
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$expectedArrival', timezone } },
              registered: { $sum: 1 },
              checkedIn: countIf({ $ifNull: ['$checkInTime', false] }),
              cancelled: countIf({ $eq: ['$status', 'Cancelled'] })
            }
          },
          { $sort: { _id: 1 } }
        ],
        peakHours: [
          { $match: { checkInTime: { $type: 'date' } } },
          { $group: { _id: { $hour: { date: '$checkInTime', timezone } }, checkIns: { $sum: 1 } } },
          { $sort: { checkIns: -1, _id: 1 } }
        ]
      }
    }
  ]);

  const status = Object.fromEntries(facets.byStatus.map((row) => [row._id, row.count]));
  const hostIds = facets.byHost.map((row) => row._id);
  const hosts = await User.find({ _id: { $in: hostIds } }).select('name').lean();
  const hostNames = new Map(hosts.map((host) => [String(host._id), host.name]));

  const overstayCutoff = new Date(Date.now() - overstayMinutes() * 60 * 1000);
  const overstayFilter = { status: 'Checked-in', checkInTime: { $lt: overstayCutoff } };
  if (hostId) {
    overstayFilter.hostId = hostId;
  }
  const overstays = await Visit.find(overstayFilter)
    .select('visitorId hostId checkInTime')
    .populate('visitorId', 'fullName company')
    .populate('hostId', 'name')
    .sort({ checkInTime: 1 })
    .limit(50)
    .lean();

  const durations = facets.durations[0] || {};
  const punctuality = facets.punctuality[0] || {};
  const total = facets.byStatus.reduce((sum, row) => sum + row.count, 0);
  const cancelled = status.Cancelled || 0;

  return {
    range: { from, to, timezone },
    totals: {
      registered: total,
      expected: status.Expected || 0,
      onSite: status['Checked-in'] || 0,
      checkedOut: status['Checked-out'] || 0,
      cancelled,
      noShows: facets.noShows[0] ? facets.noShows[0].count : 0
    },
    rates: {
      cancellationRate: total ? Number((cancelled / total).toFixed(3)) : 0,
      attendanceRate: total
        ? Number((((status['Checked-in'] || 0) + (status['Checked-out'] || 0)) / total).toFixed(3))
        : 0
    },
    visitLength: {
      completedVisits: durations.count || 0,
      averageMinutes: round(durations.average),
      longestMinutes: round(durations.longest)
    },
    punctuality: {
      averageMinutesLate: round(punctuality.averageMinutesLate),
      lateArrivals: punctuality.lateArrivals || 0,
      lateThresholdMinutes: LATE_ARRIVAL_MINUTES
    },
    byHost: facets.byHost.map((row) => ({
      hostId: row._id,
      name: hostNames.get(String(row._id)) || 'Unknown host',
      visits: row.visits,
      checkedOut: row.checkedOut,
      cancelled: row.cancelled,
      averageMinutes: round(row.averageMinutes)
    })),
    byDay: facets.byDay.map((row) => ({ date: row._id, ...row, _id: undefined })),
    peakHours: facets.peakHours.map((row) => ({ hour: row._id, checkIns: row.checkIns })),
    overstays: overstays.map((visit) => ({
      visitId: visit._id,
      visitor: visit.visitorId ? visit.visitorId.fullName : null,
      company: visit.visitorId ? visit.visitorId.company : null,
      host: visit.hostId ? visit.hostId.name : null,
      checkInTime: visit.checkInTime,
      minutesOnSite: Math.round((Date.now() - new Date(visit.checkInTime).getTime()) / 60000)
    })),
    overstayThresholdMinutes: overstayMinutes(),
    generatedAt: new Date()
  };
}

// Cells starting with = + - @ are prefixed so spreadsheet apps do not run them as formulas.
function csvCell(value) {
  if (value === null || value === undefined) {
    return '';
  }
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function exportVisitsCsv({ from, to, hostId }) {
  const visits = await Visit.find(baseMatch({ from, to, hostId }))
    .sort({ expectedArrival: 1 })
    .limit(EXPORT_LIMIT)
    .populate('visitorId', 'fullName company')
    .populate('hostId', 'name')
    .lean();

  const header = ['Visitor', 'Company', 'Host', 'Purpose', 'Status', 'Expected arrival', 'Checked in', 'Checked out', 'Minutes on site'];
  const rows = visits.map((visit) => [
    visit.visitorId ? visit.visitorId.fullName : '',
    visit.visitorId ? visit.visitorId.company : '',
    visit.hostId ? visit.hostId.name : '',
    visit.purpose,
    visit.status,
    visit.expectedArrival,
    visit.checkInTime,
    visit.checkOutTime,
    visit.checkInTime && visit.checkOutTime
      ? Math.round((new Date(visit.checkOutTime) - new Date(visit.checkInTime)) / 60000)
      : ''
  ]);

  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

module.exports = { activityReport, exportVisitsCsv, csvCell };
