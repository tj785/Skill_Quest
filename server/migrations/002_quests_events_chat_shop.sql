-- Phase 2/3 features: matching questions, teacher-approval building, chat, cosmetics,
-- multi-step quests (with daily/weekly repeats) and special events.

-- Matching questions store the right-hand side of each pair here.
ALTER TABLE question_answers ADD COLUMN match_text TEXT;
ALTER TABLE questions DROP CONSTRAINT questions_type_check;
ALTER TABLE questions ADD CONSTRAINT questions_type_check
  CHECK (type IN ('multiple_choice', 'true_false', 'short_answer', 'numeric', 'matching'));

-- Teacher-approval building mode and chat settings.
ALTER TABLE classes DROP CONSTRAINT classes_build_mode_check;
ALTER TABLE classes ADD CONSTRAINT classes_build_mode_check
  CHECK (build_mode IN ('anywhere', 'personal_area', 'class_project', 'teacher_approval', 'read_only'));
ALTER TABLE classes DROP COLUMN chat_enabled;
ALTER TABLE classes ADD COLUMN chat_mode TEXT NOT NULL DEFAULT 'off' CHECK (chat_mode IN ('off', 'preset', 'free'));
ALTER TABLE classes ADD COLUMN timezone TEXT NOT NULL DEFAULT 'America/Chicago';
ALTER TABLE students ADD COLUMN muted BOOLEAN NOT NULL DEFAULT FALSE;

-- Blocks placed in approval mode stay hidden from classmates until approved.
ALTER TABLE world_blocks ADD COLUMN approved BOOLEAN NOT NULL DEFAULT TRUE;
CREATE INDEX world_blocks_pending ON world_blocks (world_id, placed_by) WHERE NOT approved;

CREATE TABLE build_submissions (
  id          SERIAL PRIMARY KEY,
  class_id    INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id  INTEGER NOT NULL REFERENCES students(user_id) ON DELETE CASCADE,
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  feedback    TEXT,
  blocks      INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX build_submissions_class ON build_submissions (class_id, status);

-- Chat (moderated).
CREATE TABLE messages (
  id         BIGSERIAL PRIMARY KEY,
  class_id   INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  text       TEXT NOT NULL,
  original   TEXT,
  hidden     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX messages_class ON messages (class_id, id DESC);

-- Cosmetics owned by students.
CREATE TABLE student_items (
  student_id  INTEGER NOT NULL REFERENCES students(user_id) ON DELETE CASCADE,
  item_key    TEXT NOT NULL,
  equipped    BOOLEAN NOT NULL DEFAULT FALSE,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, item_key)
);

-- Multi-step quests. repeat = 'daily' / 'weekly' makes a daily or weekly challenge.
CREATE TABLE quests (
  id          SERIAL PRIMARY KEY,
  class_id    INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  repeat      TEXT NOT NULL DEFAULT 'none' CHECK (repeat IN ('none', 'daily', 'weekly')),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  xp_reward   INTEGER NOT NULL DEFAULT 0 CHECK (xp_reward >= 0),
  block_id    SMALLINT REFERENCES blocks(id),
  block_qty   INTEGER NOT NULL DEFAULT 0 CHECK (block_qty >= 0),
  coin_reward INTEGER NOT NULL DEFAULT 0 CHECK (coin_reward >= 0),
  item_key    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE quest_steps (
  id          SERIAL PRIMARY KEY,
  quest_id    INTEGER NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  sort        SMALLINT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('correct_answers', 'subject_correct', 'topic_correct', 'hard_correct', 'place_blocks', 'place_in_zone', 'visit_region', 'complete_assignment')),
  amount      INTEGER NOT NULL DEFAULT 1 CHECK (amount >= 1),
  subject     TEXT,
  topic       TEXT,
  region      TEXT,
  description TEXT
);
CREATE INDEX quest_steps_quest ON quest_steps (quest_id, sort);
-- period is '' for one-time quests, 'YYYY-MM-DD' for daily, 'YYYY-Www' for weekly.
CREATE TABLE student_quests (
  student_id    INTEGER NOT NULL REFERENCES students(user_id) ON DELETE CASCADE,
  quest_id      INTEGER NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  period        TEXT NOT NULL DEFAULT '',
  step_index    INTEGER NOT NULL DEFAULT 0,
  step_progress INTEGER NOT NULL DEFAULT 0,
  completed_at  TIMESTAMPTZ,
  PRIMARY KEY (student_id, quest_id, period)
);

-- Special events with a whole-class goal.
CREATE TABLE events (
  id               SERIAL PRIMARY KEY,
  class_id         INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  description      TEXT,
  goal_kind        TEXT NOT NULL CHECK (goal_kind IN ('correct_answers', 'subject_correct', 'blocks_placed', 'manual')),
  subject          TEXT,
  goal_amount      INTEGER NOT NULL CHECK (goal_amount >= 1),
  progress         INTEGER NOT NULL DEFAULT 0,
  starts_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at          TIMESTAMPTZ,
  reward_xp        INTEGER NOT NULL DEFAULT 0,
  reward_coins     INTEGER NOT NULL DEFAULT 0,
  reward_item      TEXT,
  unlock_structure TEXT,
  structure_x      SMALLINT,
  structure_z      SMALLINT,
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX events_class ON events (class_id);
CREATE TABLE event_contributions (
  event_id   INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(user_id) ON DELETE CASCADE,
  points     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, student_id)
);
