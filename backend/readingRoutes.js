/**
 * readingRoutes.js
 *
 * Endpoints:
 *   POST   /api/reading                    – teacher creates a reading task
 *   GET    /api/reading                    – teacher lists their own tasks
 *   GET    /api/reading/:id                – anyone authenticated gets one task
 *   GET    /api/reading/:id/play           – student view (no correct-answer data)
 *   PATCH  /api/reading/:id               – teacher updates their own task
 *   DELETE /api/reading/:id               – teacher deletes their own task
 */

const express    = require('express');
const { pool }   = require('./Db');
const { authenticate }  = require('./authMiddleware');
const { authorizeRole, ROLE_IDS } = require('./roleMiddleware');

const router = express.Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Fetch a full task (with questions + options, including is_correct). */
async function fetchFullTask(taskId) {
  const { rows: taskRows } = await pool.query(
    `SELECT rt.*, u.name AS teacher_name
       FROM reading_tasks rt
       JOIN users u ON u.id = rt.teacher_id
      WHERE rt.id = $1`,
    [taskId]
  );
  if (taskRows.length === 0) return null;

  const task = taskRows[0];

  const { rows: questions } = await pool.query(
    `SELECT rq.id, rq.sort_order, rq.question,
            json_agg(
              json_build_object(
                'id',         ro.id,
                'sort_order', ro.sort_order,
                'option_text', ro.option_text,
                'is_correct',  ro.is_correct
              ) ORDER BY ro.sort_order
            ) AS options
       FROM reading_questions rq
       JOIN reading_options ro ON ro.question_id = rq.id
      WHERE rq.task_id = $1
      GROUP BY rq.id
      ORDER BY rq.sort_order`,
    [taskId]
  );

  task.questions = questions;
  return task;
}

/** Validate question/option arrays from request body. Returns error string or null. */
function validateQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    return 'At least one question is required.';
  }
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!q.question || String(q.question).trim() === '') {
      return `Question ${i + 1} text is empty.`;
    }
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4) {
      return `Question ${i + 1} must have 2–4 answer options.`;
    }
    const correctOptions = q.options.filter((o) => o.is_correct === true);
    if (correctOptions.length !== 1) {
      return `Question ${i + 1} must have exactly one correct answer.`;
    }
    for (let j = 0; j < q.options.length; j++) {
      if (!q.options[j].option_text || String(q.options[j].option_text).trim() === '') {
        return `Question ${i + 1}, option ${j + 1} text is empty.`;
      }
    }
  }
  return null;
}

// ─── POST /api/reading  (teacher only) ───────────────────────────────────────
router.post(
  '/',
  authenticate,
  authorizeRole(ROLE_IDS.teacher, ROLE_IDS.admin),
  async (req, res) => {
    const { title, passage, level = 'beginner', questions } = req.body;

    if (!title || String(title).trim() === '') {
      return res.status(422).json({ success: false, message: 'Title is required.' });
    }
    if (!passage || String(passage).trim() === '') {
      return res.status(422).json({ success: false, message: 'Passage text is required.' });
    }
    const qError = validateQuestions(questions);
    if (qError) return res.status(422).json({ success: false, message: qError });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Insert task
      const { rows: taskRows } = await client.query(
        `INSERT INTO reading_tasks (teacher_id, title, passage, level)
           VALUES ($1, $2, $3, $4) RETURNING id`,
        [req.userId, title.trim(), passage.trim(), level]
      );
      const taskId = taskRows[0].id;

      // Insert questions + options
      for (let qi = 0; qi < questions.length; qi++) {
        const q = questions[qi];
        const { rows: qRows } = await client.query(
          `INSERT INTO reading_questions (task_id, sort_order, question)
             VALUES ($1, $2, $3) RETURNING id`,
          [taskId, qi, q.question.trim()]
        );
        const questionId = qRows[0].id;

        for (let oi = 0; oi < q.options.length; oi++) {
          const opt = q.options[oi];
          await client.query(
            `INSERT INTO reading_options (question_id, sort_order, option_text, is_correct)
               VALUES ($1, $2, $3, $4)`,
            [questionId, oi, opt.option_text.trim(), !!opt.is_correct]
          );
        }
      }

      await client.query('COMMIT');

      const task = await fetchFullTask(taskId);
      return res.status(201).json({ success: true, task });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('POST /api/reading error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    } finally {
      client.release();
    }
  }
);

