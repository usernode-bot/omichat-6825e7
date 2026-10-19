# Omichat — notes for Claude Code

This app runs on **Homeroom**. If you're Claude Code
editing this repo, read the platform conventions before making
changes:

**Platform conventions (authoritative, always current):**
https://app.onhomeroom.com/claude.md

Fetch that URL at the start of each session — it's the single source
of truth for platform-wide behavior (auth model, `USERNODE_ENV`,
public/private tables, "don't `git push`", etc.). The hosted copy is
updated in place when platform rules change, so fetching it gives you
today's rules, not a stale snapshot.

When running inside Homeroom's dev-chat, those same conventions are
already injected into your system prompt, so the fetch is a no-op in
that path — but it's the right reflex when someone runs Claude Code
against this repo locally or from another harness.

## Connector permission prompts

This repo ships `.claude/settings.json`, which allows the **read-only**
Homeroom connector calls (`mcp__homeroom__get_*`,
`…__list_*`, `…__whoami`) so they stop prompting one at a time. Everything
that acts — filing a request, opening or advancing a proposal — still asks.
Claude Code applies those rules only after you accept the
workspace trust dialog, which lists them for review. See `.claude/README.md`
for the whole story, including what to do if you are still being prompted
(usually: your connector is registered under a different name than the rules
assume).

## Check that this checkout is current

You may be working in a fork of this app whose `main` is behind the app's
canonical repository, and nothing in the checkout says so: `git fetch origin`
compares the fork with itself. This matters before you **read** code to answer
a question about how the app behaves now, not only before you edit it.

The canonical repository is named in `.claude/homeroom-canonical-repo`. Check against
it, not against `origin`:

```sh
git fetch "$(cat .claude/homeroom-canonical-repo)" main
git merge-base --is-ancestor FETCH_HEAD HEAD && echo current || echo behind
```

`behind` means this checkout does not contain the canonical `main`. To answer
a question, read the canonical code instead (`git show FETCH_HEAD:<path>`,
`git grep <pattern> FETCH_HEAD`). To change code, start from the exact base
commit your Homeroom work order gives, and never merge or rebase onto the
canonical `main` yourself: which commit a change is diffed against decides
what the group votes on. With the Homeroom connector, `get_checkout_status`
answers the same question.

A session-start hook (`.claude/hooks/homeroom-freshness.sh`, see `.claude/README.md`) runs
this check for you and tells you when you are behind. It is silent offline, so
its silence is not proof the checkout is current. Inside Homeroom's dev-chat
the platform fixes the base commit, and none of this applies.

## Starter template

The screen this app currently ships — the hero, the "What's already
working" card, and the Press! example (the demo markup in
`public/index.html`, the `/api/press` and `/api/leaderboard` routes, and
the `presses` table bootstrap in `server.js`) — is placeholder content
from the Homeroom starter template, not product intent.

When the user asks for their first real feature, REPLACE the template
screen rather than building alongside it:

- remove the `usernode-starter-notice@1` block in `public/index.html`
  (both sentinel comments and everything between them),
- remove or repurpose the "Try the example" card, its demo endpoints and
  the `presses` table as appropriate,
- rewrite `README.md` to describe the actual app.

Keep the `usernode-dev-console@1` forwarder `<script>` when rewriting the
HTML — that block is platform infrastructure, not template content.

If a rule below this line conflicts with the hosted conventions, the
hosted conventions win. This file is **app-specific** — write down
things about *this* app that belong in the repo: product intent,
data-model quirks, style preferences, opt-in policies (e.g. which
tables you've marked private), etc.

---

## About Omichat

Omichat is a mobile-first, swipe-based way to meet people nearby who share
your interests: friends, activity partners, study buddies and hobby groups.
It is not a dating app, and must not grow romantic or dating framing
(Homeroom's content rules forbid dating features). The Discover deck has two
actions, Skip (swipe left) and Say hi (swipe right); people you say hi to are
listed under Hellos, and mutual hellos will become Connections. Tapping a
card opens the full profile (`#discover/<id>`), with Skip and Say hi kept at
the bottom.

Discover profiles are still mock data, and swipes and hellos are in-memory
session state. Persisted, per-account features: verification
(`user_verification`) and the viewer's own profile (`profiles`, edited at
`#profile/edit`).

## App-specific conventions

- Words: Skip, Say hi, Hellos, Connections. Never Like, Pass, Super Like or
  Match. Old `#likes` / `#matches` links redirect to `#hellos` /
  `#connections`.
- Original branding only: sky-to-indigo accent on a zinc-950 dark ground
  (adopted in the "Color where" theme change; was fuchsia-to-violet),
  Lucide-style stroke icons, system font. Nothing borrowed from existing
  social apps. One fixed dark look.
- Message-list colour coding: a sender's colour is the first stop of their
  photo gradient (`profile.accent` in `mock-data.js`). It colours the
  thread's avatar ring, name and unread dot; message kinds are styled
  separately (your messages get the sky "You:" prefix, a hi carries a wave
  mark, connection notices carry a sparkle mark).
- Profile "photos" for mock people are generated SVG data URIs from
  `mock-data.js`, never remote images, so the deck works offline and in
  proposal checks. The viewer's own photos are uploaded with
  `usernode.uploadFile` (downscaled to 1280px JPEG first); `profiles.data`
  stores only `{ id, url }` per photo.
- `public/js/profile-schema.js` is the single source for the interest list,
  the prompts, "Looking for" options, the languages list, field limits,
  validation and the completeness score. The page loads it and `server.js`
  requires it, so the client and the server validate the same way. Add
  interests, prompts or languages there only.
- `profiles` is marked `staging:private` (jobs, education and social
  handles are personal information). Nothing is seeded for it: an empty
  profile is the real first-run state, and the completeness hints start
  from there.
- Discovery filters (age range, max distance, online now, Looking for,
  interests, languages) open from the pill above the Discover deck or the
  header sliders button, and live-filter the deck. The rules live in
  `public/js/discovery-filters.js` (`window.OmichatFilters`); choices persist
  to localStorage under `omichat.filters`. A profile missing the field a
  filter is set on shows only while that filter is unset; the deck never
  guesses a value for missing data. Two sparse mock profiles (`Sasha`,
  `Milo`) exercise this and the full profile's empty states.
- Safety and Trust lives behind one service layer, `public/js/safety.js`
  (reports, blocks, selfie verification, privacy, age gate); UI is
  `safety-ui.js`. Reports, blocks and privacy settings are saved per account
  (`createServerServices`, routes under `/api/safety`, `/api/blocks`,
  `/api/reports`, `/api/privacy` in `server.js`), in the `staging:private`
  tables `blocks`, `reports` and `privacy_settings`. Without a database the
  page keeps the localStorage mock (`createMockServices`); anything an older
  version stored on the device is copied to the account once. Selfie
  verification and the age gate are still device-only. The privacy, report
  and block rules (`validatePrivacy`, `canMessage`, `canSeeProfile`,
  `presenceVisible`, `validateReport`) are shared by the page and the server.
  Block and report targets are keys: `mock:<id>` for sample profiles,
  `user:<platform id>` for real accounts. Online status is reciprocal: with
  "Show my online status" off you also see nobody else's. Blocks are
  permanent (no unblock). Reports are reviewed by project members (platform
  `GET /members`) in the Reports to review card. The age gate stores only the
  pass/blocked result, never the date of birth. Tests: `npm test`.
- Keep the frontend component-based (`public/js/components.js`,
  `profile-view.js`, `profile-edit.js`); no framework, no new dependencies.
