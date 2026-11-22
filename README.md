# Play.Hosting Minecraft Player Bot Dashboard

A web dashboard for connecting Mineflayer Java Edition bots to Minecraft servers where automated clients are permitted. Includes chat, owner commands, schematic-based building, connection logs and player monitoring. All Gemini/AI integration has been removed.

## Important hosting note

Use this bot only where the server and hosting rules allow automated clients. Start your Minecraft server normally through its hosting panel, then press **Connect bot** in this dashboard. This project has no AFK movement, automatic reconnect loop, or automatic server-start feature.

## Requirements

- Node.js 20+
- A Minecraft Java Edition server address and port
- A server version supported by Mineflayer
- A bot account appropriate for the server authentication mode

Mineflayer is a Java Edition client. Bedrock-only servers are not supported directly.

## Run locally

1. Copy `.env.example` to `.env` and set `ADMIN_USER` and `ADMIN_PASSWORD` (at least 12 characters). No `SECRET` variable is needed; the app generates a fresh session-signing secret each time it starts.
2. Install dependencies with `npm install`.
3. Start with `npm start`.
4. Open `http://localhost:3000` and sign in with the dashboard credentials.
5. Add the server host, port, Minecraft username, optional version, owner username and authentication mode.
6. Start the Minecraft server through its official panel, then connect the bot from this dashboard.

For Microsoft authentication, choose **Microsoft account**. Mineflayer may print a device sign-in URL and code in the server logs during first login. Never share that code or account credentials.

## Deploy

Set `ADMIN_USER` and `ADMIN_PASSWORD` as environment variables in your hosting provider. The app generates its own temporary session-signing secret at startup; dashboard sessions expire after a restart or redeploy. Use the dashboard username and password supplied privately by the owner; do not put them in source files or commit them to GitHub. Persist `/data` (or set `DATA_DIR` to a persistent volume) so server profiles survive redeploys.

## Features

- Multiple saved bot profiles
- Manual connect/disconnect
- Live connection and chat logs
- Online player count, health, food and position
- Owner-only in-game commands
- Schematic upload and building (`.schem`, `.schematic`, `.nbt`)
- Offline-mode or Microsoft authentication selection

## Notes

- Mineflayer does not provide a full modded Java client. Some modded servers may reject it.
- Offline authentication works only when the target server accepts offline-mode clients.
- Use Microsoft authentication for servers requiring authenticated Java accounts.
- Do not use this software to evade server rules, inactivity limits, queues, anti-cheat or access controls.
