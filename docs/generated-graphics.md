# Generated graphics

Dilemma creates two standalone image attachments during normal bot operation. Both are rendered locally with SVG/text and Sharp. AI generates quiz text, not images. Runtime images stay in memory until they are attached to a Discord message; the bot does not save them as application files.

## Discord attachments

| Graphic | Where it is rendered | When it is rendered | Output |
| --- | --- | --- | --- |
| Quiz card | [`renderQuizCard`](../src/services/quiz-card.ts), called by [`quizVotingPayload`](../src/services/quiz-voting.ts) | Once when publishing a new `/dilemma random` quiz, a scheduled topic question or an early `/dilemma run` question | `quiz.png`, 1400 px wide, height fitted to the question and 2-4 answer choices |
| Player profile card | [`renderScoreCard` / `scoreCardSvg`](../src/services/score-card.ts), called by [`handleScore`](../src/commands/score.ts) | On each `/dilemma score profile` request, for the invoking player or the selected user | `quiz-profile.png`, 1120 x 560 px |

Quiz cards show the question, answer choices and the initial voting duration. Their clock is static; it is neither a live countdown nor the cooldown until another random quiz. Clicking an answer, opening a private panel or finishing the quiz does not redraw the card. New renders are needed to change an already-published card's appearance.

Quiz publishing uses text when attachment permission is missing. Both cards have a text fallback on rendering failure. Existing Discord attachments keep their original appearance after a code update.

## Components drawn inside the cards

| Component | Source | When it appears |
| --- | --- | --- |
| Six achievement badge designs | [`achievementIcon`](../src/services/achievement-icons.ts) | While rendering a profile with selected badges; at most three designs are included in that profile image |
| First-answer badge | `first_answer` | Selected achievement for the first settled answer |
| Correct-answer badge | `correct_10` | Selected achievement for 10 correct answers |
| Participation badge | `answers_100` | Selected achievement for 100 answered quizzes |
| Streak badge | `streak_10` | Selected achievement for a streak of 10 correct answers |
| First level-up badge | `level_2` | Selected achievement for level 2 |
| Explorer badge | `level_5` | Selected achievement for level 5 |
| Player avatar or placeholder | [`loadAvatar` / `scoreCardSvg`](../src/services/score-card.ts) | On profile rendering. An allowed Discord CDN avatar is downloaded, resized to 144 x 144 px and embedded; missing or unusable avatars use a locally drawn placeholder |
| Profile decorations and statistics | [`scoreCardSvg`](../src/services/score-card.ts) | On every profile render: frame, rank badge, Sparks icon and balance, EXP bar, progress spark, answer/check/streak symbols and corner decorations |
| Quiz decorations and answer cells | [`renderQuizCard`](../src/services/quiz-card.ts) | On every quiz-card render: frame, navy background, curves, sparks, clock icon, duration badge and answer boxes |

These components are composed into the two PNG attachments. The bot does not publish separate badge, clock, balance or EXP images. Discord renders ordinary emoji separately.

## Local development and publication tools

| Graphic | Trigger | Local output |
| --- | --- | --- |
| Quiz layout previews | `node scripts/test-quiz-card.mjs --preview` | `.tools/quiz-card-preview/`: 2-, 3- and 4-answer cards, rounded versions, a long-question card and a Unicode-input card |
| Profile previews | `node scripts/test-score-card.mjs --preview` | `.tools/score-card-preview/`: normal/zero/large balances, long names, a level boundary, podium and other ranks, plus a rounded card |
| Selected-badge previews | `node scripts/test-achievements.mjs --preview` | `.tools/score-card-preview/three-badges.png` and `three-badges-long-name.png` |
| Image review contact sheet | `node scripts/image-review-sheet.mjs` | `.tools/image-review.png`; a grid of local publication candidates |
| Clean publication copy | `node scripts/prepare-image-publication.mjs <image>` | `.tools/image-publication/<input-name>.clean.png`; a checked PNG copy with metadata removed |
| Synthetic security and rendering fixtures | Image-security and card tests | Temporary/in-memory images used only by the tests, never sent by the bot |

These scripts run only when explicitly invoked, including by tests or CI. They do not create new graphics in response to normal Discord actions.

## Static artwork and native Discord views

Avatars, banners, backgrounds and their design variants in `assets/` are static files. The bot's runtime does not generate those files or load them into quiz/profile cards. Their filenames alone do not establish how or when the artwork was originally authored.

Leaderboard, achievement list, help, player guide, topic list, My answer, My result, 50/50 and private vote counts use Discord text, embeds and components. They do not generate standalone image attachments.
