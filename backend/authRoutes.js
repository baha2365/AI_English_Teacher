const express  = require('express');
const {
  register,
  login,
  getMe,
  verifyEmail,
  resendCode,
  forgotPassword,
  verifyResetCode,
  resendResetCode,
  resetPassword,
} = require('./authController');
const { registerValidation, loginValidation, handleValidationErrors } = require('./validators');
const { authenticate } = require('./authMiddleware');

const router = express.Router();

// ── Registration flow ─────────────────────────────────────────────────────────
// POST /api/auth/register  → sends verification email, does NOT create user yet
router.post('/register', registerValidation, handleValidationErrors, register);

// POST /api/auth/verify    → checks code, creates user, returns JWT
router.post('/verify', verifyEmail);

// POST /api/auth/resend    → issues a fresh code for a pending registration
router.post('/resend', resendCode);

// ── Login ─────────────────────────────────────────────────────────────────────
router.post('/login', loginValidation, handleValidationErrors, login);

// ── Forgot-password flow ──────────────────────────────────────────────────────
// POST /api/auth/forgot          → sends reset code to email (generic response)
router.post('/forgot', forgotPassword);

// POST /api/auth/verify-reset    → checks reset code, returns short-lived resetToken
router.post('/verify-reset', verifyResetCode);

// POST /api/auth/resend-reset    → issues a fresh reset code
router.post('/resend-reset', resendResetCode);

// POST /api/auth/reset-password  → consumes resetToken, updates password
router.post('/reset-password', resetPassword);

// ── Protected ─────────────────────────────────────────────────────────────────
// GET  /api/auth/me
router.get('/me', authenticate, getMe);

module.exports = router;