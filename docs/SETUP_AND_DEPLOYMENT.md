# Setup, deployment, backups and troubleshooting

This guide is for whoever installs and runs Character Quest (a teacher who is comfortable following steps, or school IT). Teachers who only *use* the platform should read the [Teacher Guide](TEACHER_GUIDE.md).

Character Quest is **one web server + one PostgreSQL database**. The web server serves the website, the API and the live multiplayer connection on the same port.

---

## 1. Requirements

- **Node.js 20 or newer** (22 recommended) — https://nodejs.org
- **PostgreSQL 14 or newer** — local install, school server, or any hosted provider
- A modern browser for students: Chrome/Edge/Firefox/Safari on desktop or Chromebook (the 3D world needs WebGL, which every current Chromebook supports)

## 2. Environment variables

Copy `.env.example` to `.env` and edit it. On hosting providers, set these in their dashboard instead.

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yes | `postgres://cq:cqpass@localhost:5432/character_quest` | PostgreSQL connection string: `postgres://USER:PASSWORD@HOST:PORT/DATABASE` |
| `DATABASE_SSL` | No | `false` | `true` if your database requires SSL (most hosted databases' external URLs do) |
| `PORT` | No | `3000` | Port the server listens on (hosting providers usually set this for you) |
| `NODE_ENV` | No | `development` | Set to `production` when the site is served over **HTTPS**. This makes login cookies HTTPS-only and requires a real `SESSION_SECRET`. |
| `SESSION_SECRET` | Yes in production | `dev-secret` | Long random string mixed into session tokens. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. The server refuses to start in production without it. |
| `SESSION_DAYS` | No | `14` | How many days a login lasts |
| `SEED_DEMO` | No | `true` | Create the demo teacher, class, students and questions on first start. Use `false` for real classes. |
| `ADMIN_USERNAME` | No | `admin` | Username of the first administrator (created on first start if no admin exists) |
| `ADMIN_PASSWORD` | Recommended | *(blank)* | Password for that administrator. If blank, a random temporary password is printed once in the server log. |
| `TEACHER_SIGNUP_CODE` | No | *(blank)* | If set, teachers can create their own accounts on the login page by entering this code. If blank, teacher sign-up is off and the administrator creates teacher accounts. |
| `TEST_DATABASE_URL` | Tests only | `…/character_quest_test` | Database used by `npm test`. **It is wiped on every test run.** |

## 3. Local install (step by step)

```bash
# Get the code, then in the project folder:
npm install

# Create a database and user (example using the psql tool):
psql -U postgres -c "CREATE USER cq WITH PASSWORD 'choose-a-password';"
psql -U postgres -c "CREATE DATABASE character_quest OWNER cq;"

cp .env.example .env
# edit .env: DATABASE_URL=postgres://cq:choose-a-password@localhost:5432/character_quest

npm run build     # builds the website and the server
npm start         # applies database migrations, creates the admin (and demo data), starts the server
```

Open http://localhost:3000. You should see the login page. Log in as `teacher` / `teacher123` to explore the demo, or as the administrator.

**Development mode** (auto-reload while editing code): `npm run dev`, then open http://localhost:5173.

## 4. Database migrations

The schema lives in `server/migrations/*.sql` and is applied **automatically every time the server starts** (each file once, in order, tracked in the `schema_migrations` table). To apply them without starting the server (after `npm run build`):

```bash
npm run migrate
```

To change the schema later, add a new file such as `server/migrations/002_add_quests.sql`. Never edit a migration that has already run on a real database.

## 5. Deploying for your school

Pick one. In every case: use HTTPS, set `NODE_ENV=production`, a real `SESSION_SECRET`, `SEED_DEMO=false` (after you've tried it), and a strong `ADMIN_PASSWORD`.

### Option A — Render.com (easiest hosted option)
1. Put the project in a GitHub repository.
2. In Render: **New → Blueprint**, choose the repository. `render.yaml` creates a PostgreSQL database and the web service.
3. Fill in `ADMIN_PASSWORD` (and `TEACHER_SIGNUP_CODE` if wanted) when asked. Render provides HTTPS automatically.
4. Open the `.onrender.com` address it gives you.

Plan names and prices change; pick paid plans for real classroom use so the database is persistent and backed up. (The blueprint was written for this project but has not been run on Render by the author — check the build log the first time.)

### Option B — Any server with Docker (school server, cloud VM)
1. Install Docker.
2. Edit the passwords and secret in `docker-compose.yml`.
3. `docker compose up -d`
4. Put a reverse proxy with HTTPS in front (for example Caddy: `caddy reverse-proxy --from quest.yourschool.org --to localhost:3000`), then set `NODE_ENV: production` in `docker-compose.yml` and run `docker compose up -d` again.

The database is stored in the `dbdata` Docker volume. (The Dockerfile and compose file follow standard practice but could not be test-built in the environment where this project was made, because it had no access to Docker Hub.)

### Option C — Plain Linux server (no Docker)
1. Install Node.js 22 and PostgreSQL; create the database as in step 3.
2. Copy the project, `npm ci && npm run build`.
3. Run it as a service, e.g. with systemd:
   ```ini
   [Service]
   WorkingDirectory=/opt/character-quest
   EnvironmentFile=/opt/character-quest/.env
   ExecStart=/usr/bin/node server/dist/index.js
   Restart=always
   ```
4. Put nginx or Caddy in front with HTTPS. **WebSockets must be allowed** through the proxy (nginx: `proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`).

### Capacity
One small server (1 CPU, 1 GB RAM) comfortably handles several classes. Each world is 256×256 blocks; only player edits are stored, so a very busy class world is a few megabytes. The real-time server keeps each world's edits in memory for speed.

## 6. Backups

All progress is in PostgreSQL, so **back up the database**. Use both methods:

**A. Database dumps (recommended, daily)**
```bash
pg_dump "$DATABASE_URL" -Fc -f backup-$(date +%F).dump
# restore into an empty database:
pg_restore -d "$DATABASE_URL" --clean --if-exists backup-2026-09-27.dump
```
Schedule it with cron, e.g. `0 2 * * * pg_dump "$DATABASE_URL" -Fc -f /backups/cq-$(date +\%F).dump`. Most hosted databases also offer automatic backups — turn them on.

**B. Built-in JSON backup**
- In the app: log in as administrator → **Download full backup** (everything: accounts, progress, questions, worlds).
- Command line (after `npm run build`): `npm run backup` (writes `backups/backup-<date>.json`), or `npm run backup -- my-file.json`.

**Restoring a JSON backup REPLACES ALL DATA** and logs everyone out:
- In the app: administrator → **Restore from backup…** → type `RESTORE`.
- Command line: `npm run restore -- backups/backup-2026-09-27.json` (asks you to type RESTORE).

**Exports for teachers:** Settings → *Export student data (JSON)* and *Export question bank (CSV)*.

## 7. Demo accounts

See the README. Demo data is only created when `SEED_DEMO=true` and the `teacher` account does not exist yet. To remove it later, delete the demo teacher's students in the dashboard and disable the `teacher` account on the admin page.

## 8. Troubleshooting

| Problem | Fix |
| --- | --- |
| Server says **"Check DATABASE_URL"** / `ECONNREFUSED` | PostgreSQL is not running or the address/password in `DATABASE_URL` is wrong. Test with `psql "$DATABASE_URL" -c "select 1"`. |
| `database "character_quest" does not exist` | Create it (step 3). |
| Hosted DB error about SSL / `no pg_hba.conf entry … SSL off` | Set `DATABASE_SSL=true`. |
| **Server refuses to start in production** | Set `SESSION_SECRET` to a long random value. |
| Can't log in after deploying; login works then immediately logs out | You set `NODE_ENV=production` but the site is on plain `http://`. Use HTTPS, or set `NODE_ENV=development` for testing. |
| The page says "Client not built yet" | Run `npm run build`. |
| World stays on "Could not connect to the world" | Your proxy blocks WebSockets, or you opened the teacher world without choosing a class (use **Enter the world** in the dashboard). |
| World is very slow or black | The computer has no hardware graphics (WebGL). Update the browser/Chromebook, enable "Use graphics acceleration" in browser settings. |
| A student forgot their password | Teacher dashboard → Students → the student → **Reset password**. |
| A teacher forgot their password | Administrator → Teachers → **Reset password**. |
| Forgot the administrator password | Stop the server and run: `psql "$DATABASE_URL" -c "DELETE FROM users WHERE role='admin'"`, set `ADMIN_PASSWORD`, start the server again (it recreates the admin). |
| "Too many tries" at login | 10 failed attempts lock that username for 10 minutes on that network. Wait, or reset the password. |
| Students can't build | Check World → Building permissions (read-only mode?), the student isn't paused or blocked from building, and they're inside their plot (yellow outline) in "Personal area" mode. |
| A student can't enter a region | Regions unlock by level (Desert 2, Ocean 3, Mountains 4). Teachers can tick **Unlock every region** under World. |
| `npm test` fails to connect | Create the test database: `createdb character_quest_test`, or set `TEST_DATABASE_URL`. |
