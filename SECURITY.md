# Security

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately
through GitHub instead: on this repository, open **Security → Report a
vulnerability**. Include what you found, how to reproduce it, and which version
you are running.

You should hear back within a week. Once a fix is released, the advisory is
published with credit to you, unless you would rather stay anonymous.

## Supported versions

Only the latest release gets security fixes.

## Running Lacy safely

- Keep API keys in the server's `.env` only; the extension never needs them.
- Set `CORS_ORIGIN` to your dashboard's address instead of `*` on a shared host.
- Leave `ALLOW_LOCAL_FILE_ACCESS` off unless the server runs on the same machine
  as the editor.
- Put the server behind HTTPS when it is reachable from outside your network.
