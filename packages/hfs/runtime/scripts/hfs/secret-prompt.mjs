// secret-prompt.mjs - the values `app secret set` seals: typed at a masked terminal prompt, read as KEY=value lines from
// redirected stdin, or generated. A value stays in memory; the prompt echoes one `*` per character and nothing else.
import fs from "node:fs";
import { SecretError } from "./secret-errors.mjs";

const ENTER = new Set(["\r", "\n"]);
const ERASE = new Set(["\u007f", "\b"]);
const INTERRUPT = "\u0003";
const END = "\u0004";

/**
 * Read one line from a terminal with no echo: `input` a TTY read stream (raw mode while reading), `output` where the label and
 * one `*` per character go (stderr, so stdout stays clean). Backspace erases, Enter ends, Ctrl+C or Ctrl+D on an empty line
 * cancels. Resolves the typed text; the stream is paused, unreferenced (a waiting terminal never holds the process open) and
 * its raw mode restored either way.
 */
export function promptHidden(label, { input = process.stdin, output = (s) => process.stderr.write(s) } = {}) {
  return new Promise((resolve, reject) => {
    const wasRaw = input.isRaw === true;
    let typed = "";
    const finish = (error) => {
      input.removeListener("data", onData);
      input.removeListener("end", onEnd);
      input.setRawMode?.(wasRaw);
      input.pause();
      input.unref?.();
      output("\n");
      if (error) reject(error);
      else resolve(typed);
    };
    const cancelled = () => new SecretError("cancelled at the prompt; nothing was sealed");
    const onEnd = () => finish(typed ? null : cancelled());
    const onData = (chunk) => {
      for (const char of String(chunk)) {
        if (ENTER.has(char)) return finish(null);
        if (char === INTERRUPT || (char === END && !typed)) return finish(cancelled());
        if (ERASE.has(char)) {
          if (typed) {
            typed = [...typed].slice(0, -1).join("");
            output("\b \b");
          }
        } else if (char >= " ") {
          typed += char;
          output("*");
        }
      }
      return undefined;
    };
    output(label);
    input.setRawMode?.(true);
    input.setEncoding?.("utf8");
    input.on("data", onData);
    input.on("end", onEnd);
    input.ref?.();
    input.resume();
  });
}

/** Each key typed once at the terminal, in order; an empty value seals nothing. */
async function typedValues(keys, prompt) {
  const values = {};
  for (const key of keys) {
    const value = await prompt(`${key}: `);
    if (!value) throw new SecretError(`${key} is empty; nothing was sealed`);
    values[key] = value;
  }
  return values;
}

/**
 * The values of `keys` in redirected stdin text: one key takes the whole text as its value (a trailing newline dropped, so a
 * multi-line value survives); several take one `KEY=value` line each (blank and `#` lines skipped, the value after the first
 * `=`, a trailing CR dropped), every key exactly once and no other.
 */
export function stdinValues(keys, text) {
  if (keys.length === 1) {
    const value = String(text).replace(/\r?\n$/u, "");
    if (!value) throw new SecretError("the value on stdin is empty");
    return { [keys[0]]: value };
  }
  const wanted = new Set(keys);
  const values = Object.create(null);
  for (const raw of String(text).split("\n")) {
    const line = raw.replace(/\r$/u, "");
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const at = line.indexOf("=");
    const key = at < 0 ? line.trim() : line.slice(0, at).trim();
    if (at < 0) throw new SecretError(`stdin line for ${key} has no =; give one KEY=value line per key`);
    if (!wanted.has(key)) throw new SecretError(`stdin names ${key}, which this set does not; nothing was sealed`);
    if (Object.hasOwn(values, key)) throw new SecretError(`stdin gives ${key} twice; nothing was sealed`);
    const value = line.slice(at + 1);
    if (!value) throw new SecretError(`${key} is empty on stdin; nothing was sealed`);
    values[key] = value;
  }
  const missing = keys.filter((key) => !Object.hasOwn(values, key));
  if (missing.length) throw new SecretError(`stdin lacks ${missing.join(", ")}; give one KEY=value line per key; nothing was sealed`);
  return { ...values };
}

/**
 * The values `set` seals for `keys`: `--generate <bytes>` random base64url per key; else the `stdin` port (a function returning
 * the text, as the harness CLI hands a host key, or a stream with `fd` and `isTTY`); a terminal is prompted through `prompt`
 * (promptHidden by default), anything else is read whole.
 */
export async function setValues(keys, { generate, stdin, prompt = promptHidden, random }) {
  if (generate !== undefined) {
    const bytes = Number(generate);
    if (!Number.isInteger(bytes) || bytes < 1 || bytes > 1024)
      throw new SecretError("--generate must be a whole byte count from 1 to 1024");
    return Object.fromEntries(keys.map((key) => [key, random(bytes).toString("base64url")]));
  }
  if (typeof stdin === "function") return stdinValues(keys, stdin());
  const source = stdin ?? process.stdin;
  if (source.isTTY) return typedValues(keys, prompt);
  return stdinValues(keys, fs.readFileSync(source.fd ?? 0, "utf8"));
}
