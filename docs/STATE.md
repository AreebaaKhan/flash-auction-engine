# Project state

## Rules (established before implementation)

- A multi-unit ascending auction sells at most stock N items, one per distinct user.
- Keep each user's highest accepted bid. Highest N users win, paying their own bid.
- Amounts are integer minor units (paise); UI displays PKR. Range: 1 to 1,000,000,000.
- startingPrice and minIncrement are positive integer minor units. Stock is 1–100.
- Every bid is at least startingPrice. A returning user must raise their own previous
  accepted bid by minIncrement. When there are at least N positions, every bid must
  also reach the current Nth-highest amount + minIncrement. This includes incumbents.
- Before N distinct bidders exist, equal bids by different users are permitted.
  Ties rank by the earlier accepted position version, then user ID.
- Only the server clock controls deadlines. A bid at or after endsAt is rejected.
- A valid bid in the last 10 seconds adds 10 seconds to endsAt, at most five times.
  These values are configurable. Each accepted bid increments the auction version;
  creation starts at version 1 and finalization increments it once.
- Bid idempotency is scoped by auction/user/key and survives restart. The same key
  and amount returns its original outcome; a different amount produces a conflict.
- Finalization produces immutable orders once, including when a server restarts
  after an auction deadline. There are no payments or external fulfillment.
- Demo login intentionally allows selecting a mock identity, including admin.
  This is a local teaching prototype, not production authentication.

## Progress

Implementation in progress. No execution results claimed yet.
