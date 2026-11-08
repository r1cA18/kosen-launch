# Deployment (homelab + Cloudflare Tunnel)

Kosen Launch runs as a Bun process with SQLite and local files, so it is published from a host through Cloudflare Tunnel instead of Cloudflare Workers. No inbound port is opened.

## 1. App

```sh
git clone https://github.com/r1cA18/kosen-launch.git ~/kosen-launch
cd ~/kosen-launch
bun install --frozen-lockfile
bun run build
```

Create `~/.config/kosen-launch/env` with mode 600:

```sh
HOST=127.0.0.1
PORT=4180
APP_ORIGIN=https://kosen-launch.r1ca18.dev
DATABASE_PATH=/home/<user>/.local/share/kosen-launch/kosen-launch.sqlite
ASSET_DIRECTORY=/home/<user>/.local/share/kosen-launch/assets
DISCOVERY_DAILY_LIMIT=30
REGISTRATION_CODE=<random invite code>
ANTHROPIC_API_KEY=<your key>
```

Install `deploy/kosen-launch.service` as a systemd user unit (replace `@ROOT@` and `@CONFIG@`), then `systemctl --user enable --now kosen-launch` and `loginctl enable-linger $USER`.

## 2. Tunnel

```sh
cloudflared tunnel login
cloudflared tunnel create kosen-launch
cloudflared tunnel route dns kosen-launch kosen-launch.r1ca18.dev
```

Write `~/.cloudflared/config.yml` from `deploy/cloudflared.yml` and run `cloudflared tunnel run kosen-launch`, then install it as a service.

## Security settings in production

- `APP_ORIGIN` is the HTTPS origin, so cookies are `Secure` and HSTS is sent
- Registration requires `REGISTRATION_CODE`; give the code only to judges and testers
- `DISCOVERY_DAILY_LIMIT` caps automatic Claude API event searches per day for the whole server
- The UI editor is never enabled outside loopback development
- The API key lives only in the env file; it is not in the repository or logs
- Claude connectors reach `/mcp`, `/.well-known/*` and `/oauth/*` through the tunnel; the tunnel must preserve the Host header
