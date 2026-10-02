# Omichat

A mobile-first, swipe-based dating app running on Homeroom.

Phase 1 is the client-side experience, running entirely on mock data:

- **Discover** — a swipeable deck of profiles. Drag a card right to Like,
  left to Pass, or up to Super Like, or use the action buttons below the
  card. Tap the photo (left third, right third, or the dots at the top) to
  browse a profile's photos.
- **Likes** — everyone you Liked this session, with an undo.
- **Matches / Messages** — tabs with empty states until matching and chat
  arrive in later phases.
- **Profile** — your mock profile and session stats.

There is no backend logic, matching or payments yet. Swipes and likes are
in-memory only and reset on reload.

## Run locally

```sh
npm install
npm run build   # compiles styles/tailwind-input.css to public/tailwind.css
npm start       # node server.js on :3000
```

The platform injects `DATABASE_URL`, `PORT`, `USERNODE_JWT_PUBLIC_KEY`,
`USERNODE_APP_ID` and `USERNODE_ENV`; a plain `node server.js` without them
serves the app with the auth gate closed (static assets only).
