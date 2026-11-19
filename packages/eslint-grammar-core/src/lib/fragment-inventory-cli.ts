#!/usr/bin/env node
/**
 * `node node_modules/@starci/eslint-grammar-core/dist/lib/fragment-inventory-cli.js [root] [--json]`: print every `<Fragment reason="...">` region under `root` (default: the working directory).
 * It is an audit report, never a gate: the exit code is 0 whatever it finds.
 */
import { resolve } from "node:path"
import { fragmentInventory, formatFragmentInventory } from "./fragment-inventory.ts"

const args = process.argv.slice(2)
const json = args.includes("--json")
const root = resolve(args.find((arg) => !arg.startsWith("--")) ?? ".")
const uses = fragmentInventory(root)
process.stdout.write(`${json ? JSON.stringify({ root, count: uses.length, uses }, null, 2) : formatFragmentInventory(uses)}\n`)
