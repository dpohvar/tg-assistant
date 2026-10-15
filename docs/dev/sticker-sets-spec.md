# Sticker sets and custom emoji

Accepted scope: all model agents can inspect, create, edit and delete regular sticker sets and custom emoji sets. No creator agent or semantic descriptions are stored. Policy belongs in bot developer instructions; no new role gate or automatic inspection is introduced.

## Tools

- `sticker_set_get({name})`: accept a short name or HTTPS `t.me/addstickers/NAME` / `t.me/addemoji/NAME` link; return live native `{set,link}`. No downloads or external-set registration.
- `sticker_sets({})`: durable bot-wide `{sets:[{name,title,type,ownerUserId,link}]}` for sets created through this controller. Reads remain useful after agent deletion/reset. Unconfirmed create attempts are separately reported as `uncertain` with the same identifying fields; never count them as confirmed creations.
- `sticker_set_create({name,title,type,ownerUserId?,stickers,uploads?,needsRepainting?})`: regular/custom_emoji only; 1–50 native InputSticker entries. Owner defaults to the application bot owner. Full short name must end `_by_<bot_username>`. Return `{status:"created",name,ownerUserId,link}`.
- `sticker_set_edit({name,action,...})`: one of add(sticker), replace(oldFileId,sticker), remove(fileId), move(fileId,position), set_emojis(fileId,emojiList), set_keywords(fileId,keywords), set_title(title), set_thumbnail(thumbnail,format for regular; customEmojiId for emoji). `ownerUserId?` applies to add/replace/regular thumbnail; prefer recorded owner, otherwise application owner. `uploads?` uses attachment names mapped to permitted local paths. Null thumbnails reset them. Return `{status:"done",name}`. Validate named-set membership before operations whose native endpoint accepts only a file ID.
- `sticker_set_delete({name})`: delete actual Telegram set then local record. Return `{status:"deleted",name}`.

Native InputSticker is `{sticker,format,emoji_list,keywords?}`. File sources are Telegram file IDs, supported HTTP(S) URLs, or `attach://name`. PNG/WebP static, TGS animation and WebM video are supported; Telegram enforces actual media constraints.

## Boundaries and failure semantics

Keep chat access, lifecycle, local path and secret URL protections. Remove outgoing file ID provenance requirements from send/edit/rich media/widgets; retain ignored `file_sources` for compatibility. Reuse existing text entities and JSX custom emoji handling. Ordinary rich-button callbacks must flatten labels for events while preserving structured text and custom emoji in edited buttons.

Errors use `{error,description}`: invalid_argument, file_unavailable, telegram_api_error, delivery_unknown. No automatic mutation retry. After confirmed mutation, registry-write failure returns storage_failed with `applied:true` and `name`. Persist create intent before the network effect; on transport uncertainty retain it in `uncertain`, including across restart. A read cannot prove creator ownership and does not silently promote an uncertain attempt. Confirmed API rejection clears the intent. A repeated local name is rejected without another create call. Read known confirmed sets to refresh cached title/type; external reads do not add records. Bot deletion cascades registry records without deleting Telegram sets.

## Verification

Use real SQLite, controller dispatch and BotFiles with a fake external Telegram boundary. Cover regular/custom creation, uploads and owner defaults, cross-bot persistence/isolation, every edit/reset, named-set membership, stale lifecycle after lookup, uncertain/confirmed outcomes, registry failures, rich callbacks, and unrestricted send/edit/widget file IDs with existing local/chat protections. Run full tests, wiki checker and independent review before authorized merge/push. Offline tests are not live Telegram acceptance.
