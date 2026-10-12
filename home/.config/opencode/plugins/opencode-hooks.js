// v2.ts
import { Plugin } from "@opencode/plugin";

// src/config.ts
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
var UNSUPPORTED_EVENTS = [
  "PermissionRequest",
  "SubagentStart",
  "SubagentStop",
  "TeammateIdle",
  "TaskCompleted",
  "ConfigChange",
  "WorktreeCreate",
  "WorktreeRemove",
  "InstructionsLoaded"
];
function readSettingsFile(filePath) {
  try {
    const content = readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}
function mergeHooksConfig(base, override) {
  const result = { ...base };
  for (const [event, matchers] of Object.entries(override)) {
    const key = event;
    const existing = result[key] ?? [];
    result[key] = [...existing, ...matchers ?? []];
  }
  return result;
}
function loadConfig(cwd = process.cwd(), { homeDir = homedir() } = {}) {
  const globalPath = join(homeDir, ".claude", "settings.json");
  const projectPath = join(cwd, ".claude", "settings.json");
  const localPath = join(cwd, ".claude", "settings.local.json");
  const globalSettings = readSettingsFile(globalPath);
  const projectSettings = readSettingsFile(projectPath);
  const localSettings = readSettingsFile(localPath);
  let merged = {};
  if (globalSettings?.hooks) merged = mergeHooksConfig(merged, globalSettings.hooks);
  if (projectSettings?.hooks) merged = mergeHooksConfig(merged, projectSettings.hooks);
  if (localSettings?.hooks) merged = mergeHooksConfig(merged, localSettings.hooks);
  const disableAllHooks = localSettings?.disableAllHooks ?? projectSettings?.disableAllHooks ?? globalSettings?.disableAllHooks ?? false;
  return { hooks: merged, disableAllHooks };
}
function warnUnsupportedEvents(hooks, warn = console.warn) {
  for (const event of UNSUPPORTED_EVENTS) {
    if (hooks[event] && hooks[event].length > 0) {
      warn(
        `[opencode-hooks-api] Unsupported event "${event}" is configured but will not fire. Reason: no OpenCode equivalent.`
      );
    }
  }
}

// src/matcher.ts
function matchHook(matcher, value) {
  if (value === void 0) return true;
  if (!matcher || matcher === "*") return true;
  try {
    const regex = new RegExp(matcher, "i");
    return regex.test(value);
  } catch {
    return false;
  }
}

// src/executor.ts
import { spawn } from "node:child_process";
function parseHookOutput(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}
function outputToResult(output) {
  if (!output) return { action: "allow" };
  if (output.decision === "block" || output.continue === false || output.ok === false) {
    return {
      action: "block",
      reason: output.stopReason ?? output.reason ?? "Blocked by hook",
      updatedInput: output.hookSpecificOutput?.updatedInput,
      additionalContext: output.hookSpecificOutput?.additionalContext
    };
  }
  return {
    action: "allow",
    updatedInput: output.hookSpecificOutput?.updatedInput,
    additionalContext: output.hookSpecificOutput?.additionalContext
  };
}
function interpolateEnvVars(value) {
  return value.replace(/\$([A-Z_][A-Z0-9_]*)/g, (_, name) => process.env[name] ?? "");
}
async function runCommand(handler, input) {
  const timeoutMs = (handler.timeout ?? 600) * 1e3;
  const inputJson = JSON.stringify(input);
  return new Promise((resolve) => {
    let settled = false;
    const proc = spawn("bash", ["-c", handler.command], {
      env: {
        ...process.env,
        OPENCODE_PROJECT_DIR: input.cwd,
        OPENCODE_SESSION_ID: input.session_id,
        OPENCODE_HOOK_EVENT: input.hook_event_name
      }
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    proc.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    proc.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill("SIGKILL");
        resolve({ action: "error", reason: `Command timed out after ${handler.timeout ?? 600}s` });
      }
    }, timeoutMs);
    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8").trim();
      if (code === 0) {
        const output = parseHookOutput(stdout);
        resolve(outputToResult(output));
      } else if (code === 2) {
        resolve({ action: "block", reason: stderr || "Blocked by hook" });
      } else {
        const reason = stderr || `Command exited with code ${code}`;
        console.error(`[opencode-hooks-api] Command hook error (exit ${code}): ${reason}`);
        resolve({ action: "error", reason });
      }
    });
    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      console.error(`[opencode-hooks-api] Failed to spawn command: ${err.message}`);
      resolve({ action: "error", reason: err.message });
    });
    proc.stdin.write(inputJson, () => {
      proc.stdin.end();
    });
  });
}
async function runHttp(handler, input) {
  const timeoutMs = (handler.timeout ?? 600) * 1e3;
  const body = JSON.stringify(input);
  const headers = { "Content-Type": "application/json" };
  if (handler.headers) {
    for (const [key, value] of Object.entries(handler.headers)) {
      headers[key] = interpolateEnvVars(value);
    }
  }
  try {
    const response = await fetch(handler.url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) {
      const reason = `HTTP ${response.status} ${response.statusText}`;
      console.error(`[opencode-hooks-api] HTTP hook error: ${reason}`);
      return { action: "error", reason };
    }
    const text = await response.text();
    const output = parseHookOutput(text);
    return outputToResult(output);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[opencode-hooks-api] HTTP hook fetch error: ${message}`);
    return { action: "error", reason: message };
  }
}
async function runPrompt(handler, input, client) {
  if (!client || typeof client.session !== "object") {
    return { action: "error", reason: "OpenCode SDK client not available for prompt/agent hook" };
  }
  const sdkClient = client;
  const timeoutMs = (handler.timeout ?? (handler.type === "agent" ? 60 : 30)) * 1e3;
  const promptText = handler.prompt.replace(/\$ARGUMENTS/g, JSON.stringify(input));
  try {
    const result = await sdkClient.session.prompt({ prompt: promptText, timeout: timeoutMs });
    const output = parseHookOutput(result.text);
    return outputToResult(output);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[opencode-hooks-api] Prompt/agent hook error: ${message}`);
    return { action: "error", reason: message };
  }
}
async function executeHook(handler, input, client) {
  switch (handler.type) {
    case "command":
      return runCommand(handler, input);
    case "http":
      return runHttp(handler, input);
    case "prompt":
      return runPrompt(handler, input, client);
    case "agent":
      return runPrompt(handler, input, client);
    default: {
      const _exhaustive = handler;
      void _exhaustive;
      return { action: "skip", reason: "Unknown handler type" };
    }
  }
}

