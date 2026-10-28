# Dilemma

International AI-powered Discord quiz bot.

Dilemma lets Discord communities configure quiz topics and schedules, then answer AI-generated multiple-choice questions in native Discord single-choice polls. Members can withdraw or change their answer until the poll closes.

## Current status

Code version: `v3.3.4`, with a 1460-question duplicate-check window for each server's random quizzes, recorded quiz closers and automatic result delivery. Saved topics keep their 365-question comparison window and the server limit remains 31 saved topics, including disabled topics. See [CHANGELOG.md](CHANGELOG.md). Upgrading from v3.3.3 requires no database migration or command registration. Earlier upgrades must include the preceding migrations and command registration described below. `clear_ping` is available only when configuring an existing topic.

Version v3.0.2 strengthens question-writing instructions against unintended hints and removes duplicate shared prompt text. The model, request limits and custom answer order are unchanged. No database migration or command re-registration is required when upgrading from v3.0.1.

Version v3.0.1 renames the Polish quiz-closing button to `Zakończ quiz` and corrects documentation. No database migration or command re-registration is required when upgrading from v3.0.0.

Version v3.0.0 replaces `/dilemma defaults` with `/dilemma timezone`. Set topic options in `create` or `configure`; use `timezone` to select this server's IANA timezone for publication dates, schedules and daily limits. Apply the additive `20261022190000_guild_timezone` migration before starting this code, then re-register commands. Existing data and saved clock times remain unchanged; the optional `QUIZ_TIMEZONE` deployment value remains a fallback until a server selects its own zone.

Version v2.0.0 also adds delegated management roles. Apply the additive `20261022160000_manager_role` migration and re-register commands before using this feature. Existing servers keep administrator-only management until a role is explicitly selected.

Version v2.0.0 migrates quiz generation to OpenAI directly. This is a breaking configuration change: provision `OPENAI_API_KEY` and replace the old provider settings using `.env.example`. Inference is paid; the default model is `gpt-6-luna`, with strict JSON output, low reasoning effort and bounded output/retries. Quiz schedules, points, EXP, levels, rankings, achievements and six-language feedback remain unchanged. Upgrading from v1.0.1 requires the management-role migration and command registration refresh noted above. Older deployments must also apply the earlier migrations described below. Stable release status does not guarantee external AI availability or factual accuracy.

- TypeScript + Node.js 22
- Discord bot with all commands under `/dilemma`
- AI-generated questions, options, facts and context-aware emoji
- Direct OpenAI Responses API generation with strict JSON output and bounded token usage
- AI-generated topic answers and optional custom answers for on-demand random quizzes
- Topic intervals, one question per run, configurable poll duration, fixed generation time and optional first publication date
- Automatic scheduled generation
- Immediate poll closing with correct answer and fact
- SQLite + Prisma persistence for local development
- PostgreSQL + Neon persistence for production
- Server language onboarding when bot joins a guild
- Easy, medium and hard question difficulty for random quizzes, saved topics and scheduled generation
- Localized help and Dilemma-style command feedback in English, Polish, German, Spanish, French and Japanese
- Server-specific points, answer accuracy, correct-answer streaks and leaderboards
- Server-specific cosmetic achievements and up to three selected profile badge icons, derived from settled scores

Command replies, onboarding, language selection, help and quiz controls use the same warm voice across all six languages, including badge selection, cooldowns and validation. Success, waiting, guidance and recoverable failures use varied, contextual kaomoji, chosen consistently by message rather than randomly. Styling is applied before user values are inserted, so names and custom text stay intact. Short statistic labels stay concise; permanent-deletion warnings speak in Dilemma's voice but stay explicit and undecorated. Profile names have no added decorations. Native Discord command and option descriptions intentionally remain neutral English text.

## Setup

Before pushing code, run `npm run security:setup` once to install the checksum-verified Gitleaks scanner and local pre-push hook. Use `npm run security:scan` to scan history and current publication candidates. The scanner blocks pushes when unavailable or when a scan fails; it does not print secret values. Hooks can be bypassed, so keep GitHub push protection enabled.

PostgreSQL tests require `TEST_DATABASE_CONFIRMED=true`, `EXPECTED_TEST_HOST` and `EXPECTED_TEST_DATABASE` matching a separately provisioned test database. Never use production credentials for these tests.

Run `npm run test:random:postgres` on an isolated, migrated PostgreSQL test database before releasing random quota changes. It tests concurrent claims, daily capacity, server/topic isolation, transaction rollback, failure release and upgrade history, and deletes only its own uniquely named test records. It neither migrates the database nor contacts Discord or an AI provider.

Requirements: Node.js 22+ and a Discord application/bot.

