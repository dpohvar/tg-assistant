"""Bounded live Bot API probe. Token is read from an ignored local file."""
import json
import pathlib
import sys
import urllib.request
import urllib.error
import time
import hashlib
import struct
import zlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
TEMP = ROOT / '.runtime-check'
TOKEN = (TEMP / 'telegram-token.txt').read_text().strip()
RESULTS = TEMP / 'telegram-results.jsonl'

def api(method, payload=None):
    request = urllib.request.Request('https://api.telegram.org/bot' + TOKEN + '/' + method,
        data=json.dumps(payload or {}).encode(), headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=40) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        result = json.loads(error.read())
    except Exception as error:
        result = {'ok': False, 'description': type(error).__name__}
    with RESULTS.open('a', encoding='utf8') as output:
        output.write(json.dumps({'method': method, 'receivedAt': time.time(), 'request': payload, 'response': result}, ensure_ascii=False) + '\n')
    return result

def multipart(method, payload, files):
    boundary = 'tg_assistant_probe_boundary'
    chunks = []
    for key, value in payload.items():
        value = json.dumps(value) if isinstance(value, (dict, list)) else str(value)
        chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode())
    for key, (name, data, mime) in files.items():
        chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"; filename="{name}"\r\nContent-Type: {mime}\r\n\r\n'.encode() + data + b'\r\n')
    chunks.append(f'--{boundary}--\r\n'.encode())
    request = urllib.request.Request('https://api.telegram.org/bot' + TOKEN + '/' + method, data=b''.join(chunks), headers={'Content-Type': 'multipart/form-data; boundary=' + boundary})
    try:
        with urllib.request.urlopen(request, timeout=40) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        result = json.loads(error.read())
    except Exception as error:
        result = {'ok': False, 'description': type(error).__name__}
    with RESULTS.open('a', encoding='utf8') as output:
        output.write(json.dumps({'method': method, 'request': payload, 'uploads': {key: {'name': v[0], 'bytes': len(v[1])} for key, v in files.items()}, 'response': result}, ensure_ascii=False) + '\n')
    return result

def fixture_photo(color=(40, 140, 220)):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    pixels = b''.join(b'\x00' + bytes(color) * 320 for _ in range(200))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 320, 200, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b'')

