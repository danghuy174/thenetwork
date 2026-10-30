# Leak guard shared sensitive facets — 30 October 2026

When multiple members share a sensitive term (such as `"divorce"`, `"sober"`, `"gay"`, or `"jewish"` from `SENSITIVE_WORDS`) in their `agent_private` facets, `LeakGuard` indexes them into a single `Entry` with `e.owners = Set(["a", "b"])`.
In `LeakGuard.check`, `counts(e)` checked:
`[...e.owners].some(x => x === undefined || x !== o.exceptOwner)`.
Because another member also owned the sensitive term, `x !== o.exceptOwner` evaluated to `true`, causing `LeakGuard` to hold or block the sender's own words about themselves as a leak violation.

In relayed communications, `ConsentNetwork.guardCheck` called `guard.check` separately for `recipient` and `alsoOwner` (sender), and took the intersection. Because both calls flagged the shared term, the relayed message was blocked.

## Root cause and fix

1. `packages/core/src/guard.ts`:
   - `check` now resolves `exempt = o.exceptOwners !== undefined ? new Set(o.exceptOwners) : o.exceptOwner !== undefined ? new Set([o.exceptOwner]) : undefined`.
   - `counts(e)` now checks:
     ```typescript
     const counts = (e: Entry) => {
       if (e.owners.has(undefined)) return true;
       if (!exempt) return true;
       return ![...e.owners].some(x => x !== undefined && exempt.has(x));
     };
     ```
     An entry counts as a leak only if it contains an unowned fact (`undefined`), if no owners are exempt, or if none of its owners match the exempt set. When an entry's owner is in `exempt`, the owner's own fact passes. Specific n-grams, phrases, and facts belonging only to other members have distinct `e.owners` sets and remain protected.
   - `checkThread` and `findLeaks` now forward `exceptOwner` and `exceptOwners`.

2. `packages/network/src/network.ts`:
   - `ConsentNetwork.guardCheck` passes `exceptOwners: alsoOwner === undefined ? (recipient ? [recipient] : []) : [recipient, alsoOwner]`.

3. **Why combining exemptions in `guardCheck` cannot let a third member's private data reach the recipient:**
   - In a 1-to-1 conversation between `alsoOwner` (sender) and `recipient`:
     - If a fact is owned by `alsoOwner`, it is the sender's own information;
     - If a fact is owned by `recipient`, it is the recipient's own information;
     - If a third member `c` shares a generic sensitive word (such as `"divorce"` or `"sober"`), the sender using that word in reference to themselves reveals nothing about `c` (no identifier, no context, no third-party association);
     - If third member `c` has a specific unique phrase, n-gram, or multi-word fact (e.g. `"going through a divorce with Bob"`), that specific phrase entry has `e.owners = Set(["c"])`. Since neither `alsoOwner` nor `recipient` is in `Set(["c"])`, `counts(e)` evaluates to `true` and the message is blocked/held;
     - Any unowned canary or global forbidden string has `owner: undefined`, so `e.owners.has(undefined)` returns `true` unconditionally regardless of any exempted owners.

## Reproduction and verification

Base: `2b3ad75` on branch `fix/leak-guard-shared-facet-relay`.
Bun 1.4.4 on Windows 11, local PostgreSQL 16 on port 54339.

```sh
bun run sim --only relay
bun run sim --only evals
bun run sim
bun run typecheck
bun run test:integration
bun run test:e2e
```

### Before fix (with regression assertions in `scripts/sim/relay.ts`, `scripts/sim/evals.ts`, and `evals/guard/leaks.jsonl`):
- `bun run sim --only relay`: `FAIL [relay] relay: private facts, canaries, ratings and scores never pass; the sender's own words about themselves do: expected "hold" to be "pass"` (59/60 blocking gates pass).
- `bun run sim --only evals`: `FAIL [evals] leak guard (n 134): evasions caught, benign text clean: clean: "full disclosure, I was divorced in 2021" (shared sensitive term allowed for owner)` (24/25 blocking gates pass).

### After fix:
- `bun run sim --only relay`: `PASS: 60/60 blocking gates pass, 4 tracked off target (0.7s)`.
- `bun run sim --only evals`: `PASS: 25/25 blocking gates pass, 0 tracked off target (0.3s)`.
- `bun run sim --only audit`: `PASS: 16/16 blocking gates pass (55.3s)`.
- `bun run sim`: `PASS: 327/327 blocking gates, 15 tracked off target, 363.4s` (all gates in evals, onboard, network, slop, relay, peon, peon-seats, friends, clef, safety, ops, pipeline, audit pass).
- `bun run typecheck`: exit code 0.
- `bun run test:integration`: 589 pass, 8 skip, 10 fail (10 failures on Windows are pre-existing CRLF in `sites/` / #177, contract mirror upstream drift, and Cloudflare wrangler environment; 0 failures in core or leak guard).
- `bun run test:e2e`: 0 pass, 1 skip, 2 fail (pre-existing Windows CRLF in `sites/` / #177; unchanged from main).

Provider/model: google / gemini-3.8-flash, client antigravity.
Deterministic logic, zero model calls. No UI or copy files changed.