1. Run npm install.
2. Copy .env.example to .env.
3. Fill in Discord and OpenAI credentials. Keep `DATABASE_URL="file:./dev.db"` for local development.
4. Run `npm run db:generate`.
5. Run `npm run db:migrate -- --name init`.
6. Run `npm run test:db:fresh` to verify migrations on a clean SQLite database.
7. Set `DISCORD_REGISTER_GLOBAL=true` for production, then run `npm run register`.
8. Run `npm run dev`.

Required variables:

- DISCORD_TOKEN
- DISCORD_CLIENT_ID
- DISCORD_GUILD_ID during development
- DISCORD_REGISTER_GLOBAL, set `true` for global command registration
- OPENAI_API_KEY
- OPENAI_MODEL, default: `gpt-6-luna`
- DATABASE_URL, default: `file:./dev.db`

Never commit .env or bot/API keys.

### AI generation and cost controls

Quiz generation now uses OpenAI directly, with `gpt-6-luna` as the default model. The provider switch, free-model discovery and model fallback pool have been removed. Configure a project-scoped service-account key in the ignored `.env` file as `OPENAI_API_KEY`; never paste a key into an issue, chat, screenshot or commit. Revoke any exposed key before deployment. An expiring key must be replaced before expiry or generation will stop.

Requests use the Responses API with strict JSON Schema and `store: false`. The schema constrains the language, answer count, answer lengths and correct-answer index. Local validation still checks the complete quiz, unique answers and exact custom-answer order before publication. Schema compliance does not guarantee factual accuracy. Profile cards are rendered locally without AI.

Quiz-writing instructions target one fact at a time and ask the model to audit direct and indirect clues across wording, context, grammar, topic, answer options and emojis. Distractors should be plausible, parallel and comparably detailed; custom answer text and order remain unchanged. The model reviews its draft within the same generation request, and shared instructions are sent only once. These are generation instructions, not a semantic guarantee: local schema validation cannot detect every hint or ambiguous fact. Synthetic tests verify the request contract, not live-model question quality.

`OPENAI_REASONING_EFFORT` defaults to `low` and supports `low` or `medium`. `AI_MAX_OUTPUT_TOKENS` defaults to 2048, including reasoning and visible output, and accepts 512-4096. These settings bound each attempt, not total monthly spend. OpenAI inference is paid; repeated successful but invalid or duplicate responses can also incur costs. There is no automatic switch to a more expensive model or another provider.

`AI_MAX_RETRIES` defaults to 1 additional attempt per generation call. Transient connection errors, 408, 409, temporary 429, 5xx and invalid quiz content can be retried. Insufficient account quota, authentication errors, refusals and incomplete responses stop without another attempt. Temporary rate limits respect `Retry-After` within the overall deadline. Invalid model and request errors are not retried.

`AI_REQUEST_TIMEOUT_MS` defaults to 20000 per request. `AI_GENERATION_TIMEOUT_MS` defaults to 60000 overall, including queue waits, retries and duplicate-question attempts. `AI_MIN_INTERVAL_MS` defaults to 1000 between request starts. AI is called only when a quiz needs generation; there is no model-catalog polling or background AI traffic.

AI failures have separate localized feedback from Discord permission errors. A failure before sending releases the quiz reservation. An uncertain Discord send is never retried automatically. `npm run test:ai` uses synthetic fixtures for the OpenAI request contract, six languages, answer validation, retries, quota handling, refusals, incomplete output, interrupted response bodies and queue deadlines. It does not spend API credits.

