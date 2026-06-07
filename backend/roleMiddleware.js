const { pool } = require('./Db');

// ─── Role IDs (must match the roles table) ────────────────────────────────────
const ROLE_IDS = {
  student: 1,
  teacher: 2,
  admin:   3,
};

/**
 * Middleware factory — pass the role_ids that are allowed.
 *
 * Usage:
 *   router.post('/', authenticate, authorizeRole(ROLE_IDS.teacher, ROLE_IDS.admin), handler)
 *
 * Returns 401 if the user record is missing.
 * Returns 403 if the user's role_id is not in the allowed list.
 */
function authorizeRole(...allowedRoleIds) {
  return async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        `SELECT u.role_id, r.name AS role_name
         FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE u.id = $1`,
        [req.userId]
      );

      if (!rows.length) {
        return res.status(401).json({ success: false, message: 'User not found.' });
      }

      if (!allowedRoleIds.includes(rows[0].role_id)) {
        return res.status(403).json({
          success: false,
          message: `Access denied. Only teachers and admins can perform this action. Your role: ${rows[0].role_name}.`,
        });
      }

      // Attach role info to req so downstream handlers can use it if needed
      req.userRole   = rows[0].role_name;
      req.userRoleId = rows[0].role_id;

      next();
    } catch (err) {
      console.error('authorizeRole error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  };
}

module.exports = { authorizeRole, ROLE_IDS };