const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const { pool } = require('./Db');
const { sendVerificationEmail } = require('./emailService');

const SALT_ROUNDS       = 12;
const CODE_TTL_MINUTES  = 10;
const MAX_ATTEMPTS      = 5;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function signToken(userId, roleId) {
  return jwt.sign(
    { sub: userId, roleId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

function safeUser(row) {
  return {
    id:        row.id,
    name:      row.name,
    email:     row.email,
    level:     row.level,
    roleId:    row.role_id,
    createdAt: row.created_at,
  };
}

function generateCode() {
  // Cryptographically random 6-digit code
  return String(crypto.randomInt(100000, 999999));
}

// ─── POST /api/auth/register ──────────────────────────────────────────────────
async function register(req, res) {
  const { name, email, password, level } = req.body;

  try {
    // 1. Check if email is already a full account
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rowCount > 0) {
      return res.status(409).json({
        success: false,
        errors: [{ field: 'email', message: 'An account with this email already exists.' }],
      });
    }

    // 2. Hash password
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    // 3. Generate code and expiry
    const code      = generateCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

    // 4. Upsert pending verification (allows resend/retry)
    await pool.query(
      `INSERT INTO email_verifications (email, name, password_hash, level, code, expires_at, attempts, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 0, NOW())
       ON CONFLICT (email) DO UPDATE
         SET name          = EXCLUDED.name,
             password_hash = EXCLUDED.password_hash,
             level         = EXCLUDED.level,
             code          = EXCLUDED.code,
             expires_at    = EXCLUDED.expires_at,
             attempts      = 0,
             created_at    = NOW()`,
      [email, name.trim(), hashedPassword, level, code, expiresAt]
    );

    // 5. Send email
    await sendVerificationEmail({ to: email, name: name.trim(), code });

    return res.status(200).json({
      success: true,
      pending: true,
      message: 'Verification code sent to your email address.',
    });
  } catch (err) {
    console.error('register error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
}

// ─── POST /api/auth/verify ────────────────────────────────────────────────────
async function verifyEmail(req, res) {
  const { email, code } = req.body;

  if (!email || !code) {
    return res.status(422).json({ success: false, message: 'Email and code are required.' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT * FROM email_verifications WHERE email = $1',
      [email]
    );

    if (rows.length === 0) {
      return res.status(400).json({ success: false, message: 'No pending verification for this email. Please register again.' });
    }

    const pending = rows[0];

    // Too many wrong attempts
    if (pending.attempts >= MAX_ATTEMPTS) {
      return res.status(429).json({
        success: false,
        message: 'Too many incorrect attempts. Please request a new code.',
      });
    }

    // Expired
    if (new Date() > new Date(pending.expires_at)) {
      return res.status(400).json({
        success: false,
        expired: true,
        message: 'This code has expired. Use the resend button to get a new one.',
      });
    }

    // Increment attempts before checking (prevents timing attacks)
    await pool.query(
      'UPDATE email_verifications SET attempts = attempts + 1 WHERE email = $1',
      [email]
    );

    // Wrong code
    if (pending.code !== String(code).trim()) {
      const used      = pending.attempts + 1;
      const remaining = MAX_ATTEMPTS - used;
      return res.status(400).json({
        success: false,
        message: remaining > 0
          ? `Incorrect code — ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
          : 'Too many incorrect attempts. Please request a new code.',
      });
    }

    // ✅ Code correct — create the real user
    const { rows: userRows } = await pool.query(
      `INSERT INTO users (name, email, password, level)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [pending.name, pending.email, pending.password_hash, pending.level]
    );

    const user = userRows[0];

    // Clean up
    await pool.query('DELETE FROM email_verifications WHERE email = $1', [email]);

    const token = signToken(user.id, user.role_id);

    return res.status(201).json({
      success: true,
      message: 'Account created successfully!',
      token,
      user: safeUser(user),
    });
  } catch (err) {
    console.error('verifyEmail error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
}

// ─── POST /api/auth/resend ────────────────────────────────────────────────────
async function resendCode(req, res) {
  const { email } = req.body;
  if (!email) {
    return res.status(422).json({ success: false, message: 'Email is required.' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT * FROM email_verifications WHERE email = $1',
      [email]
    );

    if (rows.length === 0) {
      return res.status(400).json({ success: false, message: 'No pending verification found. Please register again.' });
    }

    const code      = generateCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

    await pool.query(
      `UPDATE email_verifications
       SET code = $1, expires_at = $2, attempts = 0, created_at = NOW()
       WHERE email = $3`,
      [code, expiresAt, email]
    );

    await sendVerificationEmail({ to: email, name: rows[0].name, code });

    return res.status(200).json({ success: true, message: 'New verification code sent.' });
  } catch (err) {
    console.error('resendCode error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
}

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
async function login(req, res) {
  const { email, password } = req.body;

  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const token = signToken(user.id, user.role_id);

    return res.status(200).json({
      success: true,
      message: 'Login successful!',
      token,
      user: safeUser(user),
    });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
}

// ─── GET /api/auth/me  (protected) ───────────────────────────────────────────
async function getMe(req, res) {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, email, level, role_id, created_at FROM users WHERE id = $1',
      [req.userId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    return res.status(200).json({ success: true, user: safeUser(rows[0]) });
  } catch (err) {
    console.error('getMe error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
}

module.exports = { register, login, getMe, verifyEmail, resendCode };