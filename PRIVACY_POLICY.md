# Dilemma - Privacy Policy

Last updated: October 22, 2026

This policy explains what data Dilemma processes when used on a Discord server.

## Data processed

Dilemma stores Discord server IDs, channel IDs, topic configuration, generated
questions, poll options, results, and timestamps. For quiz scoring, it stores
Discord user IDs, final answer selections, points, accuracy and correct-answer
streaks. Levels and EXP are calculated from settled points, without storing additional personal data.
Cosmetic achievements are calculated from these existing results. If a player
chooses up to three profile badges, Dilemma stores their identifiers with that player's score
on the current server. Deleting the score also deletes this selection and the
progress used for achievements.
Server leaderboards and profiles can display these scores to other
members of the same server. Usernames and avatars are not stored for scoring.

When delegated bot management is configured, server configuration includes the
selected management role's Discord ID. The bot uses it only to authorize
management actions and does not grant Discord server permissions.
Server configuration can also store an administrator-selected timezone for
schedules and daily limits. This value is not inferred from member locations.

Profile cards temporarily process the player's Discord display name, avatar and
score in memory to render an image. Avatars are fetched only from Discord's CDN.
Card rendering does not send this data to an AI provider, write player images to
application files, or include them in application logs. The resulting card is
sent back through Discord, whose own data handling applies to the attachment.

Dilemma does not intentionally request names, email addresses, message history,
or private messages. Do not enter sensitive personal information into topics,
options, or commands.

## AI provider

To generate content, Dilemma sends the configured topic, language, custom answer
options when supplied, and a bounded selection of previous questions to OpenAI.
Quiz requests disable response storage with `store: false`; this does not remove
any retention required by OpenAI's own policies. OpenAI's privacy policy and
terms govern provider-side processing. Discord user IDs and votes are not part
of quiz generation requests.

## Use and retention

Data is used to configure scheduled generation, publish polls, prevent duplicate
questions, show results, and calculate server-specific scores and streaks.
Use `/dilemma score forget confirm:true` to permanently delete your stored answers and
score on the current server. Polls that have not yet been scored and future
votes can create new records. Already scored polls are not scored again after
deletion. This command does not remove your vote from Discord itself.
User IDs and votes are not sent to the AI provider for quiz generation.
The operator may delete stored server data by
removing the bot and deleting its database records. Retention depends on the
operator's database and hosting configuration.

## Discord

Dilemma operates through Discord's platform. Discord independently processes
data under its own Privacy Policy and Terms of Service.

## Contact

For privacy questions or deletion requests, contact the bot operator through
the project repository:
https://github.com/mwazqa/Dilemma/issues