// ─── GET /api/reading  (teacher sees their own tasks) ────────────────────────
router.get(
  '/',
  authenticate,
  authorizeRole(ROLE_IDS.teacher, ROLE_IDS.admin),
  async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT rt.id, rt.title, rt.level, rt.created_at, rt.updated_at,
                COUNT(rq.id)::int AS question_count
           FROM reading_tasks rt
           LEFT JOIN reading_questions rq ON rq.task_id = rt.id
          WHERE rt.teacher_id = $1
          GROUP BY rt.id
          ORDER BY rt.created_at DESC`,
        [req.userId]
      );
      return res.json({ success: true, tasks: rows });
    } catch (err) {
      console.error('GET /api/reading error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  }
);

// ─── GET /api/reading/:id  (full task with correct answers — teacher/admin) ──
router.get(
  '/:id',
  authenticate,
  authorizeRole(ROLE_IDS.teacher, ROLE_IDS.admin),
  async (req, res) => {
    try {
      const task = await fetchFullTask(req.params.id);
      if (!task) return res.status(404).json({ success: false, message: 'Task not found.' });

      // Teachers can only see their own tasks (admins see all)
      if (req.userRoleId === ROLE_IDS.teacher && task.teacher_id !== req.userId) {
        return res.status(403).json({ success: false, message: 'Access denied.' });
      }

      return res.json({ success: true, task });
    } catch (err) {
      console.error('GET /api/reading/:id error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  }
);

// ─── GET /api/reading/:id/play  (student view — no is_correct) ───────────────
router.get(
  '/:id/play',
  authenticate,
  async (req, res) => {
    try {
      const { rows: taskRows } = await pool.query(
        `SELECT rt.*, u.name AS teacher_name
           FROM reading_tasks rt
           JOIN users u ON u.id = rt.teacher_id
          WHERE rt.id = $1`,
        [req.params.id]
      );
      if (taskRows.length === 0) {
        return res.status(404).json({ success: false, message: 'Task not found.' });
      }
      const task = taskRows[0];

      const { rows: questions } = await pool.query(
        `SELECT rq.id, rq.sort_order, rq.question,
                json_agg(
                  json_build_object(
                    'id',          ro.id,
                    'sort_order',  ro.sort_order,
                    'option_text', ro.option_text
                  ) ORDER BY ro.sort_order
                ) AS options
           FROM reading_questions rq
           JOIN reading_options ro ON ro.question_id = rq.id
          WHERE rq.task_id = $1
          GROUP BY rq.id
          ORDER BY rq.sort_order`,
        [req.params.id]
      );

      task.questions = questions;
      return res.json({ success: true, task });
    } catch (err) {
      console.error('GET /api/reading/:id/play error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  }
);

// ─── POST /api/reading/:id/check  (student submits answers) ──────────────────
// Body: { answers: { [questionId]: optionId } }
router.post(
  '/:id/check',
  authenticate,
  async (req, res) => {
    const { answers } = req.body; // { "12": 45, "13": 47, ... }
    if (!answers || typeof answers !== 'object') {
      return res.status(422).json({ success: false, message: 'answers object is required.' });
    }

    try {
      // Fetch all correct option ids for this task
      const { rows } = await pool.query(
        `SELECT rq.id AS question_id, ro.id AS correct_option_id
           FROM reading_questions rq
           JOIN reading_options ro ON ro.question_id = rq.id AND ro.is_correct = TRUE
          WHERE rq.task_id = $1`,
        [req.params.id]
      );

      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Task not found or has no questions.' });
      }

      let score = 0;
      const results = {};

      for (const row of rows) {
        const qId = String(row.question_id);
        const submittedOptionId = Number(answers[qId]);
        const isCorrect = submittedOptionId === row.correct_option_id;
        if (isCorrect) score++;
        results[qId] = {
          correct:           isCorrect,
          correct_option_id: row.correct_option_id,
        };
      }

      return res.json({
        success: true,
        score,
        total:   rows.length,
        results,
      });
    } catch (err) {
      console.error('POST /api/reading/:id/check error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  }
);

// ─── PATCH /api/reading/:id  (teacher updates their own task) ────────────────
router.patch(
  '/:id',
  authenticate,
  authorizeRole(ROLE_IDS.teacher, ROLE_IDS.admin),
  async (req, res) => {
    const { title, passage, level, questions } = req.body;

    const client = await pool.connect();
    try {
      // Ownership check
      const { rows } = await client.query(
        'SELECT teacher_id FROM reading_tasks WHERE id = $1',
        [req.params.id]
      );
      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Task not found.' });
      }
      if (req.userRoleId === ROLE_IDS.teacher && rows[0].teacher_id !== req.userId) {
        return res.status(403).json({ success: false, message: 'Access denied.' });
      }

      await client.query('BEGIN');

      // Update task metadata
      await client.query(
        `UPDATE reading_tasks
            SET title   = COALESCE($1, title),
                passage = COALESCE($2, passage),
                level   = COALESCE($3, level)
          WHERE id = $4`,
        [
          title   ? title.trim()   : null,
          passage ? passage.trim() : null,
          level   || null,
          req.params.id,
        ]
      );

      // If questions provided, replace them entirely
      if (questions) {
        const qError = validateQuestions(questions);
        if (qError) {
          await client.query('ROLLBACK');
          return res.status(422).json({ success: false, message: qError });
        }

        // Delete old questions (cascade deletes options)
        await client.query('DELETE FROM reading_questions WHERE task_id = $1', [req.params.id]);

        for (let qi = 0; qi < questions.length; qi++) {
          const q = questions[qi];
          const { rows: qRows } = await client.query(
            `INSERT INTO reading_questions (task_id, sort_order, question)
               VALUES ($1, $2, $3) RETURNING id`,
            [req.params.id, qi, q.question.trim()]
          );
          const questionId = qRows[0].id;
          for (let oi = 0; oi < q.options.length; oi++) {
            const opt = q.options[oi];
            await client.query(
              `INSERT INTO reading_options (question_id, sort_order, option_text, is_correct)
                 VALUES ($1, $2, $3, $4)`,
              [questionId, oi, opt.option_text.trim(), !!opt.is_correct]
            );
          }
        }
      }

      await client.query('COMMIT');

      const task = await fetchFullTask(req.params.id);
      return res.json({ success: true, task });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('PATCH /api/reading/:id error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    } finally {
      client.release();
    }
  }
);

// ─── DELETE /api/reading/:id ─────────────────────────────────────────────────
router.delete(
  '/:id',
  authenticate,
  authorizeRole(ROLE_IDS.teacher, ROLE_IDS.admin),
  async (req, res) => {
    try {
      const { rows } = await pool.query(
        'SELECT teacher_id FROM reading_tasks WHERE id = $1',
        [req.params.id]
      );
      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Task not found.' });
      }
      if (req.userRoleId === ROLE_IDS.teacher && rows[0].teacher_id !== req.userId) {
        return res.status(403).json({ success: false, message: 'Access denied.' });
      }

      await pool.query('DELETE FROM reading_tasks WHERE id = $1', [req.params.id]);
      return res.json({ success: true, message: 'Reading task deleted.' });
    } catch (err) {
      console.error('DELETE /api/reading/:id error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  }
);

module.exports = router;