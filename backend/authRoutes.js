const express  = require('express');
const { register, login, getMe } = require('./authController');
const { registerValidation, loginValidation, handleValidationErrors } = require('./validators');
const { authenticate } = require('./authMiddleware');

const router = express.Router();

// POST /api/auth/register
router.post(
  '/register',
  registerValidation,
  handleValidationErrors,
  register
);

// POST /api/auth/login
router.post(
  '/login',
  loginValidation,
  handleValidationErrors,
  login
);

// GET /api/auth/me  — protected route (example of a guarded endpoint)
router.get('/me', authenticate, getMe);

module.exports = router;    