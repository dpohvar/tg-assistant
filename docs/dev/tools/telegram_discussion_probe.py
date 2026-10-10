"""Discussion lookup over captured top-level Bot API messages, not a DB implementation."""
import json
import pathlib

def discussion(messages, group_id, channel_id, post_id):
    index = {m['message_id']: m for m in messages if m['chat']['id'] == group_id}
    roots = set()
    for mid, message in index.items():
        origin = message.get('forward_origin', {})
        if message.get('is_automatic_forward') and origin.get('type') == 'channel' and origin.get('chat', {}).get('id') == channel_id and origin.get('message_id') == post_id:
            roots.add(mid)
    if not roots:
        return {'error': 'discussion_not_found'}
    reached = set(roots)
    while True:
        added = set()
        for mid, message in index.items():
            reply = message.get('reply_to_message', {})
            if mid not in reached and reply.get('message_id') in reached and reply.get('chat', {}).get('id', group_id) == group_id:
                added.add(mid)
        if not added:
            break
        reached.update(added)
    return {'rootMessageIds': sorted(roots), 'messages': [index[mid] for mid in sorted(reached - roots)]}

if __name__ == '__main__':
    root = pathlib.Path(__file__).resolve().parents[1]
    rows = [json.loads(line) for line in (root / '.runtime-check/telegram-results.jsonl').read_text(encoding='utf8').splitlines()]
    messages = []
    for row in rows:
        if row['method'] == 'getUpdates' and row['response'].get('ok'):
            for update in row['response']['result']:
                message = update.get('message') or update.get('edited_message')
                if message:
                    messages.append(message)
    result = discussion(messages, -1004380172914, -1003976446953, 2)
    (root / '.runtime-check/telegram-discussion-analysis.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf8')
    print(json.dumps({'rootMessageIds': result.get('rootMessageIds'), 'error': result.get('error'), 'comments': [{'messageId': m['message_id'], 'replyTo': m.get('reply_to_message', {}).get('message_id'), 'threadId': m.get('message_thread_id'), 'text': m.get('text')} for m in result.get('messages', [])]}, ensure_ascii=False))
