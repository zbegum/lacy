# Lacy

Lacy is a VS Code extension for getting to know an unfamiliar codebase. An expert
records what matters in a project, an LLM turns it into a step-by-step **code tour**
linked to real files and line ranges, and learners walk through it inside the editor
— with quizzes, questions back to the expert, an optional podcast version, and a
dashboard showing how people are getting on.

Lacy started as the research prototype behind a pilot study at a software company.
This repository is the version being made deployable outside that environment.

## What's in here

| Path | What it is |
|---|---|
| `src/` | The VS Code extension (TypeScript) and its sidebar UI |
| `server/` | The API server: tours, quizzes, podcasts, dashboard data |
| `dashboard/` | The expert dashboard (React), served by the server |
| `server/migrations/` | Database schema |

One server process serves the API and the dashboard. The extension talks to it over
HTTP, so it can run on your laptop or on a shared host.

## Installing it

If you just want to **use** Lacy rather than work on it, see
**[INSTALL.md](INSTALL.md)**: one `docker run` for the server, and a `.vsix` from the
[releases page](https://github.com/zbegum/lacy/releases/latest) for VS Code. Nobody
but the person running the server needs to clone anything.

The rest of this file is for running Lacy from source and working on it.

## Requirements

Lacy runs on **Windows, macOS and Linux**; the server also runs in Docker.

- Node.js 20 or newer
- An LLM API key: a Google **Gemini** key, or any **OpenAI-compatible** endpoint
  (OpenAI, a self-hosted vLLM/Ollama, or a company gateway)
- Optional: an **ElevenLabs** key for podcasts and voice-to-tour
- For voice-to-tour: **SoX** on each editor machine's `PATH` (macOS: `brew install sox`,
  Windows: `choco install sox`, Linux: `apt install sox`). Lacy tries VS Code's own
  microphone first, but VS Code usually refuses it (always on macOS so far), and
  then SoX does the recording

No database to install: Lacy keeps everything in a single SQLite file, created on
first start.

**Windows notes.** Use PowerShell or Command Prompt as usual; the npm scripts need no
shell tricks. `better-sqlite3` installs a prebuilt binary for common Node versions —
if npm falls back to compiling it, install the "Desktop development with C++"
workload from Visual Studio Build Tools, or run the server in Docker instead.
Everything else works the same on all platforms.

## Quick start

This sets Lacy up on one machine. Every command starts from the repository root, and
each block says where it runs.

```bash
git clone https://github.com/zbegum/lacy.git
cd lacy
cp .env.example .env        # then add your LLM API key
```

**1. Build the dashboard**

```bash
cd dashboard
npm install
npm run build
cd ..
```

**2. Install and start the server**

```bash
cd server
npm install
npm start                   # keep this running; it serves http://localhost:4000
```

The database file is created on first start. Leave this terminal open — the rest of
the steps run in a **second terminal**, again from the repository root.

**3. Create accounts**

Experts write tours; learners take them. Learners are assigned guided tours
automatically based on their department, so give people matching departments.

```bash
cd server
npm run create-user -- --email you@example.com --password 'secret' --role expert --department Backend
npm run create-user -- --email new.dev@example.com --password 'secret' --role learner --department Backend
cd ..
```

Check it worked by opening `http://localhost:4000` — the dashboard asks you to open
it from VS Code, which means the server and dashboard are both up.

**4. Run the extension**

```bash
npm install                 # in the repository root
```

Open this repository in VS Code and press `F5` ("Run Extension"). A second VS Code
window opens with Lacy installed — **open the project you want a tour of in that
window** (File ▸ Open Folder), then click the Lacy icon in the activity bar and sign
in with the account you created.

To install it as a normal extension instead, package it from the repository root:

```bash
npx @vscode/vsce package     # writes lacy-0.0.1.vsix
```

Then in VS Code: **Extensions ▸ ⋯ ▸ Install from VSIX**. Everyone on a team can
install the same `.vsix`; they only need `lacy.serverUrl` pointed at your server.

If your server is not on `http://localhost:4000`, set **`lacy.serverUrl`** in VS Code
settings.

