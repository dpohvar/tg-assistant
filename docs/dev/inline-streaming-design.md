# Incremental inline results

Accepted design for the next inline iteration. This file describes the agreed change; the wiki describes the implementation.

- Extend `set_inline_results({requestId, results, done=true})`. Every accepted call appends a fully validated portion; `done:true` closes input, not delivery. Calls after input closes return `already_set` without normalization. No batch IDs or deduplication: a repeated nonfinal portion may appear twice.
- Friendly results without `message` are status cards: title and optional description, selectable as neutral `✖️`. Native media are not status cards. The controller adds `⬇️ ` to status titles at delivery when more items remain or input is open; the last item of a closed stream has no added arrow. Agent guidance: during long work append intermediate reports without arrows.
- Accepted portions retain their order. Existing photo-last normalization applies inside each portion only. Photo and nonphoto items never share a page, including the photo-to-text boundary between portions. Each page has at most 50 items.
- Ready items take precedence over waiting. With no ready items and input open, retain the existing 5-second wait, waking early for an appended portion or completion. Finishing a model turn does not close input. Empty nonfinal portions do not wake waiting pages.
- Empty completion emits Work complete only when no items were ever accepted. Otherwise drain or close with an empty terminal page; do not add a redundant placeholder.
- Assign fresh wire result IDs once per accepted item. Serialize pagination per request; replaying a cursor yields its original page, IDs, next offset and buttons without new registry writes. Replays do not re-enqueue the agent or refresh issuance timestamps.
- Preserve the 2-second trigger, 6/6/20 prompt scale, avatar preview, 1-hour original TTL, RAM-only lifecycle, cancellation/ownership checks, no inline uploads, explicit buffer provenance and database/Telegram failure policy. Clear queued content and replay pages on close.
- Live checks remain separate from automated verification: status/photo/wait/photo, immediate ready portions, final empty completion and selecting photo results on Desktop/Android.

No new agent/widget/private messaging capabilities, database migration or dependencies are needed. After automated and live acceptance, the user separately authorized committing and pushing the completed feature to main. The native follow-up also clarified the existing ordinary-media send instructions without changing its payload contract.
