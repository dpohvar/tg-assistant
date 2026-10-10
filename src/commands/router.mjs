import {handleWebSocketCommand} from './websocket.mjs';
import {createVault} from '../storage/vault.mjs';
import { handleChat } from "./chat.mjs";
import { handleTask } from "./task.mjs";
import { handleAgent } from "./agent.mjs";
import fs from "node:fs";
import path from "node:path";
import {
  parseArguments,
  syntaxError,
  validateArguments,
} from "./arguments.mjs";
import { parseTarget, pagination, commandError } from "./contract.mjs";
import { helpSections } from "./help.mjs";
import { createAccess } from "../access/scope.mjs";
import { createAdministrativeCommands, range } from "./administrative.mjs";
import { formatAgents } from "./agents-format.mjs";
import { formatTasks } from "./tasks-format.mjs";
import { cleanTemp } from "../files/cleanup.mjs";
export { range };
const fileNames = ["ls", "cat", "download", "upload", "rm", "mv", "edit"];
export function createCommands(deps) {
  const {
    db,
    telegram,
    config = {},
    scheduler,
    setAgentState,
    agentStatus = () => ({}),
    clearContext,
    stopAgent,
  } = deps;
  const legacy = createAdministrativeCommands(deps),
    access = createAccess(db);
  const taskDetails = (t) => {
    const a = db.sql
        .prepare("SELECT * FROM agents WHERE agentId=?")
        .get(t.agentId),
      f = db.sql
        .prepare("SELECT * FROM task_firings WHERE taskId=?")
        .all(t.taskId);
    return {
      ...t,
      state: !db.getChat(a.botId, a.chatId).agentEnabled
        ? "агент выключен"
        : f.some((x) => x.state === "processing")
          ? "обрабатывается"
          : scheduler.queued.has(t.taskId)
            ? "в очереди"
            : "ожидает",
      missed: f
        .filter((x) => x.state === "pending" && (x.failed || x.missedReason))
        .reduce((n, x) => n + x.count, 0),
    };
  };
  return {
    async handle(botId, m) {
      const quoted = m.document && m.reply_to_message;
      const source = quoted || m,
        match = /^\/([a-z_]+)(?:@([\w]+))?(?:\s|$)/i.exec(source.text ?? "");
      if (!match) return false;
      const section = match[1].toLowerCase();
      if (quoted && !["rules", "upload"].includes(section)) return false;
      if (
        match[2] &&
        match[2].toLowerCase() !== db.getBot(botId)?.username.toLowerCase()
      )
        return false;
      const role = botId === "master" ? "owner" : db.role(botId, m.from?.id),
        admin = ["admin", "owner"].includes(role),
        group = ["group", "supergroup"].includes(m.chat.type);
      if (
        botId === "master" &&
        (m.chat.type !== "private" || m.from?.id !== config.serviceOwnerId)
      )
        return true;
      if (botId !== "master" && m.chat.type === "private" && !role) return true;
      if (m.chat.type === "channel") return false;
      const send = async (value) => {
        const payload = typeof value === "string" ? { text: value } : value;
        if (payload.entities && payload.text.length > 4000) {
          let end = 3950;
          if (/^[\uD800-\uDBFF]$/.test(payload.text[end - 1])) end--;
          payload.text = payload.text.slice(0, end) + "\n[обрезано]";
          payload.entities = payload.entities
            .map((e) => ({
              ...e,
              length: Math.max(0, Math.min(e.length, end - e.offset)),
            }))
            .filter((e) => e.length > 0);
        }
        if (payload.entities || payload.parse_mode) {
          await telegram.call(botId, "sendMessage", {
            chat_id: m.chat.id,
            ...payload,
            reply_parameters: { message_id: m.message_id },
          });
          return;
        }
        let text = payload.text ?? "";
        while (text.length) {
          let n = Math.min(4000, text.length);
          if (/^[\uD800-\uDBFF]$/.test(text[n - 1])) n--;
          await telegram.call(botId, "sendMessage", {
            chat_id: m.chat.id,
            text: text.slice(0, n),
            reply_parameters: { message_id: m.message_id },
          });
          text = text.slice(n);
        }
      };
      const requireAdmin = () => access.requireRole(botId, m.from.id, "admin");
      const requireLocal = () =>
        access.requireRole(botId, m.from.id, group ? "manager" : "user");
      const target = (t) => {
        if (t.kind !== "current") requireAdmin();
        else requireLocal();
        if (t.kind === "all")
          return db.sql
            .prepare("SELECT * FROM agents WHERE botId=?")
            .all(botId);
        const chatId =
          t.kind === "chat"
            ? t.id
            : t.kind === "agent"
              ? db.sql
                  .prepare(
                    "SELECT chatId FROM agents WHERE botId=? AND agentId=?",
                  )
                  .get(botId, t.id)?.chatId
              : m.chat.id;
        if (
          t.kind === "current" &&
          m.chat.type === "private" &&
          !db.getChat(botId, chatId)
        ) {
          db.saveChat(botId, m.chat);
          db.sql
            .prepare(
              "UPDATE chats SET agentEnabled=1 WHERE botId=? AND chatId=?",
            )
            .run(botId, chatId);
        }
        const chat = db.getChat(botId, chatId);
        if (!chat) throw syntaxError("Chat or agent not found.");
        return { chat, a: db.agent(botId, chatId) };
      };
      const page = (values, r, render = (x) => x) => {
        const [a, b] = range(r),
          items = values.slice(a, b);
        return items.length
          ? `${a + 1}-${a + items.length} / ${values.length}\n` +
              items.map(render).join("\n")
          : "Записей нет";
      };
      let sensitive = (section === "vault" && /^\s*set(?:\s|$)/.test(source.text.slice(match[0].trimEnd().length))) ||
        (section === "bot" &&
          /^\s*add(?:\s|$)/.test(
            source.text.slice(match[0].trimEnd().length),
          )) ||
        (section === "git" &&
          /^\s*setup\s+/.test(source.text.slice(match[0].trimEnd().length)));
      try {
        const parsed = parseArguments(
            source.text ?? "",
            source.entities,
            match[0].trimEnd().length,
          ),
          parts = parsed.map((a) => a.value);
        sensitive =
          sensitive ||
          (section === "vault" && parts[0] === "set") ||
          (section === "bot" && parts[0] === "add") ||
          (section === "git" && parts[0] === "setup" && parts.length > 1);
        if (
          parsed.some((a) => a.type === "pre") &&
          section !== "edit" &&
          !(section === "git" && parts[0] === "sync")
        )
          throw syntaxError("Pre blocks are not accepted here.");
        if (section === "ws") { requireAdmin(); if(botId === "master") throw syntaxError("WebSockets are available only for child bots."); await handleWebSocketCommand({botId,message:m,parts,manager:deps.websockets,target,send}); return true; }
        if (section === "vault") {
          if (botId === "master" || group || m.chat.type !== "private") throw syntaxError("Vault commands are available only in private chats with a child bot.");
          requireAdmin();
          const vault=createVault(db), action=parts[0] ?? 'list';
          if(action==='list' && parts.length<=1) await send(vault.list(botId).join('\n') || 'Секретов нет');
          else if(action==='set' && parts.length===3) {vault.set(botId,parts[1],parts[2]);await send('Секрет сохранён');}
          else if(action==='delete' && parts.length===2) await send(vault.delete(botId,parts[1])?'Секрет удалён':'Секрет не найден');
          else throw syntaxError('Invalid vault arguments.');
          return true;
        }
        if (section === "help") {
          if (parts.length > 1) throw syntaxError("Invalid arguments.");
          const help = helpSections({
            master: botId === "master",
            role,
            group,
          });
          if (parts[0] && !help[parts[0]])
            throw syntaxError("Unknown or unavailable section.");
          await send(
            parts[0]
              ? help[parts[0]]
              : Object.entries(help)
                  .map(([k, v]) => k + "\n" + v)
                  .join("\n\n") || "Нет доступных команд.",
          );
          return true;
        }
        if (botId === "master") {
          if (section !== "bot") throw syntaxError("Unknown command.");
          const action = parts.shift() ?? "list";
          if (action === "list") {
            if (parts.length > 1) throw syntaxError("Invalid arguments.");
            const rows = db.sql
                .prepare("SELECT * FROM bots ORDER BY telegramId")
                .all(),
              [lo, hi] = range(parts[0]),
              selected = rows.slice(lo, hi);
            let text = selected.length
              ? `${lo + 1}-${lo + selected.length} / ${rows.length}\n`
              : "Записей нет";
            const entities = [];
            for (const b of selected) {
              text += "@" + b.username + " ";
              entities.push({
                type: "code",
                offset: text.length,
                length: String(b.telegramId).length,
              });
              text += b.telegramId + " — владелец ";
              entities.push({
                type: "code",
                offset: text.length,
                length: String(b.ownerId).length,
              });
              text += b.ownerId + "\n";
            }
            await send({ text, entities });
            return true;
          }
          if (action === "info" || (action === "owner" && parts[0] !== "set")) {
            if (parts.length !== 1) throw syntaxError("Specify @BotName.");
            const b = db.sql
              .prepare("SELECT * FROM bots WHERE lower(username)=lower(?)")
              .get(parts[0].replace(/^@/, ""));
            if (!b) throw syntaxError("Bot not found.");
            let profile = {};
            if (action === "info")
              try {
                profile = await telegram.call(b.botId, "getMe");
              } catch {}
            await send(
              `${profile.first_name ?? b.username}\n@${b.username} ${b.telegramId}\nВладелец: ${b.ownerId}` +
                (action === "info"
                  ? `\nЧатов: ${db.sql.prepare("SELECT COUNT(*) AS n FROM chats WHERE botId=?").get(b.botId).n}\nАгентов включено: ${db.sql.prepare("SELECT COUNT(*) AS n FROM chats JOIN agents USING(botId,chatId) WHERE botId=? AND agentEnabled=1").get(b.botId).n}\nАгентов выключено: ${db.sql.prepare("SELECT COUNT(*) AS n FROM chats JOIN agents USING(botId,chatId) WHERE botId=? AND agentEnabled=0").get(b.botId).n}`
                  : ""),
            );
            return true;
          }
          let name;
          if (action === "add") name = "newbot";
          else if (action === "delete") name = "delete_bot";
          else if (action === "owner" && parts.shift() === "set")
            name = "set_owner";
          else throw syntaxError("Unknown bot action.");
          validateArguments(
            name,
            parts.map((value) => ({ type: "text", value })),
          );
          await deps.masterCommands(name, parts, m, async (b, msg, text) =>
            send(text.replaceAll("/delete_bot", "/bot delete")),
          );
          return true;
        }
        if (section === "agent")
          return await handleAgent({
            admin,
            group,
            parts,
            db,
            botId,
            send,
            requireAdmin,
            requireLocal,
            target,
            clearContext,
            m,
            setAgentState,
            agentStatus,
            deps,
            page,
            scheduler,
            taskDetails,
          });
        if (section === "task")
          return await handleTask({
            parts,
            db,
            botId,
            send,
            requireAdmin,
            requireLocal,
            target,
            clearContext,
            m,
            setAgentState,
            agentStatus,
            deps,
            page,
            scheduler,
            taskDetails,
          });
        if (section === "chat")
          return await handleChat({
            stopAgent,
            telegram,
            parts,
            db,
            botId,
            send,
            requireAdmin,
            requireLocal,
            target,
            clearContext,
            m,
            setAgentState,
            agentStatus,
            deps,
            page,
            scheduler,
            taskDetails,
          });
        if (section === "owner") {
          requireAdmin();
          if (group) throw syntaxError("Use this command in private.");
          const bot = db.getBot(botId);
          if (!parts.length) {
            const profile = db.getChat(botId, bot.ownerId),
              user = profile ? JSON.parse(profile.json) : {};
            await send({
              text:
                String(bot.ownerId) +
                " " +
                (user.username
                  ? "@" + user.username
                  : (profile?.name ?? "имя неизвестно")),
              entities: [
                { type: "code", offset: 0, length: String(bot.ownerId).length },
              ],
            });
            return true;
          }
          if (parts.length !== 2 || parts[0] !== "set" || role !== "owner")
            throw syntaxError("Owner required; use /owner set USER_ID.");
          const id = Number(parts[1]);
          if (!Number.isSafeInteger(id) || id <= 0 || !db.role(botId, id))
            throw syntaxError("User must be authorized.");
          if (id !== bot.ownerId)
            db.transaction(() => {
              db.setRole(botId, bot.ownerId, "admin");
              db.sql
                .prepare("UPDATE bots SET ownerId=? WHERE botId=?")
                .run(id, botId);
            });
          await send(
            `Владелец: ${id}; прежний владелец: ${id === bot.ownerId ? "owner" : "admin"}`,
          );
          return true;
        }
        if (section === "user" && parts[0] === "list") {
          requireAdmin();
          if (group) throw syntaxError("Use private chat.");
          parts.shift();
          if (parts.length > 1) throw syntaxError("Invalid range.");
          const bot = db.getBot(botId),
            rows = [
              { userId: bot.ownerId, role: "owner" },
              ...db.sql
                .prepare(
                  "SELECT userId,role FROM roles WHERE botId=? AND userId!=?",
                )
                .all(botId, bot.ownerId),
            ],
            order = { owner: 0, admin: 1, manager: 2, user: 3 };
          rows.sort(
            (a, b) => order[a.role] - order[b.role] || a.userId - b.userId,
          );
          const [lo, hi] = range(parts[0]),
            selected = rows.slice(lo, hi);
          let text = selected.length
              ? `${lo + 1}-${lo + selected.length} / ${rows.length}\n`
              : "Записей нет",
            entities = [];
          for (const u of selected) {
            const chat = db.getChat(botId, u.userId),
              profile = chat ? JSON.parse(chat.json) : {};
            entities.push({
              type: "code",
              offset: text.length,
              length: String(u.userId).length,
            });
            text +=
              u.userId +
              " " +
              (profile.username
                ? "@" + profile.username
                : chat?.name || "имя неизвестно") +
              " ";
            entities.push({
              type: "italic",
              offset: text.length,
              length: u.role.length,
            });
            text += u.role + "\n";
          }
          await send({ text, entities });
          return true;
        }
        if (section === "temp") {
          requireAdmin();
          if (
            group ||
            parts.length > 1 ||
            (parts[0] && !["status", "cleanup"].includes(parts[0]))
          )
            throw syntaxError("Use /temp status or /temp cleanup in private.");
          const root = path.join(config.botsDir, botId),
            stats = () => {
              const r = { files: 0, bytes: 0, expired: 0, expiredBytes: 0 };
              const walk = (p) => {
                if (!fs.existsSync(p)) return;
                const st = fs.lstatSync(p);
                if (st.isSymbolicLink()) return;
                if (st.isDirectory()) {
                  for (const n of fs.readdirSync(p)) walk(path.join(p, n));
                } else {
                  r.files++;
                  r.bytes += st.size;
                  if (st.mtimeMs < Date.now() - 86400000) {
                    r.expired++;
                    r.expiredBytes += st.size;
                  }
                }
              };
              walk(path.join(root, ".temp"));
              return r;
            };
          const before = stats();
          if (parts[0] === "cleanup") {
            const errors = cleanTemp(root),
              after = stats();
            await send(
              `Удалено: ${before.files - after.files} файлов, ${before.bytes - after.bytes} байт.\nОшибок: ${errors.length}` +
                (errors.length ? "\n" + errors.join("\n").slice(0, 3000) : ""),
            );
          } else
            await send(
              `Всего: ${before.files} файлов, ${before.bytes} байт.\nПросрочено: ${before.expired} файлов, ${before.expiredBytes} байт.`,
            );
          return true;
        }
        let name = section,
          args = parsed;
        if (section === "rules") {
          if (parts.length === 1 && parts[0] === "set") {
            name = "set_rules";
            args = parsed.slice(1);
          } else if (parts.length)
            throw syntaxError("Use /rules or /rules set.");
        } else if (section === "triggers") {
          if (parts[0] === "set") {
            name = "set_triggers";
            args = parsed.slice(1);
          } else if (parts.length)
            throw syntaxError("Use /triggers or /triggers set.");
        } else if (section === "git") {
          const action = parts[0];
          if (!["setup", "changes", "sync"].includes(action))
            throw syntaxError("Unknown git action.");
          name = "git_" + action;
          args = parsed.slice(1);
        } else if (section === "user") {
          if (!["set", "delete"].includes(parts[0]))
            throw syntaxError("Unknown user action.");
          name = parts[0] === "set" ? "set_user" : "remove_user";
          args = parsed.slice(1);
        } else if (!fileNames.includes(section))
          throw syntaxError("Unknown command.");
        validateArguments(name, args);
        const synthetic =
          "/" +
          name +
          (args.length ? " " + args.map((a) => a.value).join(" ") : "");
        let offset = name.length + 2;
        const entities = [];
        for (const a of args) {
          if (["code", "pre"].includes(a.type))
            entities.push({ type: a.type, offset, length: a.value.length });
          offset += a.value.length + 1;
        }
        const convert = (x) => ({ ...x, text: synthetic, entities });
        const adapted = quoted
          ? { ...m, reply_to_message: convert(source) }
          : convert(m);
        await legacy.handle(botId, adapted);
        return true;
      } catch (e) {
        await send(
          commandError(
            section,
            e.code === "access_denied" ? "Нет доступа" : e.message,
          ),
        );
        return true;
      } finally {
        if (sensitive)
          try {
            await telegram.call(botId, "deleteMessage", {
              chat_id: m.chat.id,
              message_id: m.message_id,
            });
          } catch {}
      }
    },
  };
}
