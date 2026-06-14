const express  = require('express');
const { register, login, getMe, verifyEmail, resendCode } = require('./authController');
const { registerValidation, loginValidation, handleValidationErrors } = require('./validators');
const { authenticate } = require('./authMiddleware');

const router = express.Router();

// POST /api/auth/register  → sends verification email, does NOT create user yet
router.post('/register', registerValidation, handleValidationErrors, register);

// POST /api/auth/verify    → checks code, creates user, returns JWT
router.post('/verify', verifyEmail);

// POST /api/auth/resend    → issues a fresh code for a pending email
router.post('/resend', resendCode);

// POST /api/auth/login
router.post('/login', loginValidation, handleValidationErrors, login);

// GET  /api/auth/me        → protected
router.get('/me', authenticate, getMe);

module.exports = router;