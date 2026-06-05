const express = require('express');
const { authenticate } = require('./authMiddleware');
const { pool } = require('./Db');

const router = express.Router();

// All quiz routes require authentication
router.use(authenticate);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function validateQuizPayload(body) {
  const errors = [];

  if (!body.title || !body.title.toString().trim()) {
    errors.push('Quiz title is required.');
  } else if (body.title.trim().length > 255) {
    errors.push('Quiz title must be 255 characters or fewer.');
  }

  if (!Array.isArray(body.questions) || body.questions.length === 0) {
    errors.push('At least one question is required.');
  } else {
    body.questions.forEach((q, qi) => {
      if (!q.question_text || !q.question_text.toString().trim()) {
        errors.push(`Question ${qi + 1}: question text is required.`);
      }

      if (!Array.isArray(q.answers) || q.answers.length < 2 || q.answers.length > 5) {
        errors.push(`Question ${qi + 1}: must have between 2 and 5 answers.`);
      } else {
        const correctCount = q.answers.filter(a => a.is_correct).length;
        if (correctCount !== 1) {
          errors.push(`Question ${qi + 1}: exactly one answer must be marked as correct.`);
        }
        q.answers.forEach((a, ai) => {
          if (!a.answer_text || !a.answer_text.toString().trim()) {
            errors.push(`Question ${qi + 1}, Answer ${ai + 1}: answer text is required.`);
          }
        });
      }
    });
  }

  return errors;
}

// ─── POST /api/quizzes ────────────────────────────────────────────────────────
// Create a new quiz with its questions and answers in one request.
// Body shape:
// {
//   title: "My Quiz",
//   description: "Optional description",
//   questions: [
//     {
//       question_text: "What is 2+2?",
//       answers: [
//         { answer_text: "3", is_correct: false },
//         { answer_text: "4", is_correct: true },
//         { answer_text: "5", is_correct: false }
//       ]
//     }
//   ]
// }
router.post('/', async (req, res) => {
  const errors = validateQuizPayload(req.body);
  if (errors.length) {
    return res.status(422).json({ success: false, errors });
  }

  const { title, description = null, questions } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Insert quiz
    const { rows: quizRows } = await client.query(
      `INSERT INTO quizzes (title, description, created_by)
       VALUES ($1, $2, $3)
       RETURNING id, title, description, created_at`,
      [title.trim(), description?.trim() || null, req.userId]
    );
    const quiz = quizRows[0];

    // 2. Insert questions + answers
    for (let qi = 0; qi < questions.length; qi++) {
      const q = questions[qi];

      const { rows: qRows } = await client.query(
        `INSERT INTO quiz_questions (quiz_id, question_text, order_index)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [quiz.id, q.question_text.trim(), qi]
      );
      const questionId = qRows[0].id;

      for (let ai = 0; ai < q.answers.length; ai++) {
        const a = q.answers[ai];
        await client.query(
          `INSERT INTO quiz_answers (question_id, answer_text, is_correct, order_index)
           VALUES ($1, $2, $3, $4)`,
          [questionId, a.answer_text.trim(), !!a.is_correct, ai]
        );
      }
    }

    await client.query('COMMIT');
    return res.status(201).json({
      success: true,
      message: 'Quiz created successfully.',
      quiz: { id: quiz.id, title: quiz.title, created_at: quiz.created_at },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/quizzes error:', err);
    return res.status(500).json({ success: false, message: 'Failed to save quiz.' });
  } finally {
    client.release();
  }
});

// ─── GET /api/quizzes ─────────────────────────────────────────────────────────
// List all quizzes created by the logged-in teacher.
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT q.id, q.title, q.description, q.created_at,
              COUNT(qq.id)::int AS question_count
       FROM quizzes q
       LEFT JOIN quiz_questions qq ON qq.quiz_id = q.id
       WHERE q.created_by = $1
       GROUP BY q.id
       ORDER BY q.created_at DESC`,
      [req.userId]
    );
    return res.json({ success: true, quizzes: rows });
  } catch (err) {
    console.error('GET /api/quizzes error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// ─── GET /api/quizzes/:id ─────────────────────────────────────────────────────
// Fetch a single quiz with all questions and answers.
router.get('/:id', async (req, res) => {
  const quizId = parseInt(req.params.id, 10);
  if (isNaN(quizId)) {
    return res.status(400).json({ success: false, message: 'Invalid quiz ID.' });
  }

  try {
    const { rows: quizRows } = await pool.query(
      `SELECT id, title, description, created_by, created_at
       FROM quizzes WHERE id = $1`,
      [quizId]
    );
    if (!quizRows.length) {
      return res.status(404).json({ success: false, message: 'Quiz not found.' });
    }

    const quiz = quizRows[0];

    const { rows: questions } = await pool.query(
      `SELECT id, question_text, order_index
       FROM quiz_questions
       WHERE quiz_id = $1
       ORDER BY order_index ASC`,
      [quizId]
    );

    for (const q of questions) {
      const { rows: answers } = await pool.query(
        `SELECT id, answer_text, is_correct, order_index
         FROM quiz_answers
         WHERE question_id = $1
         ORDER BY order_index ASC`,
        [q.id]
      );
      q.answers = answers;
    }

    quiz.questions = questions;
    return res.json({ success: true, quiz });
  } catch (err) {
    console.error('GET /api/quizzes/:id error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// ─── DELETE /api/quizzes/:id ──────────────────────────────────────────────────
// Delete a quiz (only allowed by the quiz creator).
router.delete('/:id', async (req, res) => {
  const quizId = parseInt(req.params.id, 10);
  if (isNaN(quizId)) {
    return res.status(400).json({ success: false, message: 'Invalid quiz ID.' });
  }

  try {
    const { rowCount } = await pool.query(
      `DELETE FROM quizzes WHERE id = $1 AND created_by = $2`,
      [quizId, req.userId]
    );
    if (!rowCount) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found or you are not the owner.',
      });
    }
    return res.json({ success: true, message: 'Quiz deleted.' });
  } catch (err) {
    console.error('DELETE /api/quizzes/:id error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

module.exports = router;