**Optional:** podcasts and voice-to-tour need `ELEVENLABS_API_KEY` in `.env` (see
[API keys](#api-keys)). Voice-to-tour also needs SoX on the machine that records,
since VS Code usually refuses the panel the microphone; without it Lacy says so
before you start.

## Deploying with Docker

Everything a team needs is one container: the API, the built dashboard and the
SQLite database.

```bash
cp .env.example .env        # add your LLM API key; compose will not start without this file
docker compose up -d --build
docker compose exec lacy node server/scripts/create-user.js \
  --email you@example.com --password 'secret' --role expert --department Backend
```

Lacy is then on `http://<host>:4000` — the dashboard at `/`, the API under `/api`.
Everyone on the team sets **`lacy.serverUrl`** in VS Code to that address.

- **Data** lives in the `lacy-data` volume (`/data/lacy.sqlite` in the container).
  It survives restarts and rebuilds. Back it up by copying that one file:
  `docker compose cp lacy:/data/lacy.sqlite ./lacy-backup.sqlite`.
  `docker compose down -v` deletes it, so avoid `-v` unless you mean it.
- **Health**: `GET /api/health` and a Docker healthcheck; `docker compose ps` shows
  `healthy` once the server is up.
- **Updating**: `git pull && docker compose up -d --build`. Schema changes are
  applied automatically on start.
- **Behind a reverse proxy**: terminate TLS there and set `CORS_ORIGIN` to your
  public origin. Tokens travel in request headers, so use HTTPS.

Without Docker, the same thing is `cd server && npm ci && npm start` on any machine
with Node 20+, plus `cd dashboard && npm ci && npm run build` for the dashboard.

## Configuration

Everything is read from the environment (or `.env`); see
[`.env.example`](.env.example) for the full list.

| Setting | Default | Notes |
|---|---|---|
| `DB_FILE` | `server/data/lacy.sqlite` | Back this file up; it holds everything except podcast audio |
| `AUDIO_DIR` | `server/data/audio` | Generated podcast audio files |
| `LLM_PROVIDER` | `gemini` | or `openai` for any OpenAI-compatible endpoint |
| `STT_PROVIDER` | `elevenlabs` | or `google` (needs `GOOGLE_APPLICATION_CREDENTIALS`) |
| `PORT` | `4000` | |
| `CORS_ORIGIN` | `*` | Narrow this in production |

### API keys

Keys live only on the server, in `.env` (git-ignored); the extension never sees them.
There is no admin screen: whoever runs the server edits `.env` and restarts it.

| Key | Turns on | Where to get it |
|---|---|---|
| `GEMINI_API_KEY` (or `OPENAI_API_KEY` with `LLM_PROVIDER=openai`) | Tour generation, quizzes, podcast scripts. **Required** | Google AI Studio → Get API key |
| `ELEVENLABS_API_KEY` | Podcast audio, and transcription for voice-to-tour | elevenlabs.io → API Keys; allow *Text to Speech* and *Speech to Text* |

1. Paste the value after the `=` in `.env`, with no quotes or spaces.
   An ElevenLabs key starts with `sk_` and is shown only once, when it is created.
   The shorter *key ID* shown in the list afterwards is not the key and is rejected.
2. Restart the server. On start it prints which features are ready:
   ```
   ✓ AI (tours)   Gemini (gemini-flash-latest)
   ✓ Voice tours  ElevenLabs
   ✓ Podcasts     ElevenLabs
   ```
   A feature without its key is listed with the setting it is missing, and the
   extension disables that option and says why.
3. **Docker:** `docker compose` reads the same `.env`, so run
   `docker compose up -d` again to pick up a change. With plain `docker run`, pass each key
   with `-e NAME=value` and recreate the container; a restart keeps the old values.

The server checks that a key is present, not that the provider accepts it. A rejected
key shows up when a podcast or transcription fails; the server log has the provider's
reason.

## Features

- **Code tours** — up to 5 files per tour, turned into steps that highlight the
  relevant lines as you move through them. Guided tours are written by an expert and
  assigned to the learners in a department; exploratory tours are generated on demand
  for yourself, by anyone.
- **Voice to tour** — an expert talks through the code and the transcript steers
  generation.
- **Quizzes** — generated with the tour, editable before publishing, one attempt per
  learner (enforced by the server, not just the UI).
- **Questions** — learners ask on a specific step; experts answer from the dashboard.
- **Podcasts** — an expert/junior dialogue about the code, voiced with ElevenLabs.
- **Dashboard** — per-tour completion, quiz scores, ratings, time spent, feedback,
  and which steps no longer match the code.

The [user manual](docs/user-manual.md) walks through every screen and workflow.

## Development

```bash
cd server && npm run dev      # API with reload
cd dashboard && npm start     # dashboard dev server on :3000
```

When running the dashboard dev server against a separate API, set
`REACT_APP_API_URL=http://localhost:4000`.

Tests run against a throwaway database and a fake LLM, so they need no API keys and
no network:

```bash
cd server && npm test
```

## Authentication

Signing in returns a token. Clients send it as `Authorization: Bearer <token>`, and
the server works out who you are from the token — it never trusts a user id sent in
a request. Tokens last 30 days and are revoked by logging out.

Opening the dashboard from VS Code uses a single-use code valid for five minutes,
which the dashboard immediately swaps for its own token, so no long-lived token ends
up in a URL or browser history.

Who may do what:

- Only experts create guided tours.
- Changing or deleting a tour, its steps, its quiz or the answers to its questions
  requires being the expert who created it.
- Dashboard statistics are for experts only.
- Learners see their own quiz answers, scores and feedback.

Serve Lacy over HTTPS in production: tokens travel in request headers.

## Accounts and teams

There is no public sign-up. Whoever runs the server creates the accounts, which is
usually what you want for a team's internal tool.

**Departments are your teams.** A department is just a label you choose — `Backend`,
`Platform`, `Mobile`, `payments-squad`, whatever fits. An expert writing a guided
tour picks one, and every **learner** with that department is assigned the tour. The
picker in VS Code lists the departments your accounts actually use, so it stays in
step with your team as you add people. Matching ignores case, and a new account
joins an existing department under the spelling already in use, so `backend` and
`Backend` never become two groups.

A typical setup for one team:

```bash
cd server
# the people who write tours
npm run create-user -- --email ada@example.com --password 'secret' --role expert --department Platform
# the people who take them
npm run create-user -- --email lin@example.com --password 'secret' --role learner --department Platform
```

Everyone then sets `lacy.serverUrl` in VS Code to your server and signs in with that
email and password. If you create a tour for a department nobody is in yet, Lacy
tells you rather than silently assigning it to no one.

**Steps follow the code.** A step remembers the lines it was written against, so
when someone opens it on a different branch — or after the file has been edited —
Lacy finds that code by content instead of trusting the old line numbers:

| What happened to the code | What the reader gets |
|---|---|
| Unchanged | Highlighted as written |
| Moved (edits above it, another branch) | Followed to where it is now, with a note |
| Edited in place | Still found, with a note that it no longer matches the description exactly |
| Gone | Told so, instead of a confident highlight of unrelated lines |

Reformatting and re-indentation do not count as changes.

**Tours belong to a repository, not to a folder.** Lacy identifies the open project
by its git remote (`github.com/acme/widgets`), so it does not matter whether one
person cloned it as `widgets` and another as `widgets-fork` — they see the same
tours. A project with no git remote falls back to the folder name, so everyone
working on it needs to use the same folder name.

Roles: **experts** write guided tours and see the dashboard; **learners** take the
tours assigned to their department. Anyone can generate an exploratory tour for
themselves. Note that the dashboard shows every learner on the server, not only
those in the expert's own department.

## Managing accounts

There is no public sign-up: an admin with server access creates accounts, which is
what you want for a team's internal tool. From `server/`:

```bash
npm run create-user -- --email ada@example.com --password 'secret' --role expert --department Backend
npm run users -- list
npm run users -- reset-password --email ada@example.com --password 'new secret'
npm run users -- set-role --email ada@example.com --role learner
npm run users -- delete --email ada@example.com --yes
```

Under Docker, put `docker compose exec lacy node server/scripts/manage-users.js` in
front of the same arguments.

People change their own password through the API:

```
POST /api/change-password   { "current_password": "...", "new_password": "..." }
```



## Status and limitations

- Tour generation sends the contents of the selected files to your configured LLM
  provider. Point `LLM_PROVIDER` at a self-hosted endpoint if that matters to you.
- A tour written for one branch can still go stale: Lacy re-finds moved code, but
  it cannot know that a rewritten function needs a new explanation.
- Account management is CLI and API only — there is no admin screen, no invites and
  no password-reset email flow (an admin resets passwords).
- Everyone on one server shares one pool of accounts and one dashboard, so it suits
  a single team or a group that is happy to see each other's progress.
- Backing up means the database file **and** `AUDIO_DIR`.

## Credits

Lacy was built by **Architexts**. The research version it grew out of was released as
a replication package on [figshare](https://figshare.com/s/6a261d3382b116d8494f);
`CHANGELOG.md` lists what changed since.

## License

Lacy is open source under the [MIT License](LICENSE). Copyright Architexts.

To report a security problem, see [SECURITY.md](SECURITY.md).
