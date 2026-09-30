# Architecture

## Overview

```
 Browser (student / teacher / admin)
 ┌──────────────────────────────────────────────┐
 │ React UI (client/src)                        │
 │  • Landing / login                            │
 │  • Teacher dashboard, Admin                   │
 │  • Game HUD, Question Center, panels          │
 │ Game engine (client/src/game/Engine.ts)       │
 │  • Three.js voxel renderer, player physics    │
 └───────────────┬───────────────┬──────────────┘
          HTTPS JSON          WebSocket (Socket.IO)
                 │               │
 ┌───────────────▼───────────────▼──────────────┐
 │ Node.js server (server/src)                  │
 │  app.ts ─ routes/auth, student, teacher, admin│
 │  realtime.ts ─ multiplayer engine            │
 │  services/                                   │
 │    questions.ts  academic engine             │
 │    rewards.ts    reward engine (XP, skills,  │
 │                  blocks, coins, achievements)│
 │    world.ts      world engine (permissions,  │
 │                  inventory, persistence)     │
 │    classes.ts, achievements.ts, backup.ts    │
 └───────────────┬──────────────────────────────┘
                 │ SQL (pg)
          ┌──────▼──────┐
          │ PostgreSQL  │
          └─────────────┘
 shared/src ─ code used by BOTH sides: block catalog, deterministic world generation,
              level curve and difficulty presets, socket message types.
```

Stack: TypeScript everywhere; React 19 + Vite on the client; Three.js for WebGL; Express 5 + Socket.IO on Node 20+; PostgreSQL with plain SQL migrations; zod for input validation; bcrypt for passwords.

The code is split into the engines the brief asked for:

| Engine | Where |
| --- | --- |
| Frontend | `client/src/ui`, `client/src/teacher`, `client/src/game/*.tsx` |
| Game engine | `client/src/game/Engine.ts`, `textures.ts` |
| Authentication | `server/src/auth.ts`, `routes/auth.ts` |
| Academic engine | `server/src/services/questions.ts` |
| Reward engine | `server/src/services/rewards.ts`, `achievements.ts` |
| Multiplayer engine | `server/src/realtime.ts` |
| World engine | `server/src/services/world.ts`, `shared/src/world.ts` |
| Database | `server/src/db.ts`, `server/migrations/` |
| Teacher dashboard | `server/src/routes/teacher.ts`, `client/src/teacher/` |
| Admin tools | `server/src/routes/admin.ts`, `services/backup.ts`, `cli.ts`, `client/src/teacher/AdminPage.tsx` |

## The core loop in code

1. Teacher saves a question → `POST /api/teacher/classes/:id/questions` → `saveQuestion()` stores it in `questions` + `question_answers` (reward blanks filled from the difficulty preset).
2. Student opens the Question Center → `GET /api/student/questions` returns questions **without** correct-answer flags.
3. Student answers → `POST /api/student/questions/:id/answer` → `submitAnswer()` in one transaction: locks the student row, checks the answer on the server, records the attempt in `student_answers`, and if it's the first correct answer calls `grantReward()` (XP + level, coins, skill points, blocks into `inventory`, achievements), then completes any finished assignment. A partial unique index guarantees a question rewards a student at most once.
4. The server pushes `progress` and `inventory` events to the student's open game over the socket.
5. Student places a block → socket `place` → `placeBlock()` (serialized per world): checks block type, reach from the server's last known position, target cell empty, class build mode, protected village, region lock, personal plot / project zone, then **decrements inventory and writes `world_blocks` in one transaction**, then broadcasts `blockChanged` to everyone in that world.

The browser never decides rewards, inventory or permissions. Editing client code or using developer tools can change what a student *sees*, not what they *have*.

## World storage

The terrain is generated from a per-world seed by `shared/src/world.ts` — identical code on server and client, so terrain is never stored. Only differences are stored:

- `world_blocks (world_id, x, y, z) → block_id, placed_by` — `block_id = 0` means "dug out".
- Placing the original terrain block back deletes the row.
- On join the server sends the seed plus all edits; the client regenerates the world and applies edits.
- The server caches each world's edits in memory (`services/world.ts`) and invalidates the cache after bulk operations (resets, restores).

World: 256 × 256 × 64 blocks, 16×16 chunk columns. Regions by direction from the village: desert east, ocean south, forest west, mountains north. Landmarks and plots are defined in `shared/src/world.ts` (`LANDMARKS`, `plotBounds`).

## Real-time protocol (`shared/src/protocol.ts`)

