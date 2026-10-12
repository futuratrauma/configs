#!/usr/bin/env node

import { homedir } from "node:os";

const CONFIG_EXT_RE = /\.(json|jsonc|yaml|yml|toml|env)$/i;
const JSON_MODE_RE = /\.(json|jsonc)$/i;

function failOpen(message) {
  if (message) process.stderr.write(`[no-config-comments] ${message}\n`);
  process.exit(0);
}

function isExcluded(filePath) {
  const home = homedir();
  const excludedRoots = [
    `${home}/.config/opencode/`,
    `${home}/.config/opencode`,
    "/node_modules/",
    "/.git/",
    "/tmp/",
  ];
  return excludedRoots.some((root) => filePath.includes(root));
}

function targetsConfigFile(filePath) {
  if (CONFIG_EXT_RE.test(filePath)) return true;
  const base = filePath.split("/").pop() ?? "";
  return base.startsWith(".env");
}

function scanLineHashMode(line) {
  let inString = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }
    if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.trim();
    }
  }
  return null;
}

function scanLineJsonMode(line) {
  let inString = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"') {
      inString = ch;
      continue;
    }
    if (ch === "/" && line[i + 1] === "/") return line.trim();
    if (ch === "/" && line[i + 1] === "*") return line.trim();
  }
  return null;
}

function findComment(text, jsonMode) {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const hit = jsonMode ? scanLineJsonMode(lines[i]) : scanLineHashMode(lines[i]);
    if (hit) return { line: i + 1, snippet: hit.slice(0, 80) };
  }
  return null;
}

function extractCandidates(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== "object") return [];
  if (toolName === "Write") return [toolInput.content].filter((v) => typeof v === "string");
  if (toolName === "Edit") return [toolInput.new_string].filter((v) => typeof v === "string");
  if (toolName === "MultiEdit") {
    return Array.isArray(toolInput.edits)
      ? toolInput.edits.map((e) => e?.new_string).filter((v) => typeof v === "string")
      : [];
  }
  return [];
}

try {
  let raw = "";
  process.stdin.setEncoding("utf-8");
  for await (const chunk of process.stdin) raw += chunk;
  const trimmed = raw.trim();
  if (!trimmed) failOpen();

  let payload;
  try {
    payload = JSON.parse(trimmed);
  } catch {
    failOpen("unparseable hook input, allowing");
  }

  const toolName = payload?.tool_name ?? "";
  const toolInput = payload?.tool_input ?? {};
  const filePath = toolInput.file_path ?? toolInput.filePath ?? toolInput.path ?? "";
  if (typeof filePath !== "string" || !filePath) failOpen();

  if (!targetsConfigFile(filePath) || isExcluded(filePath)) process.exit(0);

  const jsonMode = JSON_MODE_RE.test(filePath);
  for (const candidate of extractCandidates(toolName, toolInput)) {
    const hit = findComment(candidate, jsonMode);
    if (hit) {
      process.stderr.write(
        `Blocked: comments are not allowed in config files (${filePath}, line ${hit.line}): ${hit.snippet}\n`
      );
      process.exit(2);
    }
  }
  process.exit(0);
} catch {
  failOpen("unexpected error, allowing");
}
