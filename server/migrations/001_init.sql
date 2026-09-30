-- Character Quest initial schema.
-- All game progress lives here; the browser never holds authoritative state.

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'teacher', 'student')),
  disabled      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX users_username_lower ON users (lower(username));

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE teachers (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  school  TEXT
);

CREATE TABLE worlds (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  seed       INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE classes (
  id                  SERIAL PRIMARY KEY,
  name                TEXT NOT NULL,
  grade               TEXT,
  teacher_id          INTEGER NOT NULL REFERENCES users(id),
  world_id            INTEGER NOT NULL REFERENCES worlds(id),
  join_code           TEXT NOT NULL UNIQUE,
  build_mode          TEXT NOT NULL DEFAULT 'personal_area'
                      CHECK (build_mode IN ('anywhere', 'personal_area', 'class_project', 'read_only')),
  harvest_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  harvest_daily_cap   INTEGER NOT NULL DEFAULT 20,
  unlock_all_regions  BOOLEAN NOT NULL DEFAULT FALSE,
  adaptive_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  chat_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX classes_teacher ON classes (teacher_id);

CREATE TABLE students (
  user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  class_id       INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  plot_index     INTEGER NOT NULL,
  avatar_color   TEXT NOT NULL DEFAULT '#3c6fc8',
  xp             INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  level          INTEGER NOT NULL DEFAULT 1,
  coins          INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0),
  blocks_placed  INTEGER NOT NULL DEFAULT 0,
  can_build      BOOLEAN NOT NULL DEFAULT TRUE,
  frozen         BOOLEAN NOT NULL DEFAULT FALSE,
  pos_x          REAL,
  pos_y          REAL,
  pos_z          REAL,
  harvest_day    DATE,
  harvest_count  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (class_id, plot_index)
);
CREATE INDEX students_class ON students (class_id);

CREATE TABLE blocks (
  id    SMALLINT PRIMARY KEY,
  key   TEXT NOT NULL UNIQUE,
  name  TEXT NOT NULL,
  tier  TEXT NOT NULL
);

CREATE TABLE inventory (
  student_id INTEGER NOT NULL REFERENCES students(user_id) ON DELETE CASCADE,
  block_id   SMALLINT NOT NULL REFERENCES blocks(id),
  quantity   INTEGER NOT NULL CHECK (quantity >= 0),
  PRIMARY KEY (student_id, block_id)
);

CREATE TABLE skills (
  id       SERIAL PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  UNIQUE (class_id, name)
);

CREATE TABLE student_skills (
  student_id INTEGER NOT NULL REFERENCES students(user_id) ON DELETE CASCADE,
  skill_id   INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  points     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (student_id, skill_id)
);

CREATE TABLE questions (
  id                SERIAL PRIMARY KEY,
  class_id          INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  author_id         INTEGER REFERENCES users(id),
  type              TEXT NOT NULL CHECK (type IN ('multiple_choice', 'true_false', 'short_answer', 'numeric')),
  prompt            TEXT NOT NULL,
  explanation       TEXT,
  subject           TEXT NOT NULL,
  topic             TEXT,
  grade_level       TEXT,
  difficulty        SMALLINT NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
  xp_reward         INTEGER NOT NULL DEFAULT 0 CHECK (xp_reward >= 0),
  skill_id          INTEGER REFERENCES skills(id) ON DELETE SET NULL,
  skill_amount      INTEGER NOT NULL DEFAULT 0 CHECK (skill_amount >= 0),
  block_id          SMALLINT REFERENCES blocks(id),
  block_qty         INTEGER NOT NULL DEFAULT 0 CHECK (block_qty >= 0),
  coin_reward       INTEGER NOT NULL DEFAULT 0 CHECK (coin_reward >= 0),
  numeric_tolerance REAL NOT NULL DEFAULT 0,
  time_limit_sec    INTEGER,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX questions_class ON questions (class_id, active);

-- Answer options (multiple choice / true-false) and accepted answers (short answer / numeric).
CREATE TABLE question_answers (
  id          SERIAL PRIMARY KEY,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  is_correct  BOOLEAN NOT NULL DEFAULT FALSE,
  sort        SMALLINT NOT NULL DEFAULT 0
);
CREATE INDEX question_answers_q ON question_answers (question_id);

CREATE TABLE student_answers (
  id            BIGSERIAL PRIMARY KEY,
  student_id    INTEGER NOT NULL REFERENCES students(user_id) ON DELETE CASCADE,
  question_id   INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  answer_text   TEXT NOT NULL,
  correct       BOOLEAN NOT NULL,
  attempt_no    INTEGER NOT NULL,
  time_spent_ms INTEGER,
  rewarded      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX student_answers_student ON student_answers (student_id, question_id);
CREATE INDEX student_answers_question ON student_answers (question_id);
-- A question can reward a student only once.
CREATE UNIQUE INDEX student_answers_one_reward ON student_answers (student_id, question_id) WHERE rewarded;

CREATE TABLE assignments (
  id           SERIAL PRIMARY KEY,
  class_id     INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT,
  target       TEXT NOT NULL DEFAULT 'class' CHECK (target IN ('class', 'students')),
  xp_reward    INTEGER NOT NULL DEFAULT 0,
  block_id     SMALLINT REFERENCES blocks(id),
  block_qty    INTEGER NOT NULL DEFAULT 0,
  coin_reward  INTEGER NOT NULL DEFAULT 0,
  due_date     DATE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE assignment_questions (
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  question_id   INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  PRIMARY KEY (assignment_id, question_id)
);
CREATE TABLE assignment_students (
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id    INTEGER NOT NULL REFERENCES students(user_id) ON DELETE CASCADE,
  PRIMARY KEY (assignment_id, student_id)
);
CREATE TABLE student_assignments (
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id    INTEGER NOT NULL REFERENCES students(user_id) ON DELETE CASCADE,
  completed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (assignment_id, student_id)
);

CREATE TABLE achievements (
  id              SERIAL PRIMARY KEY,
  class_id        INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  key             TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL,
  criteria_type   TEXT NOT NULL CHECK (criteria_type IN
                    ('questions_answered', 'correct_answers', 'correct_in_subject', 'hard_correct', 'blocks_placed', 'xp_total', 'assignments_completed', 'manual')),
  criteria_subject TEXT,
  threshold       INTEGER NOT NULL DEFAULT 1,
  xp_reward       INTEGER NOT NULL DEFAULT 0,
  coin_reward     INTEGER NOT NULL DEFAULT 0,
  UNIQUE (class_id, key)
);
CREATE TABLE student_achievements (
  student_id     INTEGER NOT NULL REFERENCES students(user_id) ON DELETE CASCADE,
  achievement_id INTEGER NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  earned_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, achievement_id)
);

-- Player edits on top of the deterministic generated terrain.
-- block_id 0 means "removed" (air) at a position that was solid terrain.
CREATE TABLE world_blocks (
  world_id  INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  x         SMALLINT NOT NULL,
  y         SMALLINT NOT NULL,
  z         SMALLINT NOT NULL,
  block_id  SMALLINT NOT NULL,
  placed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  placed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (world_id, x, y, z)
);
CREATE INDEX world_blocks_owner ON world_blocks (world_id, placed_by);

-- Class project zones (collaborative building areas).
CREATE TABLE project_zones (
  id         SERIAL PRIMARY KEY,
  class_id   INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  x0 SMALLINT NOT NULL, z0 SMALLINT NOT NULL, x1 SMALLINT NOT NULL, z1 SMALLINT NOT NULL,
  bonus_xp_per_block INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE activity_logs (
  id         BIGSERIAL PRIMARY KEY,
  actor_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  class_id   INTEGER REFERENCES classes(id) ON DELETE CASCADE,
  action     TEXT NOT NULL,
  details    JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX activity_logs_class ON activity_logs (class_id, created_at DESC);
