# General player guide and release news

`/dilemma guide publish` publishes a general PL/EN introduction to playing quizzes, without changing prices, rewards or quotas. It has no Refresh button. The command still requires Manage Server or the configured Dilemma manager role. Publishing registers its channel for future release news. Several guide messages on the same channel still produce one announcement per release.

`GuidePublication` records guide messages. `GuideReleaseNotice` records the delivery of each channel/version pair. New publications start with the current version as their baseline and receive subsequent releases. Imported legacy guides receive the first release announcement for this feature as well.

At startup, the bot resumes its saved publications and discovers old guides on accessible server channels and threads. Discovery reads history in pages of 100 messages and recognizes only this bot's public messages with the old `guide:refresh` button. User message bodies are not inspected or stored. Only the guide identity and pagination cursor are persisted. Public archived threads and readable private archived threads are enumerated in bounded, resumable pages; private threads outside the bot's permissions cannot be discovered. The bot does not explicitly change archive or thread membership state.

Each legacy guide is converted once to the current general text and its Refresh button is removed. Migration resumes after restarts or temporary failures. Missing or mismatched messages are deactivated rather than edited. A stale legacy button can also complete this conversion when clicked; no new guide includes that button. Ordinary release announcements never edit the guide message.

Announcements are sent by the bot on the server, after the GitHub release for the running version is public. No Codex automation or AI summary is used. The channel's current server language determines the PL/EN announcement text. A restart checks receipts and skips completed deliveries. Unpublished versions wait, temporary Discord failures retry with backoff, and deleted channels are deactivated. Stable nonces protect immediate retries; Discord retains nonce protection for a limited window, so a process crash after sending and before the database commit can still cause a later duplicate.

Announcements contain only significant changes for players: new capabilities, game rules, command changes, visual changes and major fixes that affect playing. Keep them short. Minor wording and translation edits, refactors, tests, infrastructure and owner-only maintenance belong in the full GitHub release notes. Removing a redundant phrase from a report confirmation does not warrant a guide-channel announcement.

If there are no significant player changes, review the release and leave both language lists empty. Once the GitHub release is public, the bot records the channel/version as processed without sending a message. The receipt has `deliveredAt` set and a null `messageId`, so restarts do not retry the quiet release. Existing receipts and historical announcement text stay unchanged. No additional database migration is required for this behavior.

Before each release:

1. Review the general guide and run `npm run guide:sync` and `npm run test:guide`.
2. Update the version and review both PL/EN lists in `src/player-release.ts`. Include only significant player changes, or leave both lists empty if none qualify. Do not add filler to justify an announcement. Tests require the version to match `package.json` and both languages to have highlights or both to be empty.
3. Run `npm run test:guide:postgres`, include the guide/publication migration in the normal backup and deployment procedure, and register commands when their descriptions change.
4. Publish the GitHub release after production verification. The running bot then delivers its queued announcements. Check delivery receipt counts and pending legacy migrations without printing guild/channel IDs or message content.

The migration `20261117160000_guide_release_updates` adds only the guide publication, discovery and announcement receipt tables. It does not alter quiz history, wallets, results or report-review data.
