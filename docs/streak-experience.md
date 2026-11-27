# Streak EXP

A correct final answer earns additional EXP for consecutive correct answers on the same server:

| Correct answer in the streak | Bonus EXP |
| --- | ---: |
| First | 0 |
| Second | 0 |
| Third | 5 |
| Fourth | 10 |
| Fifth | 15 |
| Sixth | 20 |
| Seventh | 25 |
| Eighth | 30 |
| Ninth | 35 |
| Tenth and later | 40 |

Wrong answers reset the streak. Missing or withdrawn votes do not change it. Difficulty, help purchases and bet stakes do not multiply the streak bonus.

The bonus is added to `UserScore.exp` and recorded on `QuizAnswer.streakExp` in the same serializable transaction as base EXP, wallet awards and bet payouts. Levels, badges and the leaderboard include this EXP. The combined answer and bonus can unlock the normal five Sparks for each newly reached level. The private result displays the recorded bonus in Polish or English.

Each answer uses history up to its own finish position, ordered by finish time and message ID. For button quizzes this also includes final votes in earlier closed quizzes awaiting settlement, so simultaneous or delayed workers award the same streak bonus. An older answer cannot use a later answer's streak. Active quizzes and withdrawn votes are excluded. Legacy native polls use known settled history because their pending voter lists are held by Discord.

Awards are immutable: delayed legacy settlements do not recalculate EXP already awarded to other answers. This prevents later changes from taking back spent level rewards. Existing answers can continue a streak, but already settled answers keep zero streak EXP after migration. Replaying a settlement cannot award any bonus again.

Apply `20261118140000_streak_experience` before `20261126120000_experience_ranking` on both database providers. The ranking migration converts the previously earned EXP into the new total.
