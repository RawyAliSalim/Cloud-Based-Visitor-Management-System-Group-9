// Runs once when a Lambda container starts, before the app is built.
// The deployment base passes configuration as Lambda environment variables, so there is
// nothing to load here yet.
async function beforeStart() {}

module.exports = { beforeStart };
