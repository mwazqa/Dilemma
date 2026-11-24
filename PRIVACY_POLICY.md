# Dilemma - Privacy Policy

Last updated: November 24, 2026

This policy explains what data Dilemma processes when used on a Discord server.

## Data processed

Dilemma stores Discord server IDs, channel IDs, topic configuration, generated
questions, poll options, results, and timestamps. For quiz scoring, it stores
Discord user IDs, final answer selections, points, accuracy and correct-answer
streaks. Dilemma records bonus EXP from correct-answer streaks and includes it
alongside EXP from points and Spark exchanges when calculating levels.
Dilemma also stores the player's server-specific Sparks balance and which quizzes
have a purchased count preview or 50/50 hint, including its two remaining choices.
Dilemma records quiz fees and any refunds by player and quiz so the bot can
refund recorded costs once after a factual correction is approved. The public
correction includes the approved text and the overall refund.
For Spark transfers, Dilemma stores the server, sender, recipient and Discord
interaction IDs, the amount and timestamp so each transfer is processed once.
For bets, it stores the player's answer, stake and final payout on the current server.
Changing the vote moves the bet. Withdrawing refunds the stake with a 1-Spark
withdrawal fee. Bet payouts are calculated only after closing.
New quizzes store each member's current button
vote before closing so members can change or withdraw it. Counts remain hidden
until closing, except for private previews unlocked with Sparks. Final aggregate
counts do not identify individual voters. Random quiz records also store a broad
category to reduce repeated categories on the same server.
Cosmetic achievements are calculated from these existing results. If a player
chooses up to three profile badges, Dilemma stores their identifiers with that player's score
on the current server. Deleting the score also deletes this selection and the
progress used for achievements.
Server leaderboards and profiles can display these scores to other
members of the same server. Usernames and avatars are not stored for scoring.

For newly created random quizzes, Dilemma also stores the creator's Discord user
ID with the quiz record so that person can close their own quiz, including after
a bot restart. This ID is not sent to the AI provider. Deleting a score does not
remove the creator ID attached to a published quiz; it follows quiz-record retention.

When a member closes a quiz through Dilemma, the quiz record stores that member's
Discord user ID, the closing time and whether the button or command was used.
The result message displays the member and time without sending a mention
notification. This audit data is not sent to the AI provider. Deleting a score
does not remove a quiz's closure audit; it follows quiz-record retention.

When delegated bot management is configured, server configuration includes the
selected management role's Discord ID. Topic configuration can separately store
an optional notification role's Discord ID to mention it when a saved quiz starts.
Notification role IDs are not included in AI requests.
The selected management role is separate from this notification setting.
The bot uses the management role only to authorize
management actions and does not grant Discord server permissions.
Server configuration can also store an administrator-selected timezone for
schedules and daily limits. This value is not inferred from member locations.
Random-channel configuration stores allowed channel IDs per server. These settings
restrict where random quizzes can be started. They do not block individual voters.
New quizzes use Discord buttons; Dilemma stores the current selection and settles
it after closure. Legacy native Discord polls continue to use finalized answers
from Discord. Discord user IDs and votes are not sent to the AI provider.

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
To request deletion of your stored player data, contact the bot operator as
described below. Previously published aggregate counts remain with the quiz record.
User IDs and votes are not sent to the AI provider for quiz generation.
The operator may delete stored server data by
removing the bot and deleting its database records. Retention depends on the
operator's database and hosting configuration.

## Discord

Dilemma operates through Discord's platform. Discord independently processes
data under its own Privacy Policy and Terms of Service.

## Contact

For privacy questions or deletion requests, ask the bot operator for a private
contact channel through the project repository. Keep user IDs and request details
out of public issues.
https://github.com/mwazqa/Dilemma/issues
