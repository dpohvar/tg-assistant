# Forum groups

A forum supergroup has one agent for the whole chat. Notes, model, context, scheduled tasks and the operational queue are shared across topics. New forums are passive until a manager, admin or owner runs `/agent start`. The bot still records received history while the agent is disabled. Converting a connected supergroup into a forum, or back, preserves its agent and data.

## Topic identity and delivery

Short message, edit and button events include `topicId` in forums. General is normalized to `1`. Other topic IDs are Telegram message-thread IDs. Full `read()` retains native message fields, including `message_thread_id` when supplied by Telegram; it does not fabricate that field for General.

`send`, `copy` and `forward` accept an optional positive integer `topicId` for the destination. Source permissions and chat write permissions remain unchanged. Explicit IDs above 1 become native `message_thread_id`. General uses omission of that native parameter: sending `message_thread_id:1` is rejected by Telegram in the verified group scenario.

```javascript
await send({text: "Reply in this topic", topicId: 42,
  reply_parameters: {message_id: 123}});
await send({text: "General announcement", topicId: 1});
```

Prefer explicitly answering in the source event's topic. Without a topic or reply, Telegram sends to General. With a reply and no topic, Telegram may inherit the replied-to topic. Explicit General with a locally unknown reply or a reply to another topic is refused; remove `reply_parameters` to send safely to General. Explicit non-General topics permit cross-topic replies. In such a reply, the requested original may appear in `external_reply`, while `reply_to_message` refers to the destination topic's creation message.

There is no automatic retry or General fallback. A closed, deleted or inaccessible topic can return a Telegram error. An agent may decide to send in General without reply. An explicitly selected topic is rejected when the chat is currently known to have forum mode disabled. Unknown registry membership alone does not prevent sending.

Command replies, documents and syntax errors stay in the invoking topic and retain their reply relationship. Agent and task failure notifications go to General without reply. Tasks belong to the agent; their instructions should specify the desired destination topic. Editing, deleting, pinning and reacting use the existing chat/message IDs.

A single copied message reconstructed with an unavailable reply may have an unknown destination. Its saved record includes `topicUnknown:true`; it remains visible in unfiltered history and cannot establish a safe General reply. Topic-filtered queries omit this uncertain record.

## Observed topic registry

`topics({chatId?})` uses the same read permissions as history and defaults to the current chat:

```json
{"enabled":true,"topics":[
  {"topicId":1,"name":"General","closed":false,"hidden":false},
  {"topicId":42,"name":"Projects"},
  {"topicId":57,"name":null}
]}
```

Results are ordered by numeric ID. Unknown states are omitted; `hidden` applies only to General. Names become known through creation or rename events, including a one-level embedded creation message Telegram supplies with an existing topic. A bot added after topic creation may initially know only its ID. Embedded names describe the original creation; newer observed renames take precedence. General uses its known renamed name or the fallback `General`.

This is a last-observed registry, not a complete current Telegram catalog. Bot API has no complete topic-list request or topic-deleted update. A failed send does not mark a topic deleted. Closing General hides neither its identity nor its history; hiding it also closes it. Reopening unhides it, while unhiding alone does not reopen it.

Topic service events update saved history and the registry without triggering the agent or consuming loud-mode allowances or queue capacity. Registry entries survive history retention, agent stop/clear, and forum-mode changes. Leaving or deleting the chat removes them. `enabled` is last-observed forum mode. Client Tabs/List and View as messages layouts do not change controller routing; there is no separate bot destination for All.

## History and listening

`history` and `search` accept `topicId`, including when forum mode is currently disabled. Filtering happens before history slicing, and an explicit anchor must belong to the selected topic. Search continuation uses its cursor alone. No topic filter preserves whole-chat behavior. A topic-1 filter also includes ordinary messages without forum affiliation, including messages received while forum mode was off. Ordinary channel-discussion thread IDs do not become forum topic IDs.

Each topic has independent two-minute / ten-message loud mode and pending `historyGap`. An assembled album counts once in its topic. All topics still share the ten-event operational queue, including button events. Scheduler and interagent events retain their separate treatment. A gap is reported only on a suitable event in its topic, including multiple hints when a batch spans topics.

On forum disable, topic loud timers reset and pending gaps merge into one ordinary-chat gap. On re-enable, an ordinary loud bucket or gap moves to General. Model context is preserved. To refresh an existing model session with the new tool descriptions and developer instructions after upgrading, use `/agent clear` or administrator `/agent clear *`.

Topic administration tools and private-chat topic mode are outside this feature. See [agent contract](agent-contract.md), [message events](message-events.md) and [messaging](messaging.md).
