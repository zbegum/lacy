# Changelog

All notable changes to Lacy are documented here, following
[Keep a Changelog](http://keepachangelog.com/).

## [2.1.0] - 2026-11-13

Lacy is now open source under the MIT License.

### Added

- Podcasts follow the code: the player shows the conversation as chat bubbles,
  plays from any line, and brings each file forward with its steps highlighted
  as the speakers name it. A podcast without audio says so inside the player.
- The tour form only offers a podcast when the server can make one, and says
  which key is missing when it cannot.
- The dashboard is a set of regular desktop pages: sortable learner and tour
  lists, a page per tour and per learner, and charts on Tour Statistics.
- An API keys section in the README, and a SECURITY.md.

### Changed

- Voice tours: Next: Record starts recording straight away, and listening back
  plays the whole recording rather than only its last minute.
- Finished tours are tinted green in the list instead of carrying a chip.

### Fixed

- The sidebar could open blank (the published 2.0.0 has this bug).
- Finish Quiz graded again on every click; it now grades once and moves on.
- Completing a tour flashed the quiz editor before the quiz.
- "Have a question?" needed two clicks to open.
- Recording without SoX installed sent empty audio and failed later with
  "No audio received"; Lacy now says what to install. A short recording could
  also report that nothing was recorded.
- Podcast audio is revalidated, so a remade podcast never plays old clips.
- Dashboard statistics counted the wrong things in several places.
- Security updates for the server's dependencies (body-parser, qs, grpc-js) and
  react-router-dom.

## [2.0.0] - 2026-09-17

Lacy v2: the research prototype rebuilt as a tool any team can run for itself.

v1 was the version used in the pilot study — tied to one company's environment,
SQL Server and internal LLM gateway, with credentials and URLs written into the
source. v2 is a single Node server with SQLite, a configurable LLM provider,
token authentication and a Docker setup, plus a long list of fixes to features
that did not survive contact with the audit.

### Added

- Tour steps remember the code they point at and are re-found by content when
  opened, so a step still highlights the right lines after the file has been edited
  or on a different branch. Code that moved is followed, code edited in place is
  still found and flagged as no longer matching the description, and code that is
  gone is reported instead of highlighting whatever now occupies those lines.
- Tours are scoped by the project's git remote instead of the name of the folder
  open in VS Code, so people who cloned the same repository into differently named
  directories now see each other's tours. Projects without a remote still fall back
  to the folder name, and tours created before this keep working.
- Teams pick their own departments: the "target department" picker in VS Code is
  filled from the departments your accounts actually use, instead of a hardcoded
  Backend/Frontend/QA/DevOps list that made any other team name unusable.
- Creating a guided tour reports how many learners it was assigned to, and the
  sidebar warns when that is none.
- `npm run backup` takes a consistent copy of the database and the podcast audio
  while the server keeps running.
- Deleting an account that owns tours now requires either handing them over
  (`--reassign-to`) or saying explicitly that they should go too (`--force`), plus a
  `transfer-tours` command. Deleting the expert who wrote a team's onboarding tours
  used to take those tours with them, silently.
- Account management: `npm run users -- list | reset-password | set-role | delete`,
  and `POST /api/change-password` so people can change their own password.
- Podcast audio is written to `AUDIO_DIR` instead of into the database, so the
  SQLite file no longer grows by megabytes per podcast. Audio written by an earlier
  version is moved to disk the first time it is played, and deleting a tour deletes
  its audio.
- jsdom tests for the sidebar's shared webview code, run by `npm test` at the root
  along with the server suite (49 tests in total).
- Installable artifacts: every tagged release publishes a `.vsix` for VS Code and a
  server image to the GitHub container registry, so using Lacy no longer means
  cloning it. [INSTALL.md](INSTALL.md) covers both.
- CI runs the tests, builds the dashboard, packages the extension and checks that the
  server image starts and answers, on every push.
- A written [user manual](docs/user-manual.md) covering every screen and workflow,
  replacing the PDF that documented the old company deployment.
- The dashboard shows which steps of a tour no longer match the code, reported by
  the extension as people take the tour, so an expert knows what needs rewriting.
- Token authentication. Login returns a bearer token; the server identifies the
  caller from that token instead of a client-supplied `user_id`. Tours, steps and
  quizzes can only be changed by the expert who created them, dashboard statistics
  require an expert account, and logging out revokes the token.
- A single-use, five-minute handoff code for opening the dashboard in a browser from
  VS Code, so no long-lived token appears in a URL.
- SQLite storage through Knex, created by migrations on first start: no database
  server to install, and the whole dataset is one file to back up.
- `lacy.serverUrl` setting, so the extension can talk to a server anywhere.
- `npm run create-user` for creating expert and learner accounts.
- Dockerfile and Compose file that build and run the server with the dashboard.
- API tests covering tours, quizzes, feedback and dashboard statistics, using a fake
  LLM so they run offline.
- `voice_tour_segments` table, which the podcast feature wrote to but never existed.
- `GET /api/get-tour-step-by-id` and `PATCH /api/edit-tour-step-description/:id`,
  both of which clients called but the server never implemented.

### Changed

- The sign-in form asks for the server address, so each person points their editor
  at their team's Lacy server without editing settings JSON. The address is checked
  before the credentials are, so an unreachable server no longer looks like a wrong
  password, and **Lacy: Set Server URL** changes it later.

- The panel follows your VS Code theme. Backgrounds, text and borders come from the
  theme's own colours, so Lacy no longer renders as a dark rectangle inside a light
  editor; the purple accent stays Lacy's in every theme.
- Fonts (Poppins and Aldrich) and the four icons are bundled with the extension
  instead of being fetched from Google Fonts and a CDN at runtime. Poppins was
  specified 52 times and never actually loaded, so the UI had been falling back to
  the system font; the dashboard loaded no webfont at all. Lacy now also works
  offline and makes no third-party requests.
- One set of design tokens across the panel and the dashboard: 33 font sizes became
  6, 31 spacing values became 6, and the structural colours are shared rather than
  168 separate hex values.

- Voice-to-tour records through VS Code itself instead of requiring the SoX
  command-line tool. SoX is now only a fallback for when microphone access in the
  panel is refused, so experts no longer have to install anything to record.

- The PHP dashboard backend was ported into the Node server. One process now serves
  the API and the built dashboard; PHP is no longer needed.
- LLM access goes through a provider interface: Gemini, or any OpenAI-compatible
  endpoint. The internal company-gateway integration is gone, as is the model
  dropdown's list of models that silently fell back to Gemini.
- Speech-to-text moved to the server, so the extension no longer needs Google
  credentials on each developer's machine.
- Passwords are stored as bcrypt hashes and never returned by the API.
- The extension sends the contents of selected files with a tour request, so the
  server no longer reads the developer's disk. Disk reads are opt-in via
  `ALLOW_LOCAL_FILE_ACCESS` for same-machine setups.
- All configuration (API keys, database, provider choice) comes from the
  environment; no keys or URLs are written into the source.
- Guided tours are assigned to *learners* in the target department only. Previously
  the expert who created the tour was assigned it too, which skewed completion stats.
- A tour is only saved once generation succeeds, instead of leaving half-created
  tours behind when the LLM fails.

### Fixed

Found by a feature-by-feature audit of the UI against the API:

- A failed tour creation left the "Creating your tour…" overlay up with every button
  disabled, so the sidebar was unusable until the window was reloaded.
- The audio tab reused the guided tour form's element ids and overwrote two of its
  functions, so selecting files for a tour updated the audio tab's selection instead.
- Quiz questions of type "text" always scored 0: the scorer only read selected
  options and never the typed answer.
- "Finish Quiz" did nothing on the first click; it registered a listener during the
  click it was handling, so the learner never reached the feedback page.
- Podcast playback always failed: an `<audio>` element cannot send the session token,
  so every segment came back 401. Segments are fetched and played as blobs now.
- A tour whose podcast failed to synthesise still showed a headphones button, then an
  empty player with a back button that threw and trapped the user.
- Voice-to-tour always failed: starting a recording reset the project base path to
  the project folder itself, so no file could be read afterwards — and the failure
  was silent, leaving a spinner running.
- The last line of a step was never highlighted (off-by-one range).
- A step pointing at a renamed or deleted file silently froze the tour.
- A failed question submission appended "Q: undefined" to the learner's list.
- A failed feedback submission could never be retried, because the tour start time
  was cleared before the request; the form also allowed double submission.
- The tour info popup could not be closed if the tour had no steps.
- The expert dashboard's Logout link went to a route that does not exist and left
  the session valid; it now revokes the token.
- The dashboard showed every feedback as "Anonymous" and left learner and expert
  names blank (it read fields the API does not return).
- A deleted or unknown tour left the dashboard on "Loading tour details…" forever,
  and a 401/403 rendered an empty dashboard with no explanation.
- Answering a question reported success even when the write failed, and any expert
  could answer questions on another expert's tour.
- Deleting a step of an unsaved manual tour deleted an unrelated step.
- The quiz editor lowercased everything typed into options and answers.
- Dashboard tables showed "Page 1 of 0" with Next enabled.
- Department matching ignores case, and a new account joins an existing department
  under the spelling already in use. Creating someone as `backend` when the tours
  target `Backend` used to mean they silently received nothing.
- Tour step paths are now stored with forward slashes whatever the client's
  platform, so tours created on Windows open correctly on macOS and Linux (and the
  reverse). The server no longer applies its own platform's path rules to paths that
  came from a client.
- A relative `DB_FILE` is resolved from the repository root instead of the current
  working directory, so starting the server from a different folder no longer
  creates a second, empty database.
- The extension's login sent `user.mail`, which is always undefined, as the signed-in
  user's email.
- Creating a tour with the "Medium" knowledge level crashed the prompt builder.
- `GET /api/get-tour-steps-by-id` ran invalid SQL and could never return a step.
- `POST /api/transcribe-audio` referenced an undefined variable and never responded;
  transcription now goes through `POST /api/transcribe`.
- Removed a hardcoded path to one developer's home directory in the audio handler.

### Removed

- Invented benchmark numbers ("Team Avg 72%", "Global Avg 65") that the dashboard
  displayed next to real measurements as if they had been measured.
- Dead UI code found in the audit: an in-webview recorder that posted a message
  nothing handled, a manual-tour modal that was never shown, a file-preview panel
  that was never rendered, a chat panel script that was never loaded, and a script
  file whose entire contents were commented out.
- The PHP backend (`web/backend`), the `dev-runner` helper, and the sample "Hello
  World" command.
- The internal-gateway and LLaMA entries in the model dropdown; models are now
  "server default", Gemini, or an OpenAI-compatible endpoint.
- 46 generated sample podcast MP3s (20 MB), which remain in the figshare package.