// src/events.ts
function buildToolHookInput(eventName, event, cwd) {
  return {
    session_id: event.sessionId,
    cwd,
    hook_event_name: eventName,
    tool_name: event.tool,
    tool_input: event.args
  };
}
function buildSessionHookInput(eventName, event, cwd) {
  return {
    session_id: event.sessionId,
    cwd,
    hook_event_name: eventName
  };
}
function detectToolFailure(event) {
  if (event.error === true || typeof event.error === "string" && event.error.length > 0) {
    return true;
  }
  const output = typeof event.output === "string" ? event.output : JSON.stringify(event.output ?? "");
  if (event.tool === "bash") {
    const errorPatterns = [
      /exit code [1-9]/i,
      /exited with code [1-9]/i,
      /command failed/i,
      /error:/i,
      /\bfailed\b/i,
      /\bFAILED\b/
    ];
    return errorPatterns.some((p) => p.test(output));
  }
  const genericErrorPatterns = [/error/i, /failed/i, /exception/i];
  return genericErrorPatterns.some((p) => p.test(output));
}
function mapToolAfterEvent(event) {
  return detectToolFailure(event) ? "PostToolUseFailure" : "PostToolUse";
}

// v2.ts
var LOG_PREFIX = "[opencode-hooks-api]";
async function runHooksForEvent(eventName, matchers, toolName, input, client) {
  if (!matchers || matchers.length === 0) return [];
  const promises = [];
  for (const matcher of matchers) {
    if (!matchHook(matcher.matcher, toolName)) continue;
    for (const handler of matcher.hooks) {
      promises.push(
        executeHook(handler, input, client).catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`${LOG_PREFIX} Hook error (${eventName}):`, message);
          return { action: "error", reason: message };
        })
      );
    }
  }
  return Promise.all(promises);
}
function findBlockResult(results) {
  return results.find((r) => r.action === "block");
}
function findUpdatedInput(results) {
  for (const r of results) {
    if (r.updatedInput) return r.updatedInput;
  }
  return void 0;
}
function logAdditionalContext(results, eventName) {
  for (const r of results) {
    if (r.additionalContext) {
      console.log(
        `${LOG_PREFIX} [${eventName}] additionalContext: ${r.additionalContext}`
      );
    }
  }
}
function extractSessionId(properties) {
  if (typeof properties.sessionID === "string") return properties.sessionID;
  if (typeof properties.id === "string") return properties.id;
  if (properties.info && typeof properties.info === "object" && "id" in properties.info && typeof properties.info.id === "string") {
    return properties.info.id;
  }
  return "";
}
function toolResultText(event) {
  if (event?.status === "error") {
    const err = event.error;
    if (typeof err === "string") return err;
    const message = err?.message;
    if (typeof message === "string") return message;
    return "";
  }
  const result = event?.result;
  if (!result) return "";
  if (typeof result.content === "string") return result.content;
  if (Array.isArray(result.content)) {
    return result.content.filter((c) => c?.type === "text").map((c) => c.text ?? "").join("\n");
  }
  if (typeof result.output === "string") return result.output;
  try {
    return JSON.stringify(result.output ?? "");
  } catch {
    return "";
  }
}
async function runSlashCommandHooks(eventName, matchers, sessionId, directory, client) {
  if (!matchers || matchers.length === 0) return;
  const input = {
    session_id: sessionId,
    cwd: directory,
    hook_event_name: eventName
  };
  process.env.OPENCODE_SESSION_ID = sessionId;
  process.env.OPENCODE_HOOK_EVENT = eventName;
  const results = await runHooksForEvent(
    eventName,
    matchers,
    void 0,
    input,
    client
  );
  const block = findBlockResult(results);
  if (block) {
    console.log(
      `${LOG_PREFIX} [${eventName}] Hook requested block: ${block.reason ?? "no reason"}`
    );
  }
  logAdditionalContext(results, eventName);
}
var v2_default = Plugin.define({
  id: "hooks-bridge",
  async setup(ctx) {
    const directory = ctx.location.directory;
    const { hooks, disableAllHooks } = loadConfig(directory);
    if (disableAllHooks) {
      console.log(`${LOG_PREFIX} All hooks disabled (disableAllHooks=true)`);
      return;
    }
    warnUnsupportedEvents(hooks);
    process.env.OPENCODE_PROJECT_DIR = directory;
    const client = {
      session: {
        prompt: async (opts) => {
          const sessionID = process.env.OPENCODE_SESSION_ID ?? "";
          const result = await ctx.session.generate({
            sessionID,
            prompt: opts.prompt
          });
          return { text: result?.text ?? "" };
        }
      }
    };
    await ctx.tool.hook("execute.before", async (event) => {
      const eventName = "PreToolUse";
      const matchers = hooks[eventName];
      if (!matchers || matchers.length === 0) return;
      const args = event.input && typeof event.input === "object" ? event.input : {};
      const ocEvent = {
        sessionId: event.sessionID,
        tool: event.tool,
        args
      };
      const hookInput = buildToolHookInput(eventName, ocEvent, directory);
      process.env.OPENCODE_SESSION_ID = event.sessionID;
      process.env.OPENCODE_HOOK_EVENT = eventName;
      const results = await runHooksForEvent(
        eventName,
        matchers,
        event.tool,
        hookInput,
        client
      );
      const block = findBlockResult(results);
      if (block) {
        throw new Error(block.reason ?? "Blocked by PreToolUse hook");
      }
      const updatedInput = findUpdatedInput(results);
      if (updatedInput && event.input && typeof event.input === "object") {
        Object.assign(event.input, updatedInput);
      }
      logAdditionalContext(results, eventName);
    });
    await ctx.tool.hook("execute.after", async (event) => {
      const ocEvent = {
        sessionId: event.sessionID,
        tool: event.tool,
        args: event.input && typeof event.input === "object" ? event.input : {},
        output: toolResultText(event)
      };
      const eventName = mapToolAfterEvent(ocEvent);
      const matchers = hooks[eventName];
      if (!matchers || matchers.length === 0) return;
      const hookInput = buildToolHookInput(eventName, ocEvent, directory);
      process.env.OPENCODE_SESSION_ID = event.sessionID;
      process.env.OPENCODE_HOOK_EVENT = eventName;
      const results = await runHooksForEvent(
        eventName,
        matchers,
        event.tool,
        hookInput,
        client
      );
      const block = findBlockResult(results);
      if (block) {
        console.log(
          `${LOG_PREFIX} [${eventName}] Hook requested block: ${block.reason ?? "no reason"}`
        );
      }
      logAdditionalContext(results, eventName);
    });
    const onEvent = async (v1Event) => {
      try {
        switch (v1Event.type) {
          // ---- Session lifecycle ----
          case "session.created": {
            const matchers = hooks["SessionStart"];
            if (!matchers || matchers.length === 0) return;
            const sessionId = extractSessionId(v1Event.properties);
            const ocEvent = { sessionId };
            const hookInput = buildSessionHookInput(
              "SessionStart",
              ocEvent,
              directory
            );
            process.env.OPENCODE_SESSION_ID = sessionId;
            process.env.OPENCODE_HOOK_EVENT = "SessionStart";
            const results = await runHooksForEvent(
              "SessionStart",
              matchers,
              void 0,
              hookInput,
              client
            );
            const block = findBlockResult(results);
            if (block) {
              console.log(
                `${LOG_PREFIX} [SessionStart] Hook requested block: ${block.reason ?? "no reason"}`
              );
            }
            logAdditionalContext(results, "SessionStart");
            break;
          }
          case "session.deleted": {
            const matchers = hooks["SessionEnd"];
            if (!matchers || matchers.length === 0) return;
            const sessionId = extractSessionId(v1Event.properties);
            const ocEvent = { sessionId };
            const hookInput = buildSessionHookInput(
              "SessionEnd",
              ocEvent,
              directory
            );
            process.env.OPENCODE_SESSION_ID = sessionId;
            process.env.OPENCODE_HOOK_EVENT = "SessionEnd";
            const results = await runHooksForEvent(
              "SessionEnd",
              matchers,
              void 0,
              hookInput,
              client
            );
            const block = findBlockResult(results);
            if (block) {
              console.log(
                `${LOG_PREFIX} [SessionEnd] Hook requested block: ${block.reason ?? "no reason"}`
              );
            }
            logAdditionalContext(results, "SessionEnd");
            break;
          }
          case "session.idle": {
            const matchers = hooks["Stop"];
            if (!matchers || matchers.length === 0) return;
            const sessionId = extractSessionId(v1Event.properties);
            const ocEvent = { sessionId };
            const hookInput = buildSessionHookInput("Stop", ocEvent, directory);
            process.env.OPENCODE_SESSION_ID = sessionId;
            process.env.OPENCODE_HOOK_EVENT = "Stop";
            const results = await runHooksForEvent(
              "Stop",
              matchers,
              void 0,
              hookInput,
              client
            );
            const block = findBlockResult(results);
            if (block) {
              console.log(
                `${LOG_PREFIX} [Stop] Hook requested block: ${block.reason ?? "no reason"}`
              );
            }
            logAdditionalContext(results, "Stop");
            break;
          }
          // ---- Slash command stubs ----
          case "command.executed": {
            const props = v1Event.properties;
            const commandName = props.name ?? "";
            const sessionId = props.sessionID ?? "";
            if (commandName === "hook-prompt") {
              await runSlashCommandHooks(
                "UserPromptSubmit",
                hooks["UserPromptSubmit"],
                sessionId,
                directory,
                client
              );
            } else if (commandName === "hook-notify") {
              await runSlashCommandHooks(
                "Notification",
                hooks["Notification"],
                sessionId,
                directory,
                client
              );
            } else if (commandName === "hook-precompact") {
              await runSlashCommandHooks(
                "PreCompact",
                hooks["PreCompact"],
                sessionId,
                directory,
                client
              );
            }
            break;
          }
          default:
            break;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `${LOG_PREFIX} Unhandled error in event handler (${v1Event.type}):`,
          message
        );
      }
    };
    const controller = new AbortController();
    void (async () => {
      try {
        for await (const e of ctx.event.subscribe({ signal: controller.signal })) {
          const v1Event = {
            type: e.type,
            properties: e.data ?? e.properties ?? {}
          };
          await onEvent(v1Event);
        }
      } catch (err) {
        const code = err?.code;
        if (code !== "ABORT_ERR") {
          console.warn(`${LOG_PREFIX} Event stream ended:`, err);
        }
      }
    })();
    return () => controller.abort();
  }
});
export {
  v2_default as default
};
