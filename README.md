# Character Quest

An educational multiplayer block world where **academics drive the world**:

> Answer questions → earn XP, skills and blocks → build in a shared world → earn achievements → level up → unlock new regions and materials → keep learning.

Students log in, walk a shared 3D voxel world with their class, visit the **Quest Center** to answer teacher-made questions, and use the blocks they earn to build. Teachers create questions and rewards, control building permissions, moderate the world and see detailed academic progress — all without programming.

This is the **Phase 1 MVP plus several Phase 2 features**, and it is a working application: accounts, progress, questions, rewards, inventories and every block in the world are stored in PostgreSQL and enforced by the server.

---

## Documentation

| Guide | For |
| --- | --- |
| [docs/SETUP_AND_DEPLOYMENT.md](docs/SETUP_AND_DEPLOYMENT.md) | Installing, environment variables, database migrations, deployment, backups, troubleshooting |
| [docs/TEACHER_GUIDE.md](docs/TEACHER_GUIDE.md) | Teachers: setup, questions, rewards, assignments, world controls, analytics |
| [docs/STUDENT_GUIDE.md](docs/STUDENT_GUIDE.md) | Students: logging in, controls, answering, building, leveling up (printable) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Developers: architecture, database schema, security model, real-time protocol, extending the game |

---

## Quick start (on your own computer)

Requirements: **Node.js 20+** and **PostgreSQL 14+**.

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env          # then edit DATABASE_URL and the passwords

# 3. Create the database (once), e.g.
createdb character_quest