Client → server: `move {x,y,z,yaw}` (10/s), `place {x,y,z,b}` + ack, `remove {x,y,z}` + ack, `chat {text}` + ack.
Server → client: `welcome`, `playerJoined`, `playerLeft`, `playerMoved`, `playerUpdated` (cosmetics/level), `blockChanged` (with `pending` for approval-mode blocks), `blockBatch` (approved/rejected builds), `blocksReset`, `inventory`, `progress`, `questUpdate`, `chat`, `chatHidden`, `chatConfig`, `toast`, `teleport`, `frozen`.

Pending (unapproved) blocks are filtered per viewer: only the builder and teachers receive them.

Sockets authenticate with the same HTTP-only session cookie as the API. Students join the room of their own class's world; teachers pass a `classId` they own. Movement is sanity-checked (speed, world bounds, frozen, region locks → `teleport` back). Edits are rate-limited to 12 per second per connection. Rooms: `world:<id>`, `class:<id>`, `user:<id>`.

## Security model

- Passwords hashed with bcrypt. Sessions are random 256-bit tokens; only a SHA-256 hash (with `SESSION_SECRET`) is stored. Cookies are HTTP-only, SameSite=Lax, Secure in production.
- Role-based access: `requireRole('student' | 'teacher' | 'admin')` on every router; teachers can only touch their own classes and students (`assertClassAccess`, `assertStudentAccess`); admins can access everything.
- All input validated with zod; SQL is always parameterized.
- Server-authoritative rewards, inventory, building permissions and achievements. Rewards happen only inside `grantReward()`.
- Login rate limiting (10 failures per username+IP per 10 minutes). Helmet security headers with a strict Content Security Policy.
- Chat is class-only, off by default, and moderated: safe-phrase mode accepts only the preset list (checked on the server); typed mode is filtered, rate-limited and keeps the original text for the teacher; teachers can hide messages and mute students. No private messages. Every administrative action is written to `activity_logs`.
- Coins are spent only inside `buyItem()` (row-locked transaction); cosmetics never touch XP or levels. Quest and event progress is recorded only by `recordGameEvent()` from server-side actions.

## Database schema

Tables are created by `server/migrations/001_init.sql` and `002_quests_events_chat_shop.sql`.

