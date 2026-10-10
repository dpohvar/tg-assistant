import unittest
from telegram_discussion_probe import discussion

def message(mid, group=1, reply=None, **fields):
    result = {'message_id': mid, 'chat': {'id': group}, **fields}
    if reply is not None:
        result['reply_to_message'] = {'message_id': reply, 'chat': {'id': group}}
    return result

def root(mid=10, group=1, channel=2, post=42):
    return message(mid, group, is_automatic_forward=True, forward_origin={'type': 'channel', 'chat': {'id': channel}, 'message_id': post})

class DiscussionTests(unittest.TestCase):
    def test_transitive_chain_with_out_of_order_messages(self):
        result = discussion([message(12, reply=11), root(), message(11, reply=10)], 1, 2, 42)
        self.assertEqual([m['message_id'] for m in result['messages']], [11, 12])

    def test_other_channel_and_group_do_not_match_same_message_id(self):
        self.assertEqual(discussion([root(channel=3), root(group=4)], 1, 2, 42), {'error': 'discussion_not_found'})

    def test_manual_forward_is_not_a_root(self):
        copied = root()
        copied.pop('is_automatic_forward')
        self.assertEqual(discussion([copied], 1, 2, 42), {'error': 'discussion_not_found'})

    def test_missing_parent_and_unrelated_replies_are_excluded(self):
        self.assertEqual(discussion([root(), message(12, reply=11), message(15, reply=99)], 1, 2, 42)['messages'], [])

    def test_empty_known_discussion_differs_from_missing_root(self):
        self.assertEqual(discussion([root()], 1, 2, 42), {'rootMessageIds': [10], 'messages': []})

    def test_cross_chat_reply_does_not_attach(self):
        comment = message(11, reply=10)
        comment['reply_to_message']['chat']['id'] = 9
        self.assertEqual(discussion([root(), comment], 1, 2, 42)['messages'], [])

if __name__ == '__main__':
    unittest.main()
