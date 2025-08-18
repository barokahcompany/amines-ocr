export function errorHandler(err, req, res, next) {
  console.error(err);
  const msg = err?.message || 'Internal Server Error';
  res.status(500).json({ status: false, message: msg });
}
