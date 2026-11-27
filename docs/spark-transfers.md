# Player Spark transfers

`/dilemma sparks transfer user:<player> amount:<whole number>` sends the invoking player's Sparks to another current member of the same server. The minimum is one Spark and there is no fee. The sender can spend only their own available balance. Self-transfers, bot accounts, non-members, invalid amounts and recipient wallet overflow are rejected.

The command checks recipient membership before entering the database transaction. The private confirmation goes only to the sender, with mentions disabled. The command does not send DMs to the recipient or publish a public receipt.

Both wallets and a `SparkTransfer` receipt are written in one serializable transaction, using the shared wallet retry helper. Wallets are locked in a stable user-ID order. Retrying the same interaction returns its original receipt; changing the sender, recipient, amount or server of a replay is rejected. Transfers only move Sparks between wallets. A recipient without a profile gets a wallet with the normal zero-stat defaults.

Transfer receipts are retained to prevent the same interaction from moving Sparks again. Player commands cannot reset a profile or clear these receipts. A repeated transfer request returns its original receipt without changing either wallet again.

Before release, apply the additive `20261118120000_spark_transfers` migration, regenerate Prisma and re-register Discord commands. Run `npm run test:spark-transfer:postgres` against a disposable database with synthetic fixtures. Review the PL/EN guide and prepare bilingual release highlights using the final release version. No migration or command registration is applied to production during local development.
