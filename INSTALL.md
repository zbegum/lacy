# Installing Lacy

Lacy has two pieces:

- a **server** that one person in the team runs, which holds the tours and talks to
  the AI provider;
- a **VS Code extension** that everyone installs.

Nobody except the person setting up the server needs to clone anything.

---

## Part 1 — the server (one person, once)

### What you need

- A machine the team can reach: a laptop for trying it out, a small VM for real use.
- **Docker**, or Node.js 20+ if you would rather not use Docker.
- An **API key** for the AI that writes the tours: a Google
  [Gemini key](https://aistudio.google.com/apikey), or an OpenAI-compatible endpoint
  (including one you host yourself).
- Optional: an [ElevenLabs](https://elevenlabs.io) key, only for podcasts.

No database to install — Lacy keeps everything in one file.

### Run it

```bash
docker run -d --name lacy \
  -p 4000:4000 \
  -v lacy-data:/data \
  -e GEMINI_API_KEY=your-key-here \
  ghcr.io/zbegum/lacy:latest
```

Check it came up:

```bash
curl http://localhost:4000/api/health      # {"status":"ok", ...}
docker logs lacy                           # what is set up, see below
```

On start, the server prints what it can do, so a missing key is obvious:

```
Lacy is listening on http://0.0.0.0:4000
  ✓ AI (tours)   Gemini (gemini-flash-latest)
  – Voice tours  ELEVENLABS_API_KEY is not set (optional)
  – Podcasts     ELEVENLABS_API_KEY is not set (optional)
```

The keys live only on the server. Experts and learners never enter one; if
someone uses a feature whose key is missing, Lacy tells them to ask you and names
the setting to add.

### Create the accounts

Experts write tours; learners take them. People in the same **department** get the
same guided tours — the department is just a label you choose.

```bash
docker exec lacy node server/scripts/create-user.js \
  --email ada@example.com --password 'a good password' --role expert --department Platform

docker exec lacy node server/scripts/create-user.js \
  --email lin@example.com --password 'a good password' --role learner --department Platform
```

Later: `docker exec lacy node server/scripts/manage-users.js list` (also
`reset-password`, `set-role`, `transfer-tours`, `delete`).

### Tell people the address

Everyone needs the server's URL — `http://your-machine:4000`. On a shared network,
put it behind a reverse proxy with HTTPS: sign-in tokens travel in request headers.

### Hosting it for a team

`localhost` is only for trying Lacy on your own machine. For a team, run the same
server somewhere everyone can reach and give them that address. Whatever you pick,
it needs three things:

- **A persistent disk mounted at `/data`.** The database and podcast audio live
  there. Without it, every redeploy wipes the team's tours.
- **Your API keys as environment variables** (`GEMINI_API_KEY`, and
  `ELEVENLABS_API_KEY` for podcasts). See [`.env.example`](.env.example) for the rest.
- **HTTPS.** The hosted platforms below give you this for free; on a VM, see below.

Once it is up, set `CORS_ORIGIN` to the server's own address
(e.g. `https://lacy.example.com`) rather than `*`.

#### Railway

1. **New Project ▸ Deploy from GitHub repo** and pick your copy of Lacy. Railway
   finds the `Dockerfile` and builds it. (Or **Deploy a Docker Image** with
   `ghcr.io/zbegum/lacy:latest`.)
2. On the service, **right-click ▸ Attach Volume** and set the mount path to `/data`.
3. **Variables**: add `GEMINI_API_KEY` (and `ELEVENLABS_API_KEY` if you want
   podcasts). Leave `PORT` alone — Railway sets it and Lacy uses it.
4. **Settings ▸ Networking ▸ Generate Domain.** That `https://….up.railway.app`
   address is what the team types into the sign-in form.
5. Create accounts from your machine with the [Railway CLI](https://docs.railway.com/guides/cli):

   ```bash
   railway ssh -- node server/scripts/create-user.js \
     --email ada@example.com --password 'a good password' --role expert --department Platform
   ```

Updating: push to the repo (or redeploy the image). The volume keeps your data.

#### Render

1. **New ▸ Web Service**, connect your copy of the repo; Render detects the
   `Dockerfile`. Choose a paid instance type — persistent disks are not available
   on the free tier.
2. **Advanced ▸ Add Disk**, mount path `/data`.
3. **Environment**: add `GEMINI_API_KEY` (and `ELEVENLABS_API_KEY`).
4. **Health Check Path**: `/api/health`.
5. Your address is the `https://….onrender.com` URL. Create accounts from the
   service's **Shell** tab with `node server/scripts/create-user.js …` as above.

#### A VM (Hetzner, DigitalOcean, AWS, a company machine)

Install Docker, start Lacy with the `docker run` line above, then put
[Caddy](https://caddyserver.com) in front of it for HTTPS. Point a domain at the
machine and run:

```bash
docker run -d --name caddy --network host -v caddy-data:/data caddy:2 \
  caddy reverse-proxy --from lacy.example.com --to localhost:4000
```

Caddy gets and renews the certificate itself. Close port 4000 in the firewall so
everything goes through HTTPS, and create accounts with the `docker exec` commands
below.

### The data, and backing it up

Everything lives on the server: tours, accounts, quiz results, questions and podcast
audio. Nobody on the team installs a database or holds a copy — their VS Code just
talks to your server. That also means **this one machine is the only place the team's
tours exist**, so back it up.

```bash
docker exec lacy node server/scripts/backup.js --out /data/backups
docker cp lacy:/data/backups ./lacy-backups      # copy them off the machine
```

That writes a dated folder containing `lacy.sqlite` and the podcast `audio/`. It is
safe to run while the server is in use — it asks SQLite for a consistent copy rather
than copying a file that is being written to. A weekly cron entry is enough for most
teams.

To restore: stop the server, put `lacy.sqlite` back at `DB_FILE` and `audio/` at
`AUDIO_DIR`, start it again.

### When someone leaves

Tours belong to the account that wrote them, so deleting that account deletes its
tours and everyone's progress on them. Hand them over instead:

```bash
docker exec lacy node server/scripts/manage-users.js delete \
  --email ada@example.com --reassign-to sam@example.com --yes
```

The command refuses to delete an account that still owns tours unless you either
reassign them or pass `--force`.

### Updating

```bash
docker pull ghcr.io/zbegum/lacy:latest
docker rm -f lacy && docker run -d --name lacy -p 4000:4000 -v lacy-data:/data \
  -e GEMINI_API_KEY=your-key-here ghcr.io/zbegum/lacy:latest
```

Your data stays on the volume, and any database changes are applied on start.

### Without Docker

```bash
git clone https://github.com/zbegum/lacy.git && cd lacy
cp .env.example .env            # add your API key
cd dashboard && npm ci && npm run build && cd ..
cd server && npm ci && npm start
```

---

## Part 2 — the extension (everyone)

1. Download **`lacy-vX.Y.Z.vsix`** from the
   [latest release](https://github.com/zbegum/lacy/releases/latest).
2. In VS Code: **Extensions** (`⇧⌘X` / `Ctrl+Shift+X`) **▸ ⋯ ▸ Install from VSIX…**,
   and pick the file.
3. Open the project you want tours for (**File ▸ Open Folder**), click the **Lacy**
   icon in the activity bar, and sign in: the form asks for the **server address**
   (`http://your-machine:4000`) along with the email and password you were given.
   The address is remembered, and can be changed later with **Lacy: Set Server URL**
   from the command palette.

That's it. The [user manual](docs/user-manual.md) covers what to do next.

---

## Optional extras

| Feature | Needs |
|---|---|
| Podcasts | `ELEVENLABS_API_KEY` on the server |
| Voice-to-tour | Nothing — VS Code records it. If it refuses microphone access, install [SoX](https://sox.sourceforge.net) and Lacy falls back to that |
| A different AI provider | `LLM_PROVIDER=openai` plus `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL` — works with anything that speaks the OpenAI chat API, including a model you host yourself |

Every setting is listed in [`.env.example`](.env.example).

## If something does not work

| Symptom | Cause |
|---|---|
| Sidebar cannot reach anything | The server is not running, or the Server URL setting is wrong. Open `http://your-server:4000/api/health` in a browser |
| "See Dashboard" does nothing | Only expert accounts can open it |
| "This Lacy server has no AI set up yet" | The server has no `GEMINI_API_KEY` (or OpenAI settings). Add it and restart; the startup lines show ✓ when it is picked up |
| Tour generation fails for another reason | The key was rejected, or the selected files are too large for the model |
| The Lacy icon disappears when you switch views | It is unpinned. Open Lacy, right-click its icon in the activity bar, **Pin** |
| A tour is assigned to nobody | Nobody has that department yet, or they are all experts — only learners get tours |

More in the [manual's troubleshooting section](docs/user-manual.md#14-when-something-goes-wrong).
