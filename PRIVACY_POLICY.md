# Dilemma - Privacy Policy

Last updated: October 6, 2026

This policy explains what data Dilemma processes when used on a Discord server.

## Data processed

Dilemma stores Discord server IDs, channel IDs, topic configuration, generated
questions, poll options, results, and timestamps. For quiz scoring, it stores
Discord user IDs, final answer selections, points, accuracy and correct-answer
streaks. Server leaderboards and profiles can display these scores to other
members of the same server. Usernames and avatars are not stored for scoring.

Dilemma does not intentionally request names, email addresses, message history,
or private messages. Do not enter sensitive personal information into topics,
options, or commands.

## AI provider

To generate content, Dilemma sends the configured topic, language, and related
generation context to the AI provider configured by the operator. The bot
operator may use OpenRouter or OpenAI. Provider data handling is governed by
that provider's own privacy policy and terms.

## Use and retention

Data is used to configure scheduled generation, publish polls, prevent duplicate
questions, show results, and calculate server-specific scores and streaks.
Use `/score forget confirm:true` to permanently delete your stored answers and
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
