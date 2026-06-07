const jwt = require('jsonwebtoken');

/**
 * Middleware that verifies the JWT from the Authorization header.
 * Attaches req.userId and req.userRoleId on success.
 */
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
  }

  const token = authHeader.slice(7); // strip "Bearer "
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId     = payload.sub;
    req.userRoleId = payload.roleId;  // set by signToken in authController
    next();
  } catch (err) {
    const message =
      err.name === 'TokenExpiredError' ? 'Token has expired.' : 'Invalid token.';
    return res.status(401).json({ success: false, message });
  }
}

module.exports = { authenticate };