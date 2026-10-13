# Omichat

A mobile-first, swipe-based way to meet people nearby who share your
interests (friends, activity partners, study buddies, hobby groups),
running on Homeroom.

- **Discover**: a swipeable deck of (mock) profiles. Swipe right or tap the
  wave to Say hi, swipe left or tap the cross to Skip. Each card shows how
  many interests you have in common. Tap the card's details to open the
  **full profile**: a swipeable gallery of up to 6 photos, bio, prompts,
  what they are looking for, job, education, interests (shared ones
  highlighted) and their Instagram or Spotify when they added one, with
  Skip and Say hi at the bottom.
- **Hellos**: everyone you said hi to this session, with an undo.
- **Connections**: an empty state until mutual hellos arrive.
- **Messages**: mock threads, colour-coded by sender. Chat arrives later.
- **Profile**: your own profile with a completeness meter and hints for
  what to add next, **Edit profile** (photos with compression and an upload
  state, reorder and delete; name, age, bio, "Looking for", job, education,
  up to 8 interests from a list, up to 3 prompts, optional Instagram and
  Spotify), a preview of how others see you, and account verification.

Your profile and verification are stored server-side per Homeroom account
(`profiles` and `user_verification`, both `staging:private`). Photos are
stored by the platform's file storage; the app keeps only their URLs.
Swipes and hellos are still in-memory and reset on reload.

## Brand assets

`brand/` holds the Omichat icon (two overlapping speech bubbles forming a
rounded "O", in Homeroom brand colours) and its sources: `icon.png` is the
home-screen tile declared in `dapp.json`, `featured-light.png` and
`featured-dark.png` are the directory featured images. The SVGs are the
sources; see `brand/ICON.md` for colours, geometry and how to re-render.

## Run locally

```sh
npm install
npm run build   # compiles styles/tailwind-input.css to public/tailwind.css
npm start       # node server.js on :3000
```

The platform injects `DATABASE_URL`, `PORT`, `USERNODE_JWT_PUBLIC_KEY`,
`USERNODE_APP_ID` and `USERNODE_ENV`; a plain `node server.js` without them
serves the app with the auth gate closed (static assets only).
