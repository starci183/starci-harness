#!/usr/bin/env node
/**
 * `starci-custom-inventory [root] [--json]`: print every `<Custom reason="...">` region under `root` (default: the working directory).
 * It is an audit report, never a gate: the exit code is 0 whatever it finds.
 */
import { resolve } from "node:path"
import { customInventory, formatCustomInventory } from "./custom-inventory.ts"

const args = process.argv.slice(2)
const json = args.includes("--json")
const root = resolve(args.find((arg) => !arg.startsWith("--")) ?? ".")
const uses = customInventory(root)
process.stdout.write(`${json ? JSON.stringify({ root, count: uses.length, uses }, null, 2) : formatCustomInventory(uses)}\n`)
