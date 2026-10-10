"""Interactive rich edit + multipart regression; no image model is invoked."""
import json
import pathlib
import runpy
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
helpers = runpy.run_path(str(ROOT / 'tools/telegram-check.py'))
api, multipart, fixture = helpers['api'], helpers['multipart'], helpers['fixture_photo']
CHAT = 114772672
STATE = ROOT / '.runtime-check/telegram-carousel-state.json'

def blocks(text, photos, label=None, callback=None):
    result = [{'type': 'paragraph', 'text': text}]
    if photos:
        result.append({'type': 'slideshow', 'blocks': [{'type': 'photo', 'photo': {'type': 'photo', 'media': photo}} for photo in photos]})
    if label:
        result.append({'type': 'buttons', 'buttons': [{'text': label, 'callback_data': callback}]})
    return {'blocks': result}

def photos_in(message):
    slideshow = next(b for b in message['rich_message']['blocks'] if b['type'] == 'slideshow')
    return [max(b['photo'], key=lambda p: p['width'] * p['height']) for b in slideshow['blocks']]

def save(state):
    STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf8')

if __name__ == '__main__':
    initial = api('sendRichMessage', {'chat_id': CHAT, 'rich_message': blocks('генерирую фото', [], 'продолжить', '[carousel1]continue')})
    if not initial.get('ok'):
        raise SystemExit(initial.get('description', 'send failed'))
    state = {'messageId': initial['result']['message_id'], 'step': 0}
    save(state)
    print(json.dumps(state), flush=True)
    offset = None
    deadline = time.monotonic() + 1800
    while time.monotonic() < deadline:
        params = {'timeout': 20, 'allowed_updates': ['message', 'edited_message', 'my_chat_member', 'callback_query', 'message_reaction', 'message_reaction_count', 'channel_post', 'edited_channel_post']}
        if offset is not None:
            params['offset'] = offset
        updates = api('getUpdates', params)
        if not updates.get('ok'):
            print(json.dumps({'error': updates.get('description')}), flush=True)
            break
        for update in updates['result']:
            offset = update['update_id'] + 1
            callback = update.get('callback_query')
            if not callback:
                continue
            message = callback.get('message', {})
            owned = message.get('chat', {}).get('id') == CHAT and message.get('message_id') == state['messageId'] and callback.get('from', {}).get('id') == CHAT
            expected = '[carousel1]continue' if state['step'] == 0 else '[carousel2]add' if state['step'] == 1 else None
            allowed = owned and callback.get('data') == expected and expected is not None
            api('answerCallbackQuery', {'callback_query_id': callback['id'], 'text': 'Загружаю файлы' if allowed else 'Стенд получил нажатие'})
            if not allowed:
                continue
            if state['step'] == 0:
                result = multipart('editMessageText', {'chat_id': CHAT, 'message_id': state['messageId'], 'rich_message': blocks('фото готово', ['attach://red', 'attach://green'], 'добавить ещё', '[carousel2]add')}, {'red': ('red.png', fixture((220, 70, 70)), 'image/png'), 'green': ('green.png', fixture((70, 180, 70)), 'image/png')})
                if result.get('ok'):
                    photos = photos_in(result['result'])
                    assert len(photos) == 2
                    state.update(step=1, photos=photos)
                    save(state)
                    print('Two uploaded photos accepted by editMessageText.', flush=True)
            else:
                existing = [p['file_id'] for p in state['photos']]
                result = multipart('editMessageText', {'chat_id': CHAT, 'message_id': state['messageId'], 'rich_message': blocks('фото добавлено', existing + ['attach://blue'])}, {'blue': ('blue.png', fixture(), 'image/png')})
                if result.get('ok'):
                    photos = photos_in(result['result'])
                    assert len(photos) == 3
                    retained = [p['file_unique_id'] for p in photos[:2]] == [p['file_unique_id'] for p in state['photos']]
                    assert retained, 'Old photos were replaced'
                    state.update(step=2, finalPhotos=photos, originalFilesRetained=retained)
                    save(state)
                    print('Third upload accepted; original two file_unique_id values retained.', flush=True)
            if not result.get('ok'):
                state['error'] = result.get('description')
                save(state)
                print(json.dumps({'error': state['error']}), flush=True)
                api('sendMessage', {'chat_id': CHAT, 'text': 'Ошибка тестового edit: ' + state['error']})
        if state['step'] == 2:
            break
    print('Carousel probe finished.', flush=True)
