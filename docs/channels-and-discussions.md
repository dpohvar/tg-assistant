# Channels and discussions

Channels are passive: the bot records received publications and known reactions, but creates no channel agent and processes no commands there. Groups and non-forum supergroups can be passive or have an enabled agent. A comment supergroup can stay passive while another chat's agent analyzes it.

## Publishing through a management chat

Use an enabled private chat or group as the management agent. Its tasks can generate posts, publish to a connected passive channel, inspect reactions/comments, and save lessons in the shared workspace. Several managers can coordinate in one management group without switching a private conversation between agents.

There is no special channel-to-management binding. All agents of a bot share access to its connected non-private history. Cross-chat message operations may target passive supergroups/channels, but cannot bypass an enabled agent in another chat. For isolated publishing, use a separate bot with its own management group.

`chats` lists connected groups, supergroups, channels, and the caller's own private chat. `chat_info` returns allowed metadata such as `linked_chat_id`, photo, reaction policy, member count, and bot status when available. Administrator `/chat list` provides chat IDs for management. See [commands](commands.md) and [agent contract](agent-contract.md).

Callback buttons are not interactive in passive destinations; the controller does not reroute them to the source agent. URL buttons do not create callbacks. Forwarded/copied rich callback buttons become disabled by Telegram; forwarding does not preserve a usable lower inline callback keyboard. See [messaging](messaging.md).

## Reading comments in one call

Use `search` or `history` with the discussion supergroup as the outer `chatId` and the original channel publication as `discussion`:

```json
{
  "chatId":-100789,
  "discussion":{"chatId":-100456,"messageId":42},
  "text":["funny"],
  "limit":20
}
```

The controller checks read access to both connected chats. It finds the saved automatic forward in the supergroup using:

- `is_automatic_forward: true`;
- `forward_origin.type: "channel"`;
- `forward_origin.chat.id` equal to the source channel ID;
- `forward_origin.message_id` equal to the source publication ID.

The forwarded copy has its own supergroup message ID. The controller recursively collects messages whose `reply_to_message.message_id` belongs to the discovered branch. `message_thread_id` equal to the known root also associates a message with it. The root itself is excluded. Search filters are applied after branch discovery, so a filtered intermediate reply does not truncate traversal.

Channel and supergroup message IDs are separate namespaces; a publication ID alone is insufficient. The saved forward origin identifies old discussions even if the currently linked channel changes. A manual forward is not a discussion root.

## Completeness and reactions

Only messages received by this service can be searched. There is no Bot API operation to fetch arbitrary past history. Saved history expires after 30 days from first receipt. An expired root causes `discussion_not_found`; missing intermediate replies can make a branch incomplete. An available root with no known comments yields an empty result. No completeness flag promises a full discussion archive.

Reaction updates are saved without triggering the agent. Count-only channel updates can arrive later than individual reactions and do not reveal users. Agents read the known snapshot through `read`; missing reaction data is unknown, not proof of zero votes. Telegram permissions and delivered update types determine visibility.

## Chat lifecycle

manager/admin/owner may add the bot to these chats. New groups and supergroups are passive; channels always stay passive. `/agent start` enables a non-forum group/supergroup. Basic-group migration preserves agent, history, notes, tasks, triggers, and enabled state under the new supergroup ID.

Leaving/removal deletes the affected chat's saved data. Tasks in a separate management chat remain even when their target channel disappears; their next action can fail and should be handled by the agent. Lost posting permission produces a tool error rather than a separate owner notification. Forum groups are rejected, including conversion of an existing group into a forum.
