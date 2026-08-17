/**
 * Wrap an async Express handler so rejected promises reach the error
 * middleware (Express 4 does not catch async errors by itself).
 */
module.exports = function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
};
