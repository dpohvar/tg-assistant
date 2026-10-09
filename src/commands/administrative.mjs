import { normalizeTriggers } from "../telegram/triggers.mjs";
import { parseArguments, validateArguments } from "./arguments.mjs";
import fs from "node:fs";
import path from "node:path";
import { createAccess } from "../access/scope.mjs";
export function range(value) {
  if (!value) return [0, 10];
  const m = /^(\d+)(?:-(\d+))?$/.exec(value);
  if (
    !m ||
    Number(m[1]) < 1 ||
    Number(m[2] ?? m[1]) < Number(m[1]) ||
    !Number.isSafeInteger(Number(m[2] ?? m[1]))
  )
    throw new Error("Укажите позицию N или диапазон FROM-TO.");
  return [Number(m[1]) - 1, Number(m[2] ?? m[1])];
}
export function createAdministrativeCommands({
  db,
  config,
  telegram,
  stopAgent,
  updateRules,
  fileCommands,
}) {
  const access = createAccess(db);
  const privateCommands = new Set([
    "set_user",
    "remove_user",
    "rules",
    "set_rules",
    "ls",
    "cat",
    "download",
    "rm",
    "mv",
    "edit",
    "upload",
    "git_setup",
    "git_changes",
    "git_sync",
  ]);
  const reply = (botId, m, text) =>
    telegram.call(botId, "sendMessage", {
      chat_id: m.chat.id,
      text:
        [...text].slice(0, 4000).join("") +
        ([...text].length > 4000 ? "\n[обрезано]" : ""),
      reply_parameters: { message_id: m.message_id },
    });
  const list = (values, arg) => {
    const [a, b] = range(arg);
    const page = values.slice(a, b);
    return page.length
      ? `${a + 1}–${a + page.length} / ${values.length}\n` + page.join("\n")
      : "Записей нет";
  };
  return {
    async handle(botId, m) {
      const text = m.text ?? "",
        match = /^\/([a-z_]+)(?:@([\w]+))?(?:\s|$)/i.exec(text);
      const uploadReply = Boolean(
        m.document &&
          /^\/(set_rules|upload)(?:\s|$)/.test(m.reply_to_message?.text ?? ""),
      );
      if (!match && !uploadReply) return false;
      const rawArgs = match ? text.slice(match[0].length).trim() : "",
        name = (
          match?.[1] ?? m.reply_to_message.text.slice(1).split(/\s/)[0]
        ).toLowerCase();
      if (
        match?.[2] &&
        match[2].toLowerCase() !== db.getBot(botId)?.username.toLowerCase()
      )
        return false;
      const sensitive = false;
      if (m.chat.type === "channel") return Boolean(sensitive);
      try {
        if (m.chat.type === "private" && !db.role(botId, m.from.id))
          return true;
        if (name === "start" && m.chat.type === "private") return false;
        const triggerCommand = ["triggers", "set_triggers"].includes(name);
        if (triggerCommand && !["group", "supergroup"].includes(m.chat.type)) {
          await reply(botId, m, "Команда доступна только в группе с агентом.");
          return true;
        }
        const taskCommand = false;
        const modelCommand = false;
        if (
          ["group", "supergroup"].includes(m.chat.type) &&
          !taskCommand &&
          !modelCommand &&
          !triggerCommand &&
          name !== "clear" &&
          name !== "leave"
        ) {
          if (privateCommands.has(name)) {
            await reply(botId, m, "Команда доступна только в ЛС.");
            return true;
          }
          return false;
        }
        access.requireRole(
          botId,
          m.from.id,
          triggerCommand
            ? "manager"
            : taskCommand
              ? m.chat.type === "private"
                ? "user"
                : "manager"
              : "admin",
        );
        const role = db.role(botId, m.from.id),
          owner = role === "owner",
          bot = db.getBot(botId);
        if (["set_rules", "upload"].includes(name) && m.reply_to_message) {
          const quoted = m.reply_to_message;
          const reject = (message) => {
            throw Object.assign(new Error(message), { safe: true });
          };
          if (quoted.chat?.id !== m.chat.id)
            reject("Нужно ответить на сообщение в текущем чате.");
          if (
            !Number.isSafeInteger(m.from?.id) ||
            quoted.from?.id !== m.from.id ||
            quoted.sender_chat
          )
            reject("Нужно ответить на своё собственное сообщение.");
          if (quoted.edit_date !== undefined)
            reject(
              "Нельзя загружать файл ответом на отредактированное сообщение. Отправьте новое сообщение.",
            );
        }
        const source = uploadReply ? m.reply_to_message : m;
        const commandEnd =
          /^\/[a-z_]+(?:@[\w]+)?/i.exec(source.text ?? "")?.[0].length ?? 0;
        const parsed = parseArguments(
          source.text ?? "",
          source.entities,
          commandEnd,
        );
        validateArguments(name, parsed);
        const parts = parsed.map((a) => a.value);
        let result;
        if (triggerCommand) {
          const chat = db.getChat(botId, m.chat.id);
          if (!chat) throw new Error("Chat unavailable");
          const values =
            name === "set_triggers"
              ? normalizeTriggers(parts)
              : JSON.parse(chat.triggers);
          if (name === "set_triggers") {
            db.sql
              .prepare("UPDATE chats SET triggers=? WHERE botId=? AND chatId=?")
              .run(JSON.stringify(values), botId, m.chat.id);
            result = `Триггеры сохранены: ${values.length}`;
          } else {
            if (!values.length) result = "Триггеры не заданы";
            else {
              const chunks = [];
              let text = "",
                entities = [];
              for (const value of values) {
                if (text.length + value.length + 1 > 4000) {
                  chunks.push({ text, entities });
                  text = "";
                  entities = [];
                }
                if (text) text += "\n";
                entities.push({
                  type: "code",
                  offset: text.length,
                  length: value.length,
                });
                text += value;
              }
              if (text) chunks.push({ text, entities });
              for (const chunk of chunks)
                await telegram.call(botId, "sendMessage", {
                  chat_id: m.chat.id,
                  ...chunk,
                  reply_parameters: { message_id: m.message_id },
                });
              return true;
            }
          }
        } else if (name === "set_user" || name === "remove_user") {
          const userId = Number(parts[0]),
            targetRole = db.role(botId, userId),
            newRole = parts[1] ?? "user";
          if (
            !Number.isSafeInteger(userId) ||
            userId <= 0 ||
            (name === "set_user" ? parts.length > 2 : parts.length !== 1) ||
            targetRole === "owner" ||
            (!owner &&
              (targetRole === "admin" ||
                newRole === "admin" ||
                userId === m.from.id)) ||
            !["user", "manager", "admin"].includes(newRole)
          )
            throw new Error(
              "Недопустимый пользователь или роль. Admin управляет только user/manager.",
            );
          if (name === "set_user") db.setRole(botId, userId, newRole);
          else {
            db.sql
              .prepare("DELETE FROM roles WHERE botId=? AND userId=?")
              .run(botId, userId);
            await stopAgent(botId, userId, { leave: false });
          }
          result = "Сохранено";
        } else if (name === "rules" || name === "set_rules") {
          const rulesPath = path.join(
            config.dataDir,
            "rules",
            botId,
            "AGENTS.md",
          );
          if (name === "rules") {
            if (parts.length) throw new Error("/rules без аргументов");
            await telegram.call(
              botId,
              "sendDocument",
              {
                chat_id: m.chat.id,
                document: "attach://rules",
                reply_parameters: { message_id: m.message_id },
              },
              {
                uploads: [
                  {
                    name: "rules",
                    filename: "AGENTS.md",
                    bytes: fs.existsSync(rulesPath)
                      ? fs.readFileSync(rulesPath)
                      : Buffer.from(""),
                  },
                ],
              },
            );
            return true;
          }
          if (parts.length > 1 || (parts[0] && parts[0] !== "force"))
            throw new Error("/rules set");
          const document = uploadReply
            ? m.document
            : m.reply_to_message?.document;
          if (!document)
            result = "Отправьте файл цитатой на своё сообщение /rules set";
          else {
            await updateRules(botId, document, parts[0] === "force");
            result = "Правила обновлены. Контекст агентов будет очищен.";
          }
        } else if (
          fileCommands &&
          [
            "git_setup",
            "git_changes",
            "git_sync",
            "ls",
            "cat",
            "download",
            "upload",
            "rm",
            "mv",
            "edit",
            "cleanup_temp",
          ].includes(name)
        ) {
          result = await fileCommands(botId, name, parsed, m);
        } else throw new Error("Неизвестная команда.");
        if (result === null) return true;
        if (result?.parse_mode || result?.entities)
          await telegram.call(botId, "sendMessage", {
            chat_id: m.chat.id,
            ...result,
            reply_parameters: { message_id: m.message_id },
          });
        else
          await reply(
            botId,
            m,
            typeof result === "string" ? result : JSON.stringify(result),
          );
      } catch (e) {
        await reply(
          botId,
          m,
          e.code === "access_denied"
            ? "Нет доступа"
            : e.safe
              ? e.message
              : "Команда не выполнена. Проверьте синтаксис, роль и доступность данных. /help",
        );
      } finally {
        if (sensitive) {
          try {
            await telegram.call(botId, "deleteMessage", {
              chat_id: m.chat.id,
              message_id: m.message_id,
            });
          } catch {}
        }
      }
      return true;
    },
  };
}