# 4. Build and start (runs migrations and creates demo data on first start)
npm run build
npm start
```

Open **http://localhost:3000**.

For development with hot reload: `npm run dev` and open http://localhost:5173 (the Vite dev server proxies to the API on port 3000).

Docker alternative: `docker compose up -d` (edit the passwords in `docker-compose.yml` first).

## Demo accounts

Created automatically on first start when `SEED_DEMO=true`:

| Role | Username | Password |
| --- | --- | --- |
| Teacher ("Teacher Demo") | `teacher` | `teacher123` |
| Students (Grade 5 Adventure Class) | `alex`, `jordan`, `sam`, `taylor` | `quest123` |
| Administrator | value of `ADMIN_USERNAME` (default `admin`) | value of `ADMIN_PASSWORD` (if blank, a temporary password is printed in the server log) |

The demo class code is **DEMO5A** (students can join with it from the login page). The demo includes 20 questions across Math, Reading, Science, Writing and Programming, a "Fractions Challenge" assignment, a "Build the Future City" project zone, answer history, and two example buildings (Jordan's house and Alex's tower).

**Turn the demo off for real classes:** set `SEED_DEMO=false` (and delete the demo teacher from the admin page if it already exists).

---

## Implemented features

**Accounts and classes**
- Teacher, student and admin roles; bcrypt-hashed passwords; secure HTTP-only session cookies; login rate limiting.
- Teachers create classes; each class gets its own persistent world and a join code.
- Students are added by the teacher (one at a time or pasted as a list) or join themselves with the class code.
- Teacher self sign-up with a sign-up code, or admin-created teacher accounts.

**Shared multiplayer world**
- 256×256×64 voxel world generated from a seed, with five regions: **Starting Village** (spawn, Quest Center & Question Hall, Marketplace, Achievement Hall, Tutorial Garden, student plots), **Forest**, **Desert**, **Ocean** (islands), **Mountains** (snow, stone).
- Region locks by level (Forest 1, Desert 2, Ocean 3, Mountains 4), enforced by the server; teachers can unlock everything.
- Real-time multiplayer with Socket.IO: see classmates move (name labels), see blocks placed/removed live.
- First-person and third-person view, walking, running, jumping, swimming, collision, gravity; teachers can fly.
- Block placement and removal with a hotbar (1–9, mouse wheel), inventory screen, block highlighting, minimap and full world map.
- Every edit is validated server-side (permissions, inventory, reach, protected buildings, region locks, rate limit) and saved to the database before anyone sees it. Buildings persist forever.
- 32 block types, 27 of them earnable across Common → Uncommon → Rare → Epic → Legendary (glass, bricks, gold, diamond brick, crystal, glow lantern, starstone, rainbow…), all with procedurally drawn pixel textures.

**Academic engine**
- Question types: multiple choice, true/false, short answer (several accepted answers, case-insensitive), numeric (with tolerance), and **matching** (2–8 pairs; the right column is shuffled; all pairs must be right).
- Every question has subject, topic, grade, difficulty 1–5, XP, skill + points, block + quantity, coins, optional time limit and explanation. Rewards default from the difficulty and can be overridden.
- Answers are checked on the server; correct answers are never sent to the browser; rewards are granted once per question; wrong answers cost nothing and students can retry.
- Hard questions get a special "MASTER QUESTION COMPLETE!" reward screen.
- Assignments: group questions, target the whole class or chosen students, bonus reward when all are solved.
- CSV import and export of the question bank.
- Adaptive recommendations: topics with <60% accuracy (3+ tries) are flagged "recommended practice" for the student and shown to the teacher (can be turned off).

**Progression**
- XP and levels (0, 100, 250, 500, 800, … scaling), titles (Apprentice → Legend).
- Skills (Mathematics, Reading, Science, Writing, Programming, Problem Solving + teacher-created custom skills).
- Achievements: 10 built-in (First Steps, Builder, Master Builder, Mathematician, Science Explorer, Bookworm, Problem Solver, Quick Learner, Task Master, Scholar) plus teacher-created ones (automatic criteria or awarded manually).
- Coins earned from questions (currency is secondary; academics stay the main way to progress).
- Student profile: level, XP, title, coins, skills, achievements (with progress), buildings, regions.

**Quests, daily challenges and special events**
- Multi-step quests: up to 10 ordered steps (answer N questions, N in a subject or topic, N difficult ones, place N blocks, place blocks in a project zone, visit a region, complete an assignment). Rewards: XP, coins, blocks, cosmetic item.
- The same quest can repeat **daily** or **weekly** (a daily/weekly challenge). Resets at midnight in the class time zone.
- Special events: a class-wide goal (correct answers, answers in a subject, blocks placed, or points the teacher adds for real-world things like a walk-a-thon). When the goal is reached every helper gets the reward and a structure (Crystal Fountain, Golden Champion Statue, Rainbow Arch) is built in the world live.
- Progress is counted by the server from real actions. Quest tracker in the HUD and a Quests & Events window (L).

**Cosmetics shop**
- 22 cosmetics: shirts, hats (cap, headband, wizard hat, top hat, knight helmet, crowns), capes and titles. Some need a level, some are reward-only (quests, events, teacher bonus).
- Bought with coins in a server transaction. Cosmetics never change XP, levels or answers. Equipped items show on the 3D avatar for everyone in real time.

**Chat (moderated, class-only)**
- Off, **safe phrases only** (12 pre-written phrases), or typed messages (filtered for unkind words, links and phone numbers; 1 message per 3 seconds).
- Teachers see every message, including the original of filtered ones, can hide messages (removed from every screen live) and mute individual students. No private messages.

**Teacher-approval building**
- New build mode: students build in their own plot, new blocks show with a gold tint only to the builder and the teacher; the student submits the build with a note; the teacher approves (everyone sees it instantly) or sends it back (blocks return to the student's inventory) with feedback.

**Touch controls**
- Automatic on tablets and phones (or on/off in Settings): movement joystick, drag to look, Place / Remove / Jump / View / Chat buttons, a compact Menu button, and a smaller layout on phones.

**Teacher dashboard**
- Class overview: students, questions completed, accuracy, XP, buildings, achievements, blocks placed, level chart, recent activity.
- Student progress page: level, XP, correct/incorrect, accuracy, per-topic accuracy with time spent, skills, inventory, buildings, recent answers, assignments, activity.
- Question builder, question bank with accuracy per question, assignments, bonus rewards (to one student or everyone), skills, achievements.
- World controls: build mode (build anywhere / personal area / personal + class project zones / teacher approval / read only), gathering on/off + daily limit, unlock all regions, class project zones with bonus XP per block.
- Moderation: pause (freeze) a student, turn building off per student, send a student to their plot, remove a student's buildings, reset any area, delete students; every action is logged.
- Analytics: accuracy by topic and difficulty, students who need help, 30-day activity chart.
- Pages for Quests, Events, Approvals and Chat; class time zone setting; cosmetic items as bonus rewards; mute per student.
- Built-in **Getting Started** guide. Teachers can enter the world with unlimited blocks.

**Administration**
- Create/disable teachers, reset passwords, system overview and activity log.
- Full JSON backup download and restore; per-class student data export; CLI `backup`/`restore` commands.

**Accessibility**
- Full keyboard play (arrow keys to look, F to place, R to remove), text size setting, reduced-motion option, mouse sensitivity/invert, labels on all controls, tier names always shown next to tier colors.

## Not built yet (planned)

Designed for but not implemented in this version: a separate vocabulary question type (use matching), NPCs, boss challenges, mini-games, multiple worlds per class, school-wide worlds. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#extending-the-game) for where each would plug in.

## Offline test build (one HTML file)

`npm run build:offline` writes `dist-offline/character-quest-test.html`: the whole app in one file, including a real PostgreSQL database compiled to WebAssembly (PGlite). Double-click it to open it in Chrome, Edge or Firefox. It runs the same server code as the hosted version, in the page:

- Nothing is sent over the internet (fonts are the only thing it tries to download). Progress is saved in that browser (IndexedDB) until you click **Reset demo data**.
- A bar at the bottom lets you log in as any demo account (admin password is `admin123` here) and turn **simulated classmates** on or off (Sam and Taylor walk around the village and send safe-phrase chat, so you can see multiplayer in one tab).
- For real classes use the hosted version: the offline file only knows one browser, so students can't join each other.

## Tests

```bash
npm test
```

Runs end-to-end tests against a real PostgreSQL test database (`TEST_DATABASE_URL`, default `postgres://cq:cqpass@localhost:5432/character_quest_test` — **the test database is wiped**). They cover: login, teacher question creation → student answer → server-side XP/skill/block/coin rewards → inventory; one-time rewards; role and class isolation; joining with a class code; real-time block sync between two clients; permission, reach, inventory and read-only checks; persistence across a cache flush and reconnect; region locks; assignments; CSV import/export; admin backups; matching answers; multi-step and daily quests and class events (including the unlocked structure); the cosmetics shop (coins, levels, ownership, no XP change); chat modes, filter, mute and hiding; and teacher-approval building (hidden from classmates until approved, rejected blocks returned).

## Project layout

```
shared/   Block catalog, world generation, leveling rules, socket protocol (used by both sides)
server/   Express API, Socket.IO multiplayer, PostgreSQL migrations, reward engine, tests
client/   React UI + Three.js game engine (student world, teacher dashboard, admin)
offline/  Single-file offline test build (PGlite database + in-page server)
docs/     Guides
```