| Table | Purpose | Key columns |
| --- | --- | --- |
| `users` | Every account | `username` (unique, case-insensitive), `password_hash`, `display_name`, `role`, `disabled` |
| `sessions` | Login sessions | `token_hash`, `user_id`, `expires_at` |
| `teachers` | Teacher profile | `user_id`, `school` |
| `worlds` | One per class | `seed` |
| `classes` | Classes and their world settings | `teacher_id`, `world_id`, `join_code`, `build_mode`, `harvest_enabled`, `harvest_daily_cap`, `unlock_all_regions`, `adaptive_enabled`, `chat_enabled` |
| `students` | Student character & progress | `user_id`, `class_id`, `plot_index`, `xp`, `level`, `coins`, `blocks_placed`, `can_build`, `frozen`, saved position, daily gathering counter |
| `blocks` | Block catalog (synced from `shared/src/blocks.ts`) | `id`, `key`, `name`, `tier` |
| `inventory` | Blocks a student owns | `(student_id, block_id)`, `quantity ≥ 0` |
| `skills` / `student_skills` | Per-class skills and points | `name`; `points` |
| `questions` | Question bank | type, prompt, subject, topic, grade, difficulty, rewards (`xp_reward`, `skill_id`, `skill_amount`, `block_id`, `block_qty`, `coin_reward`), `numeric_tolerance`, `time_limit_sec`, `active` |
| `question_answers` | Options / accepted answers | `text`, `is_correct` |
| `student_answers` | Every attempt | `answer_text`, `correct`, `attempt_no`, `time_spent_ms`, `rewarded` (unique per student+question when true) |
| `assignments`, `assignment_questions`, `assignment_students`, `student_assignments` | Assignments, their questions, targeted students, completions | bonus reward columns |
| `achievements` / `student_achievements` | Built-in and custom achievements; who earned what | `criteria_type`, `criteria_subject`, `threshold`, rewards |
| `world_blocks` | Player edits to each world (the spec's `world_chunks`) | `(world_id, x, y, z)`, `block_id`, `placed_by` |
| `project_zones` | Class project areas | rectangle, `bonus_xp_per_block` |
| `quests` / `quest_steps` / `student_quests` | Multi-step quests; `repeat` none/daily/weekly; per-student progress per `period` ('' / YYYY-MM-DD / YYYY-Www) | `step_index`, `step_progress`, `completed_at` |
| `events` / `event_contributions` | Class goals and who helped | `goal_kind`, `goal_amount`, `progress`, rewards, `unlock_structure`, position |
| `student_items` | Cosmetics owned / equipped | `(student_id, item_key)`, `equipped` |
| `messages` | Class chat | `text`, `original` (before filtering), `hidden` |
| `build_submissions` | Approval-mode submissions | `status`, `note`, `feedback`, `blocks` |
| `activity_logs` | Audit trail | `actor_id`, `class_id`, `action`, `details` (JSON) |
| `schema_migrations` | Applied migrations | `name` |

Indexes cover class lookups, answers by student/question, world edits by owner and logs by class/time.

`world_blocks.approved` marks approval-mode blocks; `classes.chat_mode` and `classes.timezone`, `students.muted` and `question_answers.match_text` were added in migration 002. `rewards` and `permissions` from the brief are columns rather than tables (rewards live on questions/assignments/quests/events; permissions are class settings plus per-student flags).

## Where the Phase 2/3 features live

| Feature | Server | Client |
| --- | --- | --- |
| Multi-step quests, daily/weekly challenges | `services/progress.ts` `recordGameEvent()` is called from `submitAnswer()`, `placeBlock()`, region changes in `realtime.ts`, and assignment completion; rewards via `grantReward()`. Routes: teacher `/quests`, student `/quests`. | `game/Extras.tsx` `QuestTracker`, `QuestLogPanel`; `teacher/EngagePages.tsx` `QuestsPage` |
| Special events | `events` goal counter in `recordGameEvent()` / teacher points; `completeEvent()` builds the structure from `STRUCTURES` (`shared/src/extras.ts`) and `announceEvent()` broadcasts `blocksReset`. | Events tab in `QuestLogPanel`; `EventsPage` |
| Teacher-approval building | Build mode `teacher_approval`; `world_blocks.approved=false`; `editsList()`/`visibleBlockFor()` filter per viewer; `approvePending()` / `rejectPending()`. | Gold tint in `Engine` (`markPending`), `ApprovalBar`; `ApprovalsPage` |
| Chat | `chat` socket handler in `realtime.ts`, `filterChat()` and `CHAT_PRESETS` in `shared/src/extras.ts`; moderation routes. | `ChatBox`; `ChatPage` |
| Cosmetics shop | `services/shop.ts`; `studentLook()` sent in `PlayerState.look`; `hub.updateLook()` broadcasts `playerUpdated`. | `ShopPanel`; avatars in `Engine.makeAvatar()` |
| Matching questions | `isCorrect()` (JSON map of left → right), `publicQuestion()` shuffles the right column; CSV `a=b \| c=d`. | Dropdown per item in `QuestionView`; pair rows in `QuestionBuilder` |
| Touch controls | — | `TouchControls` in `Extras.tsx`; `Engine.touchMode`, `touchMove`, `lookBy()`, `placeAction()`; `wantsTouch()` in `ui/prefs.ts` |
| Offline test build | `offline/` swaps `db.ts` for PGlite, `express` for a small router, `socket.io` for an in-page socket; the real routes, services and `realtime.ts` run unchanged. | Hash-based addresses via `client/src/nav.ts` |

## Extending the game

| Future feature | Where it plugs in |
| --- | --- |
| Vocabulary question type | Matching already covers word ↔ definition; a dedicated type would extend `QUESTION_TYPES`, `isCorrect()` and `QuestionView`. |
| NPCs, bosses, mini-games | Server-side entity list broadcast like players; question checks reuse `submitAnswer()`; boss wins can call `addEventPoints()`. |
| Larger / multiple worlds, biomes | `WORLD_SIZE` and the generator in `shared/src/world.ts`; classes already reference a `world_id`, so several worlds per class only need a join table. Beyond ~512² switch the client to streaming chunks by distance. |
| AI question generation | A teacher-only endpoint that drafts questions into the builder for review; never auto-publish. |
| Multiple schools | Add `schools` and a `school_id` on users/classes; scope admin queries by school. |

## Tests

`server/test/api.test.ts` starts the real app (HTTP + Socket.IO) against a scratch PostgreSQL database and exercises the full loop; see the README for what's covered. Browser-level checks (log in, load the world, answer questions, open panels, place and remove blocks with the keyboard, teacher dashboard pages, teacher entering the world) were run with Playwright during development.
