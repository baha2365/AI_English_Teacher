const express  = require('express');
const multer   = require('multer');
const { authenticate } = require('./authMiddleware');
const { getSentences, checkPronunciation } = require('./pronunciationController');

const router = express.Router();

// Memory storage — audio buffer sent straight to OpenAI, never touches disk.
// 25 MB ceiling matches OpenAI's upload limit.
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype.startsWith('audio/')),
});

router.use(authenticate);

// GET /api/pronunciation/sentences/:partId
// Returns all sentences for a part including their audio_url (for shadowing).
router.get('/sentences/:partId', getSentences);

// POST /api/pronunciation/check
// Body: multipart/form-data with fields: audio (file) + sentence_id (string)
// Returns: { expected, actual, score (0-100), passed (bool), empty (bool) }
router.post('/check', upload.single('audio'), checkPronunciation);

module.exports = router;