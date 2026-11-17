const visitorService = require('../services/visitor.service');
const { sendError } = require('../middleware/validate');

async function searchVisitors(req, res, next) {
  try {
    const term = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    if (term.length < 2 || term.length > 100) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'search must be 2 to 100 characters');
    }

    const visitors = await visitorService.searchVisitors(term);
    return res.status(200).json(visitors);
  } catch (error) {
    return next(error);
  }
}

module.exports = { searchVisitors };