See the current [OpenAI model documentation](https://developers.openai.com/api/docs/models/gpt-6-luna) and [API pricing](https://developers.openai.com/api/docs/pricing). Existing deployments must replace their old provider configuration with the OpenAI variables in `.env.example`. No database migration or Discord command registration change is required for this provider migration.

## Commands

After a quiz closes automatically or through the close button, Dilemma posts its saved correct answer and explanation in the quiz channel. Changing a topic's difficulty affects future quizzes; active quizzes keep their original answer and point value. Results wait for Discord's finalized poll data after automatic expiry. Failed result delivery is retried across restarts without awarding points again or polling the database while idle. Upgrades containing the `20261028120000_automatic_quiz_results` migration do not automatically replay results for previously settled quizzes.

Each server can save up to 31 quiz topics in total, including disabled topics. Delete a topic to free a slot; disabling it does not free one. Random quizzes do not use these slots. Existing topics remain editable and are never removed automatically if a server already exceeds the limit. Creation checks the limit transactionally to prevent concurrent commands from exceeding it.

- `/dilemma create name:...` - create a new topic only; optional settings in order: `channel`, `start_date`, `generation_time`, `interval_days:1-30`, `duration_hours:1-24`, `difficulty:easy|medium|hard`, `option_count:2-4`. The destination defaults to the current channel. Answers are AI-generated, with 4 by default. Existing names direct you to `configure` rather than overwriting a topic.
- `/dilemma configure name:...` - update an existing topic using the same fields and order as `create`; provide at least one change. Omitted fields, channel, enabled state, history and quota remain unchanged. `start_date:none` removes the fixed anchor; `generation_time:none` removes automatic publication time only if there is no active start date.
- `/dilemma run name:...` - publish an available quiz early in its saved channel, even when invoked elsewhere, without moving fixed repeat dates; optional `duration_hours:1-24` overrides this poll only
- `/dilemma random` - generate one quiz without a saved topic. Optional fields in order: `options`, `option_count`, `difficulty`, `duration_hours`. Use 2-4 unique comma-separated `options`, each at most 55 characters; their count is inferred. Without custom answers, AI generates `option_count` answers, or 4 when omitted. When both fields are set, the count must match the custom answers. All members share the same daily quota and cooldown.
- `/dilemma random-reset` - reset the server's random cooldown on demand. Only the server owner or configured Dilemma management role can use it. The four-per-day limit stays in place.
- `/dilemma random-channels add channel:...`, `/dilemma random-channels remove channel:...`, `/dilemma random-channels list` - manage the channels where everyone may start random quizzes; requires Manage Server or the configured management role
- `/dilemma random-notifications set role:...`, `/dilemma random-notifications clear`, `/dilemma random-notifications show` - configure an optional role ping when another random quiz becomes available; requires Manage Server or the configured management role
- `/dilemma list` - browse all saved topics in a private card, ordered by configured start date and then name A-Z; topics without a start date come last. Filter by status, difficulty or channel, move between pages, refresh the list or clear filters. Includes disabled topics, saved destinations and the notification role.
- `/dilemma enable`, `/dilemma disable`, `/dilemma delete`
- `/dilemma help` - show the grouped command guide without parameter examples or a self-referential help entry
- `/dilemma language value:en|pl|de|es|fr|ja` - set the server language
- `/dilemma timezone` - show the server timezone; optional `value` selects an IANA timezone, with autocomplete
- `/dilemma ping` - check whether the bot is online
- `/dilemma poll end` - end a poll and publish its result
- Results show who closed a quiz and when, without pinging the member. Successful manual closes persist the Discord user ID, timestamp and button/command source on the quiz record. Concurrent closes preserve the first successful actor, and failed close requests roll back the audit write. Finalized expiry is labeled automatic only when Discord's recorded closing time reaches the original deadline; earlier closures without an actor remain unknown. Historical records are not assigned an actor. Apply `20261028140000_quiz_closure_audit` and regenerate the Prisma client before running this feature; command registration is unchanged.
- Each new quiz also has a localized **Let's end this quiz** button (**Zakończ quiz** in Polish). Members with Manage Server permission or the configured Dilemma management role can close any quiz. The creator of a random quiz can also close their own quiz without a management role; this does not grant access to other random or scheduled quizzes. The button avoids copying the message ID and gives private feedback. The button and `/dilemma poll end` use the same validation and scoring flow. Early closing does not reset daily quota. Controls are disabled after manual closing or finalized automatic scoring; handling uses persistent message records and works after a restart.
- `/dilemma score profile user:optional` - show points, accuracy, current and best correct-answer streak
- Score cards also show the player's level and EXP progress, separately from answer accuracy.
- Profile headers show only the player's display name, without a title prefix or added decorations. A compact rank badge sits beside the avatar on the same line as the name. The top three places have prominent gold, silver and bronze styling; other places use a muted badge. Ranking matches `/dilemma score leaderboard`: points descending, correct answers descending, then user ID ascending to resolve ties. Players without settled answers show a dash, with a localized explanation in accessible text; incorrect settled answers still count as participation.
- `/dilemma score profile` renders a navy/lavender/gold PNG card locally, with a Discord avatar (or placeholder), a document icon for answers and a measured EXP bar. Long names shrink and then truncate at grapheme boundaries. Attachment alt text preserves the player name and statistics; rendering failures fall back to a text embed. Cards and avatars stay in memory, never in application files or logs. Avatar downloads are restricted to Discord CDN image paths, with a three-second timeout and size limits. The Docker image includes fonts; no AI generation is used for cards.
- `/dilemma score leaderboard` - show the server's top ten players, with level, points, total answers, correct answers, accuracy and best streak
- `/dilemma score achievements user:optional` - show six achievements and progress from settled results on this server
- `/dilemma score badge achievement:... achievement_2:optional achievement_3:optional` - select up to three unlocked badges or hide them with `none`
- `/dilemma score forget confirm:true` - permanently delete your stored answers and score on the current server

Only `/dilemma` is registered; standalone `/settings`, `/language`, `/help`, `/poll`, `/ping` and `/score` are not aliases. Re-register commands when command definitions change; a button-label-only update does not require registration. Registration groups frequent player actions first, then topic setup and operation, server settings, delegated access, poll controls and help; topic deletion is last. Discord clients may apply their own display sorting. Help, ping, score and random quizzes are available to ordinary players, subject to Discord's own application-command and channel permissions. Language, timezone, topic management and scheduled-topic runs require Manage Server permission or the configured management role, checked in their handlers rather than on the shared root command. Closing follows the same management check, with one exception: a random quiz's recorded creator may close their own quiz using either the button or `/dilemma poll end`. Topic-name autocomplete is also restricted to managers.

Before enabling creator closing, apply `20261026120000_random_quiz_creator`, regenerate the Prisma client and re-register commands to refresh the closing description. The migration adds an optional creator user ID to random quizzes. Existing records keep no creator; only managers can close those legacy quizzes. Creator access survives bot restarts and always checks the server, channel and bot-owned poll.

### Delegate bot management without server administration

1. A server administrator creates an ordinary Discord role with any name, for example `Quiz Keeper`. Do not give it Manage Server or Administrator just to manage Dilemma.
2. A member with Manage Server runs `/dilemma permissions set role:@Quiz Keeper` once on that server.
3. Assign that role to the members who should manage Dilemma. The bot does not create roles, assign roles or change Discord permissions.

Role members can manage topics, schedules, language/timezone and quiz closing, but cannot change the delegated role. `/dilemma permissions show` displays the configured role to managers. Only a member with Manage Server, including administrators, can use `/dilemma permissions set` or `/dilemma permissions clear`. Clearing the setting restores administrator-only management immediately. Removing the role from a member removes their access on their next interaction. Role IDs, not names, determine access, and each server has its own setting. `@everyone`, integration-managed, deleted and foreign-server roles cannot be selected. Existing servers have no delegated role by default.

Delegation grants access to Dilemma only; any unrelated Discord permissions already attached to that role still apply. Members also need the normal Discord permissions to view the channel and use application commands. Discord integration/channel restrictions remain in force. Settings are cached and updated after role changes made through these commands, without new background queries. Before enabling this feature, apply `20261022160000_manager_role` on an isolated test database and then production with a backup, and re-register commands. `npm run test:permissions` verifies authorization with synthetic fixtures and no external API or production database calls.

Set topic difficulty, duration, publication time and repeat interval with `create` or `configure`; random quizzes have their own optional difficulty and duration. Existing saved defaults remain available for compatibility, but `/dilemma defaults` has been removed. New servers use medium difficulty, a 24-hour poll duration and a one-day interval unless supplied.

Use `/dilemma timezone value:Europe/London` to select this server's timezone, or `/dilemma timezone` to show the effective zone. This command requires Manage Server or the configured Dilemma manager role. Timezones use IANA names such as `Europe/Warsaw`, `America/New_York` and `Asia/Tokyo`; `UTC` is also accepted. Autocomplete helps find a timezone. Language and timezone are independent. Configure the timezone before the first scheduled quiz. Changing it preserves stored dates and clock times but immediately recalculates active schedules and daily-limit boundaries in the selected zone, including daylight-saving changes. It does not delete quota records or reset the rolling six-hour random cooldown.

For a server without an explicit timezone, the optional deployment variable `QUIZ_TIMEZONE` is the fallback. Removing that variable uses `Europe/Warsaw`; it does not detect the server's country. Existing servers keep this fallback until a manager selects a timezone. Apply the additive `20261022190000_guild_timezone` migration before running the new code, first on an isolated PostgreSQL copy, then on production with a backup. Re-register commands to replace `defaults` with `timezone`. Settings are cached, and schedule changes reschedule in-memory timers without background polling.

Topic forms follow the planning sequence: name, destination channel, first date, publication time, repeat interval, voting duration, difficulty and answer count. Date-based scheduling requires a time: a new topic can inherit the server default, while an existing topic keeps its saved time unless explicitly changed. You can clear date and time together. A date without a time is rejected before writing. Duration is independent of repeat interval and uses whole hours (1-24), so it cannot exceed the shortest one-day interval. Random duration can outlast its six-hour cooldown; active polls can overlap.

### Quiz channels and destinations

Starting `/dilemma random` does not require Manage Server or a Dilemma management role. Discord's normal command/channel permissions, the random-channel list, daily quota and cooldown still apply. Only administrators or delegated Dilemma managers can change channel settings. Native polls allow vote changes; Dilemma does not offer per-user voting blocks.

Without assigned random channels, everyone can use `/dilemma random` wherever Discord permits bot messages and the bot has the required permissions. Add one or more channels with `/dilemma random-channels add channel:#quiz` to restrict random quizzes to that list. The first entry enables restrictions for everyone, including administrators. Removing a channel blocks new random quizzes there while other entries remain; removing the last entry restores unrestricted channel access. Ongoing polls and topic schedules are unaffected. Threads do not inherit their parent's assignment when restrictions are active. These settings are isolated per server and persist across restarts; they add no background database polling. The daily quota and cooldown remain shared across all channels.

Each saved topic has its own destination. Use `/dilemma create name:Science channel:#science` to choose it, or `/dilemma configure name:Science channel:#another-channel` to change it. Omitting `channel` during creation uses the current channel; omitting it during configuration preserves the saved destination. Both scheduled publication and `/dilemma run` use that destination. Choosing a topic destination never changes the independent random-channel restrictions; configure those separately with `random-channels add` and `remove`. Only text and announcement channels on the same server are accepted as topic destinations. The bot needs View Channel, Send Messages, Embed Links, Read Message History and Send Polls there. Unavailable destinations are rejected without falling back to the invoking channel. Changes during AI generation are checked again before publication, and publication does not overwrite a newer destination.

Topic confirmations, topic lists and other detailed replies use Markdown bullet lists. Setup instructions use ordered steps where appropriate. Long lists continue in private messages instead of silently dropping topics; generated replies suppress mentions. All six languages share this layout, while Discord's native menu descriptions remain neutral.

Before upgrading, test the additive `20261025120000_quiz_channels` migration on isolated PostgreSQL, back up production, apply the migration, then re-register commands. Existing topic destinations and player data are preserved. The new random-channel list starts empty, so existing servers retain unrestricted random-channel access until a manager assigns a channel. Run `npm run test:quiz-channels`, `npm run test:feedback-layout`, `npm run test:db:fresh` and the existing command, scheduling and quota regressions before release.

Discord does not support conditionally hidden or conditionally required slash-command options. The bot validates dependent fields before changing a topic, reserving random quota or calling AI; it explains missing or conflicting values privately. Custom answers cannot be empty, duplicated ignoring case, longer than 55 characters or outside the 2-4 answer range. AI output must match the requested answer count and preserve custom text and order; mismatches retry within the existing timeout and retry budget, then fail without publishing. Existing topics with legacy fixed answers keep them until `configure option_count` explicitly switches them to generated answers. `npm run test:command-ux` covers the forms, dependencies, permissions, preserved settings and random answer flow with local fixtures, not live Discord or AI calls.

### Notify a role when a saved quiz starts

Set `ping_role` in `/dilemma create` or `/dilemma configure` to notify one role in the quiz's saved channel when it is published. This includes the automatic schedule and an early `/dilemma run`. Random quizzes do not ping. Omitted roles default to no notification on creation and preserve the saved role on configuration; `clear_ping:true` is available only in `/dilemma configure` to remove it. Do not combine `ping_role` with `clear_ping:true`. Only Dilemma managers can change this setting.

For example, configure a topic with `/dilemma configure name:Monday ping_role:@Quiz`, or disable notifications with `/dilemma configure name:Monday clear_ping:true`. Choose an existing server role other than `@everyone`. The role must be mentionable, or the bot must have Mention Everyone permission in the destination channel. The bot does not change role permissions. Personal Discord notification settings can suppress push alerts even when a role mention succeeds.

The start message permits mentions only for that role; text from names or AI cannot ping other roles, users, `@everyone` or `@here`. Configuration, list replies and result updates remain silent. The current role and destination are checked again after generation. If a role is deleted or can no longer be mentioned, publish the quiz without a ping. Role IDs are stored per topic; no extra idle database polling or environment variables are required. Existing topics keep notifications disabled after the additive `20261025150000_quiz_ping_role` migration.

### Duplicate questions

Duplicate-question checks compare against the latest 365 published questions within the same saved topic, or the latest 1460 random questions on the same server (365 times the four-per-day limit). The random window counts questions, rather than filtering by calendar date. These histories remain separate; topics are not compared with each other or with random quizzes. Comparison normalizes letter case and whitespace, not meaning or paraphrases. The AI avoidance prompt still contains at most 20 historical questions per attempt; the larger comparison window stays local to the bot. Duplicate candidates can trigger up to three generation attempts within the existing overall timeout.

### Plan topics ahead by date

Create all your topics now and give each one its own first publication date. `start_date` uses `YYYY-MM-DD` in the server's configured timezone; choose today or a later valid date. Supply `generation_time` when creating a dated topic. `interval_days` accepts 1-30 calendar days and can be set during creation or changed later without losing the start date.

For a different topic every weekday, create these seven topics before the first date. Use `channel` to select a destination, or create them in that channel. Dates below are examples; replace them with your intended future dates:

```text
/dilemma create name:Monday start_date:2026-10-26 generation_time:18:30 interval_days:7
/dilemma create name:Tuesday start_date:2026-10-27 generation_time:18:30 interval_days:7
/dilemma create name:Wednesday start_date:2026-10-28 generation_time:18:30 interval_days:7
/dilemma create name:Thursday start_date:2026-10-29 generation_time:18:30 interval_days:7
/dilemma create name:Friday start_date:2026-10-30 generation_time:18:30 interval_days:7
/dilemma create name:Saturday start_date:2026-10-31 generation_time:18:30 interval_days:7
/dilemma create name:Sunday start_date:2026-11-01 generation_time:18:30 interval_days:7
```

The Monday topic starts on October 26, then repeats on November 2, November 9 and so on. The other topics keep their own dates. Use real subject names rather than weekday names if you want AI to generate questions about a particular subject. Creation saves topic configuration, not a batch of ready questions; AI generates a new question at each publication.

To change a saved topic, use `/dilemma configure name:Monday start_date:2026-11-02 interval_days:14 generation_time:19:00`. `/dilemma list` and dated-topic confirmations show the start date, interval, local publication time and timezone. The list uses the configured first date, not the next repeat or creation date, and sorts names alphabetically within each date. Its native Discord menus filter status, difficulty and destination; page buttons keep every saved topic accessible without sending a separate message per page. Each click refreshes the current server's data and checks management access; no background polling or schema change is needed for this view. Help lists the related commands in all six supported languages, without an explanatory introduction or parameter examples.

Repeats are anchored to the first date, not the actual time of a late run. After downtime, the bot publishes at most the latest overdue slot rather than replaying every missed quiz; the next planned date stays unchanged. Calendar-day intervals retain the local hour across daylight-saving changes. A missing local hour runs at the first later local minute; a repeated hour uses its first occurrence. Choosing today with an already-passed publication time makes the quiz due immediately.

For dated topics, `/dilemma run` may bring the current slot forward to earlier on its publication day, or recover an overdue slot. It cannot publish before the first day or repeat a consumed/reserved cycle. Daily and cycle reservations are atomic, persist across restarts and retain an uncertain send's slot even after midnight. An AI failure before any send attempt releases both reservations. Existing undated topics keep their previous rolling interval behavior and one-quiz-per-day manual limit. `start_date:none` removes the fixed anchor without resetting history or daily quota.

Before deploying fixed-date schedules, test `20261021120000_topic_start_date` on an isolated PostgreSQL copy, then apply it to the target database and re-register commands. This additive migration introduces nullable `Topic.startDate`; existing topics receive no start date, and schedules, scores, EXP and achievements are preserved. Do not start the new code against an unmigrated database. Run `npm run test:topic-calendar`, `npm run test:idle-database` and the migration tests before release. `npm run test:topic-calendar:postgres` verifies concurrent cycle claims, cross-day rollback and paired reservation release against an already-migrated isolated PostgreSQL database; it requires the test-only environment guards described above and deletes only its own synthetic records.

The historical default-setting columns and their migrations remain intact for stored data and rollback compatibility. Removing the defaults command does not rewrite existing topics, saved preferences or player scores.

Each topic can publish at most one quiz per calendar day, shared by manual and scheduled runs. An early manual run replaces that day's scheduled run. Different topics have independent limits. Changing a schedule, enabling a topic or restarting the bot does not reset quota. Deleting and recreating a topic creates a new topic with a new quota.

Random quizzes allow at most four publications per calendar day on each server, with at least six hours between publications. All members and channels share these limits. Days use the server's configured timezone, falling back to `QUIZ_TIMEZONE` (default `Europe/Warsaw`); the rolling six-hour cooldown uses elapsed time and does not reset at midnight, on a restart or during a daylight-saving change. The server owner or configured Dilemma manager role can reset only the cooldown with `/dilemma random-reset`; the daily quota remains. Existing same-day random polls and uncertain reservations count during upgrades. Scheduled topics retain their independent one-quiz-per-topic daily limit.

Configure a role with `/dilemma random-notifications set role:@Role` to ping it when random becomes available again. Dilemma sends the notice in the channel of the latest random quiz. It accounts for both the six-hour cooldown and the server-local daily quota, including the next local day boundary. Clear the role to stop notifications. A role must be mentionable or Dilemma must have permission to mention all roles in that channel. Timers are scheduled in memory and rebuilt from the database at startup; they do not poll the database.

Polls last 24 hours by default. Set `duration_hours:1-24` in topic creation, configuration, a manual run or a random command. Historical saved defaults can still supply omitted values, but there is no defaults command. A run override does not change the saved topic duration. Closing a poll early does not reset a topic's daily quota or the random cooldown.

Reservations persist in the database and prevent concurrent commands from exceeding limits. Random daily slots and the rolling cooldown are claimed and refreshed transactionally in the existing quota table. AI failures before a Discord send attempt release both reservations. A failed or uncertain send conservatively keeps its daily slot and six-hour cooldown. Successful publication starts a full six-hour cooldown, while the daily slot remains consumed for that calendar day. Changing days frees daily capacity but does not bypass a remaining cooldown. The additive random-readiness migration stores the cooldown reset, notification role and completed notification marker.

The v0.3.0-beta migration only adds duration fields and quota storage. Legacy question-count columns remain unused for compatibility with the previous container during rollback. Apply the migration before starting this version, then re-register slash commands to replace `questions_per_run` with `duration_hours`.

Direct deployment normally rejects pending migrations. After creating a backup and testing the migration on an isolated copy, explicitly use `npm run deploy:prod -- -ApplyMigrations` to apply it through the direct database connection before switching containers. Migration logs remain private on the host.

`/dilemma language` sets one global language for the server. It applies to existing and new topics, manual runs, random quizzes, scheduled generation and command feedback. The generator must use this language for the question, generated answers, explanation and generated topic title, irrespective of the input topic's or previous questions' language. Responses declaring another language are retried within the existing retry and timeout limits, then rejected rather than published. Previously published questions and explanations are not retroactively translated. Saved topic names and custom answer options remain as provided.

## Database idle behavior

The bot keeps one local timer per scheduler, not a periodic database polling loop. At startup it reads active topic schedules and unsettled poll deadlines. It then queries only when a known topic is due, a poll expires or closes early, a failed job needs a retry, or a command needs persisted data. Empty queues perform no database queries, including overnight. Long timer waits are re-armed locally without querying the database.

Topic creation, configuration, enable/disable, deletion and successful manual publication update the local schedule after the database write commits, including fixed-date schedules. New polls register their settlement deadline after commit; early closure replaces the expiry timer. Restarting reloads persisted state and catches up overdue work. Daily/cycle reservations, finalized-vote checks and transactional, idempotent scoring remain authoritative. Pending finalization retries back off from one minute up to one hour; failed jobs and failed startup reads back off from five minutes up to one hour.

Guild settings, including language, timezone, delegated role and historical defaults, use a bounded, process-local cache with a one-hour lifetime. Bot settings commands and onboarding update it immediately. Cache expiry is checked only on demand, never by a background refresh. Scores, votes and profile deletion are not cached. Run one active bot process; after editing schedules or settings directly outside the bot, restart it to reload the local state.

`npm run test:idle-database` uses synthetic database, Discord and AI fixtures with a simulated clock. It checks zero additional SQL queries during 48 idle hours, scheduled publication, automatic and early settlement, early manual runs, startup recovery, DST, settings updates and retry backoff. It does not contact Neon or verify production CU-hour savings. Neon still controls its own suspension delay and cold-start behavior.

## Production notes

- Run the bot continuously. Automatic generation works only while the process is online.
- Use a persistent PostgreSQL database for production. SQLite is intended for local development.
- For PostgreSQL: set `DATABASE_URL`, run `npm run db:generate:postgres`, then `npm run db:migrate:postgres`.
- PostgreSQL migrations use `DATABASE_URL_UNPOOLED` when supplied, or derive the direct endpoint from a Neon pooled URL. The running bot keeps its original connection URL.
- Recommended free hosting: Oracle Cloud Always Free VM for the bot and Neon Free for PostgreSQL. See [DEPLOYMENT.md](DEPLOYMENT.md).
- Vercel is suitable for a future web dashboard, not for the always-on Discord bot process.
- Global Discord commands can take up to one hour to appear. Guild commands update faster during development.
- Never commit `.env`, Discord tokens or AI API keys.

## Roadmap

### Implemented in v0.1.2-alpha

- Add selectable question difficulty: easy, medium and hard.
- Apply the selected difficulty to random questions and saved topics, including scheduled generation.
- Pass the difficulty to the AI prompt and display it with each quiz.
- Preserve existing topic settings when introducing the new difficulty field.
- Give command feedback a consistent Dilemma uwu voice: warm, playful wording with occasional kaomoji.
- Cover success confirmations, progress messages, validation errors, permission errors and AI timeouts, localized to the server language.
- Keep errors and security warnings clear and actionable, with restrained styling. Preserve exact command names and technical details.

### Implemented in v0.2.0-beta

- User scores, correct-answer streaks and server leaderboards
- Final-vote scoring with atomic, idempotent settlements and restart recovery
- Self-service deletion of stored answers and scores

The beta introduced points, streaks and leaderboards. These features remain available in the stable `v1.0.0` release.

### Future releases

See [ROADMAP.md](ROADMAP.md) for saved feature ideas, including periodic rankings, leaderboard navigation, topic statistics, question reports, profile customization and more languages.

## Scoring

### Achievements and badges

`/dilemma score achievements user:optional` shows six achievements and their progress on the current server: first settled answer, 10 correct answers, 100 answered quizzes, a best streak of 10, level 2 and level 5. Existing settled results count immediately. Achievements are cosmetic and do not grant extra points or EXP.

Use `/dilemma score badge achievement:... achievement_2:optional achievement_3:optional` to choose up to three different unlocked badges for your card. Each invocation replaces the displayed selection; omit the second or third choice to display fewer badges. The card shows a row of navy/lavender/gold icons beside the avatar, without repeating badge names on the image. Autocomplete offers localized unlocked badges, excludes duplicates from the other choices and includes a "No badges" option (`none`). Choose `achievement:none` without other badges to hide all icons. With no selection, the profile layout stays unchanged. Selection is server-specific and cannot change another player's badges. The card's accessible description and text fallback include all displayed badge names.

Achievements are calculated from the existing score rather than stored as separate user activity records. Only the selected badge identifiers are stored. The existing nullable `selectedBadge` text field stores one identifier or a JSON array of up to three identifiers; legacy single-badge selections remain readable without another migration. `/dilemma score forget` removes the score, achievement progress and selection on that server. New finalized answers may unlock achievements again.

Before deploying this feature, test the additive `20261015120000_profile_badges` migration on an isolated PostgreSQL branch, apply it and re-register slash commands. It adds a nullable `UserScore.selectedBadge` field; existing scores, EXP, quiz history and schedules are unchanged. Local SQLite and mocked tests do not replace isolated PostgreSQL verification.

### Levels and EXP

Players start at level 1. Correct answers grant 10 EXP on easy, 20 on medium and 30 on hard; wrong answers and missing votes grant no EXP. EXP is derived from settled points at 10 EXP per point, so existing scores immediately contribute without a database migration or reset.

Advancing from level L to L+1 requires 100 × L EXP. Total EXP needed to reach level L is 50 × L × (L-1): level 2 starts at 100 EXP, level 3 at 300 and level 4 at 600. Surplus EXP carries into the next level. At a threshold the level advances and the bar resets to the new level's progress; the card never displays a rounded-up 100% before an advance.

The profile progress bar tracks EXP, not correct-answer accuracy. Accuracy is shown separately beside the correct answer count. Points remain the leaderboard sorting criterion; leaderboard rows also show level. Levels and EXP are server-specific and are removed with the score by `/dilemma score forget`.

### Quiz points

Correct answers earn 1 point on easy, 2 on medium and 3 on hard. Wrong answers earn zero and reset the correct-answer streak. Not voting does not affect a streak. Streak order follows poll finish times, not background retry order. Equal finish times use message ID order for a stable tie-break.

All quizzes use native Discord single-choice polls. A member can remove their vote and select another answer until the poll closes. Vote counts follow Discord's normal display behavior. The bot waits for finalized Discord results and uses actual Discord answer IDs, then awards points exactly once for the final answer. A withdrawn vote produces no scored answer and does not reset a streak. No privileged Discord intent is required.

`/dilemma poll end` and the close button can end a poll early, using the same management check. Scores and leaderboards remain isolated per server; tied scores use correct answers, then user ID.

Deleting your answers and score is permanent. Already scored quizzes are not rescored. Deletion does not withdraw a Discord poll vote; votes in polls that have not yet been scored can create new score records after closure. See [Privacy Policy](PRIVACY_POLICY.md).

## Publication privacy checks

Run `npm run security:setup` and `npm run security:images:setup` once. The latter
downloads checksum-verified English/Polish OCR models from a pinned official
revision. Images and recognized text stay local; no OCR service receives them.

`npm run security:publication` checks Git history/current candidates for secrets,
then checks current and historical raster images for metadata, QR codes and
sensitive OCR text. The local pre-push hook and prepared CI workflow use these
controls. A failed or unavailable scanner blocks publication. Hooks are bypassable.

PNG/JPEG/WebP single-frame images are supported; other formats require manual
conversion and review. Every image also requires visual review, recorded by its
SHA256 in `image-publication-reviews.json`. Changed bytes invalidate that approval.
Do not approve solely because OCR reports no finding. Inspect names, identifiers,
small text, screenshots, badges and alpha-hidden content. These checks are not a
steganography detector or a guarantee against all disclosures.

`npm run security:images:prepare -- <local-image>` creates a flattened,
metadata-free PNG copy under the ignored `.tools/image-publication` directory.
It preserves the original and refuses detected QR codes or sensitive text.
Review the copy before using it. For visible private data, use an opaque redaction
or crop, then rerun the checks; do not rely on blur or a translucent overlay.

`npm run security:production` audits production logs and host controls without
printing raw logs, addresses, account names or credentials. Cloud account access,
provider snapshots, historical backups and database role design require separate
verification. See `SECURITY_REVIEW.md` for current scope and limitations.

## License

MIT

## Legal

- [Terms of Service](TERMS_OF_SERVICE.md)
- [Privacy Policy](PRIVACY_POLICY.md)