if __name__ == '__main__':
    mode = sys.argv[1]
    if mode == 'poll':
        result = api('getUpdates', {'timeout': 20, 'allowed_updates': ['message', 'edited_message', 'my_chat_member', 'callback_query', 'message_reaction', 'message_reaction_count', 'channel_post']})
        for update in result.get('result', []):
            item = update.get('message') or update.get('my_chat_member') or update.get('callback_query', {}).get('message') or {}
            print(json.dumps({'updateId': update['update_id'], 'chat': item.get('chat'), 'event': [k for k in update if k != 'update_id']}, ensure_ascii=False))
    elif mode == 'initial':
        text = api('sendMessage', {'chat_id': 114772672, 'text': 'Telegram-стенд: текст с <b>форматированием</b> и <code>кодом</code>.', 'parse_mode': 'HTML'})
        if text.get('ok'):
            msg = text['result']['message_id']
            api('editMessageText', {'chat_id': 114772672, 'message_id': msg, 'text': 'Telegram-стенд: <b>текст отредактирован</b>.', 'parse_mode': 'HTML'})
            api('sendMessage', {'chat_id': 114772672, 'text': 'Тест reply.', 'reply_parameters': {'message_id': msg}})
        rich = api('sendRichMessage', {'chat_id': 114772672, 'rich_message': {'html': '<h2>Telegram-стенд</h2><p>Rich и inline-кнопки в одном сообщении.</p><tg-button-row><tg-button type="callback_data" data="[probe]rich">⬜️ Rich</tg-button></tg-button-row>'}, 'reply_markup': {'inline_keyboard': [[{'text': '⬜️ Inline', 'callback_data': '[probe]inline'}]]}})
        print(json.dumps({'textOk': text.get('ok'), 'richOk': rich.get('ok'), 'richError': rich.get('description'), 'richMessageId': rich.get('result', {}).get('message_id')}, ensure_ascii=False))
    elif mode == 'automatic':
        chat = 114772672
        cases = []
        def check(method, payload):
            result = api(method, payload)
            cases.append({'method': method, 'ok': result.get('ok'), 'description': result.get('description')})
            return result
        original = check('sendRichMessage', {'chat_id': chat, 'rich_message': {'html': '<h2>Автотест</h2><p>Проверка редактирования, disabled, copy и forward.</p>'}, 'reply_markup': {'inline_keyboard': [[{'text': 'Неактивная кнопка', 'disabled': {}}]]}})
        if original.get('ok'):
            msg = original['result']['message_id']
            check('editMessageText', {'chat_id': chat, 'message_id': msg, 'rich_message': {'blocks': [{'type': 'paragraph', 'text': 'Rich изменён структурированным JSON.'}, {'type': 'buttons', 'buttons': [{'text': 'Неактивная rich-кнопка', 'disabled': {}}]}]}})
            copied = check('copyMessage', {'chat_id': chat, 'from_chat_id': chat, 'message_id': msg, 'reply_parameters': {'message_id': 8}, 'reply_markup': {'inline_keyboard': [[{'text': 'Кнопка копии', 'callback_data': 'copy_probe'}]]}})
            check('forwardMessage', {'chat_id': chat, 'from_chat_id': chat, 'message_id': msg})
        print(json.dumps(cases, ensure_ascii=False))
    elif mode == 'groups':
        rows = [json.loads(line) for line in RESULTS.read_text(encoding='utf8').splitlines()]
        chats = {r['response']['result']['id']: r['response']['result'] for r in rows if r['method'] == 'getChat' and r['response'].get('ok')}
        summary = []
        for chat in chats.values():
            cid = chat['id']
            msg = api('sendMessage', {'chat_id': cid, 'text': 'Telegram-стенд: отправка, reply, pin/unpin, реакция и удаление тестового сообщения.'})
            if not msg.get('ok'):
                continue
            mid = msg['result']['message_id']
            for method, payload in [
                ('sendMessage', {'chat_id': cid, 'text': 'Reply на тестовое сообщение.', 'reply_parameters': {'message_id': mid}}),
                ('pinChatMessage', {'chat_id': cid, 'message_id': mid, 'disable_notification': True}),
                ('getChat', {'chat_id': cid}),
                ('unpinChatMessage', {'chat_id': cid, 'message_id': mid}),
                ('setMessageReaction', {'chat_id': cid, 'message_id': mid, 'reaction': [{'type': 'emoji', 'emoji': '👍'}]}),
                ('sendChatAction', {'chat_id': cid, 'action': 'typing'}),
                ('sendChatAction', {'chat_id': cid, 'action': 'upload_photo'}),
            ]:
                result = api(method, payload)
                summary.append({'chat': chat['title'], 'method': method, 'ok': result.get('ok'), 'error': result.get('description')})
            disposable = api('sendMessage', {'chat_id': cid, 'text': 'Временный тест удаления.'})
            if disposable.get('ok'):
                result = api('deleteMessage', {'chat_id': cid, 'message_id': disposable['result']['message_id']})
                summary.append({'chat': chat['title'], 'method': 'deleteMessage', 'ok': result.get('ok')})
        content = b'Telegram multipart and download fixture.\n'
        uploaded = multipart('sendDocument', {'chat_id': 114772672, 'caption': 'Проверка multipart и точности скачивания.'}, {'document': ('telegram-probe.txt', content, 'text/plain')})
        if uploaded.get('ok'):
            file = api('getFile', {'file_id': uploaded['result']['document']['file_id']})
            if file.get('ok'):
                data = urllib.request.urlopen('https://api.telegram.org/file/bot' + TOKEN + '/' + file['result']['file_path'], timeout=40).read()
                summary.append({'method': 'downloadDocument', 'sha256Matches': hashlib.sha256(data).digest() == hashlib.sha256(content).digest()})
        photo = fixture_photo()
        result = multipart('sendMediaGroup', {'chat_id': 114772672, 'media': [{'type': 'photo', 'media': 'attach://p1', 'caption': 'Тестовый альбом'}, {'type': 'photo', 'media': 'attach://p2'}]}, {'p1': ('one.png', photo, 'image/png'), 'p2': ('two.png', photo, 'image/png')})
        summary.append({'method': 'sendMediaGroup', 'ok': result.get('ok'), 'count': len(result.get('result', []))})
        print(json.dumps(summary, ensure_ascii=False))
    elif mode == 'rich-media':
        photo = fixture_photo()
        rich = {'html': '<h2>Rich: вложения и карусель</h2><p>Текст перед фото.</p><img src="tg://photo?id=one"/><p>Текст между вложениями.</p><tg-slideshow><img src="tg://photo?id=one"/><img src="tg://photo?id=two"/></tg-slideshow><tg-button-row><tg-button type="url" url="https://telegram.org">Telegram</tg-button><tg-button type="copy_text" text="rich copy probe">Копировать</tg-button></tg-button-row>', 'media': [{'id': 'one', 'media': {'type': 'photo', 'media': 'attach://p1'}}, {'id': 'two', 'media': {'type': 'photo', 'media': 'attach://p2'}}]}
        result = multipart('sendRichMessage', {'chat_id': 114772672, 'rich_message': rich}, {'p1': ('one.png', photo, 'image/png'), 'p2': ('two.png', photo, 'image/png')})
        print(json.dumps({'ok': result.get('ok'), 'description': result.get('description'), 'messageId': result.get('result', {}).get('message_id'), 'blockTypes': [b['type'] for b in result.get('result', {}).get('rich_message', {}).get('blocks', [])]}, ensure_ascii=False))
    elif mode == 'extended':
        summary = []
        source = api('sendRichMessage', {'chat_id': 114772672, 'rich_message': {'html': '<h2>Активные кнопки: оригинал</h2><tg-button-row><tg-button type="callback_data" data="rich_active">Rich action</tg-button></tg-button-row>'}, 'reply_markup': {'inline_keyboard': [[{'text': 'Inline action', 'callback_data': 'inline_active'}]]}})
        if source.get('ok'):
            mid = source['result']['message_id']
            for method in ('forwardMessage', 'copyMessage'):
                result = api(method, {'chat_id': 114772672, 'from_chat_id': 114772672, 'message_id': mid})
                summary.append({'method': method, 'ok': result.get('ok'), 'rich': result.get('result', {}).get('rich_message'), 'keyboard': result.get('result', {}).get('reply_markup'), 'messageId': result.get('result', {}).get('message_id')})
            result = api('editMessageReplyMarkup', {'chat_id': 114772672, 'message_id': mid, 'reply_markup': {'inline_keyboard': [[{'text': 'Inline изменена отдельно', 'callback_data': 'inline_edited', 'style': 'primary'}]]}})
            summary.append({'method': 'editMessageReplyMarkup', 'ok': result.get('ok'), 'richRetained': bool(result.get('result', {}).get('rich_message')), 'keyboard': result.get('result', {}).get('reply_markup')})
        for value in ('a' * 64, 'a' * 65, 'я' * 32, 'я' * 33):
            result = api('sendMessage', {'chat_id': 114772672, 'text': 'Проверка границы callback_data.', 'reply_markup': {'inline_keyboard': [[{'text': 'Тест лимита', 'callback_data': value}]]}})
            summary.append({'method': 'sendMessage', 'callbackBytes': len(value.encode()), 'ok': result.get('ok'), 'description': result.get('description')})
            if result.get('ok'):
                api('deleteMessage', {'chat_id': 114772672, 'message_id': result['result']['message_id']})
        print(json.dumps(summary, ensure_ascii=False))
    elif mode == 'album':
        rows = [json.loads(line) for line in RESULTS.read_text(encoding='utf8').splitlines()]
        messages = {}
        batches = []
        for row in rows:
            if row['method'] != 'getUpdates' or not row['response'].get('ok'):
                continue
            album = [u['message'] for u in row['response']['result'] if u.get('message', {}).get('media_group_id')]
            if album:
                batches.append([m['message_id'] for m in album])
                messages.update({(m['chat']['id'], m['message_id']): m for m in album})
        summary = []
        for (_, mid), message in messages.items():
            size = max(message['photo'], key=lambda p: p['width'] * p['height'])
            file = api('getFile', {'file_id': size['file_id']})
            if not file.get('ok'):
                summary.append({'messageId': mid, 'error': file.get('description')})
                continue
            try:
                with urllib.request.urlopen('https://api.telegram.org/file/bot' + TOKEN + '/' + file['result']['file_path'], timeout=40) as response:
                    data = response.read()
                (TEMP / f'telegram-album-{mid}.jpg').write_bytes(data)
                summary.append({'messageId': mid, 'albumId': message['media_group_id'], 'width': size['width'], 'height': size['height'], 'bytes': len(data), 'jpeg': data.startswith(b'\xff\xd8'), 'sha256': hashlib.sha256(data).hexdigest()})
            except Exception as error:
                summary.append({'messageId': mid, 'error': type(error).__name__})
        report = {'batches': batches, 'downloads': summary}
        (TEMP / 'telegram-album-analysis.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
        print(json.dumps(report, ensure_ascii=False))
    elif mode == 'channel':
        rows = [json.loads(line) for line in RESULTS.read_text(encoding='utf8').splitlines()]
        channels = {}
        for row in rows:
            if row['method'] != 'getUpdates' or not row['response'].get('ok'):
                continue
            for update in row['response']['result']:
                item = update.get('my_chat_member') or update.get('channel_post') or {}
                chat = item.get('chat', {})
                if chat.get('type') == 'channel':
                    channels[chat['id']] = chat
        summary = []
        for cid, chat in channels.items():
            info = api('getChat', {'chat_id': cid})
            member = api('getChatMember', {'chat_id': cid, 'user_id': 8322579566})
            linked = info.get('result', {}).get('linked_chat_id')
            linked_info = api('getChat', {'chat_id': linked}) if linked else {}
            post = api('sendMessage', {'chat_id': cid, 'text': 'Telegram-стенд: тестовая публикация для комментариев.'})
            result = {'chatId': cid, 'name': chat['title'], 'linkedChatId': linked, 'backLink': linked_info.get('result', {}).get('linked_chat_id'), 'botStatus': member.get('result', {}).get('status'), 'postOk': post.get('ok')}
            if post.get('ok'):
                mid = post['result']['message_id']
                result['messageId'] = mid
                for method, payload in [
                    ('editMessageText', {'chat_id': cid, 'message_id': mid, 'text': 'Telegram-стенд: публикация отредактирована. Добавьте комментарий и ответ на этот комментарий.'}),
                    ('pinChatMessage', {'chat_id': cid, 'message_id': mid, 'disable_notification': True}),
                    ('unpinChatMessage', {'chat_id': cid, 'message_id': mid}),
                    ('setMessageReaction', {'chat_id': cid, 'message_id': mid, 'reaction': [{'type': 'emoji', 'emoji': '👍'}]}),
                ]:
                    response = api(method, payload)
                    result[method] = {'ok': response.get('ok'), 'description': response.get('description')}
                disposable = api('sendMessage', {'chat_id': cid, 'text': 'Временная публикация для проверки удаления.'})
                if disposable.get('ok'):
                    deleted = api('deleteMessage', {'chat_id': cid, 'message_id': disposable['result']['message_id']})
                    result['deleteMessage'] = deleted.get('ok')
                rich = multipart('sendRichMessage', {'chat_id': cid, 'rich_message': {'blocks': [{'type': 'heading', 'text': 'Тестовая картинка в канале', 'size': 2}, {'type': 'photo', 'photo': {'type': 'photo', 'media': 'attach://pic'}}, {'type': 'paragraph', 'text': 'Проверка публикации rich с локальным файлом.'}]}}, {'pic': ('channel.png', fixture_photo(), 'image/png')})
                result['richPhoto'] = {'ok': rich.get('ok'), 'description': rich.get('description'), 'messageId': rich.get('result', {}).get('message_id')}
            summary.append(result)
        print(json.dumps(summary, ensure_ascii=False))
    elif mode == 'listen':
        deadline = time.monotonic() + (int(sys.argv[2]) if len(sys.argv) > 2 else 240)
        offset = None
        closed = False
        while time.monotonic() < deadline:
            params = {'timeout': 20, 'allowed_updates': ['message', 'edited_message', 'my_chat_member', 'callback_query', 'message_reaction', 'message_reaction_count', 'channel_post', 'edited_channel_post']}
            if offset is not None:
                params['offset'] = offset
            updates = api('getUpdates', params)
            if not updates.get('ok'):
                print(json.dumps({'error': updates.get('description')}, ensure_ascii=False), flush=True)
                break
            for update in updates['result']:
                offset = update['update_id'] + 1
                item = update.get('message') or update.get('edited_message') or update.get('channel_post') or update.get('edited_channel_post') or update.get('my_chat_member') or update.get('callback_query', {}).get('message') or {}
                chat = item.get('chat', {})
                print(json.dumps({'updateId': update['update_id'], 'chat': chat, 'event': [k for k in update if k != 'update_id']}, ensure_ascii=False), flush=True)
                if chat.get('type') in ('group', 'supergroup'):
                    api('getChat', {'chat_id': chat['id']})
                    api('getChatMember', {'chat_id': chat['id'], 'user_id': 8322579566})
                callback = update.get('callback_query')
                if not callback:
                    continue
                data = callback.get('data', '')
                grouped = data in ('[probe]rich', '[probe]inline') and item.get('message_id') == 8
                rejected = grouped and closed
                api('answerCallbackQuery', {'callback_query_id': callback['id'], 'text': 'Выбор уже принят' if rejected else 'Стенд получил нажатие', 'show_alert': rejected})
                if grouped and not closed:
                    closed = True
                    rich_text = '✅ Rich' if data.endswith('rich') else '⬛️ Rich'
                    inline_text = '✅ Inline' if data.endswith('inline') else '⬛️ Inline'
                    api('editMessageText', {'chat_id': chat['id'], 'message_id': 8, 'rich_message': {'blocks': [{'type': 'heading', 'text': 'Telegram-стенд', 'size': 2}, {'type': 'paragraph', 'text': 'Группа закрыта после первого выбора.'}, {'type': 'buttons', 'buttons': [{'text': rich_text, 'disabled': {}}]}]}, 'reply_markup': {'inline_keyboard': [[{'text': inline_text, 'disabled': {}}]]}})
        print('Bounded listener finished.', flush=True)
