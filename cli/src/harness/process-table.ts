import { existsSync, readlinkSync } from "node:fs"
import { join } from "node:path"
import { captureTool } from "../shared/exec.js"

/**
 * The host's process table, read without a shell: each process's pid, parent, image name, working set, command line, the CPU
 * time it used, when it started and, when asked, its working folder. Read by `host load` (harness/host-holders.ts) and by the
 * reap that ends what holds a harness worktree (harness/reap.ts). A read only, never a kill.
 */

/** One process as the host lists it. */
export interface HostProcess {
    readonly pid: number
    readonly ppid: number
    readonly name: string
    readonly workingSetMb: number
    readonly commandLine: string
    /** The CPU time it has used so far (user and kernel, over all its threads) in ms, when the table carries it (Windows). */
    readonly cpuMs: number | null
    /** When it started, epoch ms; null when the host does not say. Tells a live process from a later one that reuses its pid. */
    readonly startedMs: number | null
    /** Its current working folder, read only when asked (`withCwd`); null when the host does not let it be read. */
    readonly cwd: string | null
}

// A process's working folder on Windows sits in its PEB (RTL_USER_PROCESS_PARAMETERS.CurrentDirectory), which no CIM class
// carries; this reads it for a 64-bit process this user may open, and answers null for any other.
const CWD_READER = String.raw`
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class StarciCwd {
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(int access, bool inherit, int pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll")] static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, IntPtr size, out IntPtr read);
    [DllImport("kernel32.dll")] static extern bool IsWow64Process(IntPtr h, out bool wow);
    [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr h, int cls, byte[] info, int len, out int ret);
    static byte[] Read(IntPtr h, long addr, int len) { var b = new byte[len]; IntPtr r; return ReadProcessMemory(h, new IntPtr(addr), b, new IntPtr(len), out r) && r.ToInt64() == len ? b : null; }
    public static string Of(int pid) {
        IntPtr h = OpenProcess(0x0410, false, pid);
        if (h == IntPtr.Zero) return null;
        try {
            bool wow; if (IntPtr.Size != 8 || !IsWow64Process(h, out wow) || wow) return null;
            var pbi = new byte[48]; int ret;
            if (NtQueryInformationProcess(h, 0, pbi, pbi.Length, out ret) != 0) return null;
            var p = Read(h, BitConverter.ToInt64(pbi, 8) + 0x20, 8); if (p == null) return null;
            var us = Read(h, BitConverter.ToInt64(p, 0) + 0x38, 16); if (us == null) return null;
            int len = BitConverter.ToUInt16(us, 0);
            if (len == 0 || len > 4096) return null;
            var s = Read(h, BitConverter.ToInt64(us, 8), len); return s == null ? null : Encoding.Unicode.GetString(s);
        } finally { CloseHandle(h); }
    }
}`

const windowsScript = (withCwd: boolean): string =>
    [
        withCwd ? `Add-Type -TypeDefinition @'\n${CWD_READER}\n'@` : "",
        "$epoch = [datetime]::new(1970, 1, 1, 0, 0, 0, [DateTimeKind]::Utc)",
        "Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ p = $_.ProcessId; q = $_.ParentProcessId; n = $_.Name; w = $_.WorkingSetSize; c = $_.CommandLine; k = $_.KernelModeTime; u = $_.UserModeTime;",
        "s = $(if ($_.CreationDate) { [long]($_.CreationDate.ToUniversalTime() - $epoch).TotalMilliseconds } else { $null });",
        `d = ${withCwd ? "[StarciCwd]::Of([int]$_.ProcessId)" : "$null"} } } | ConvertTo-Json -Compress`,
    ].join("\n")

const listWindows = async (withCwd: boolean): Promise<HostProcess[] | string> => {
    const shell = join(process.env.SystemRoot ?? String.raw`C:\Windows`, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    // -EncodedCommand carries the script as UTF-16LE base64, so the C# source needs no quoting on a command line.
    const encoded = Buffer.from(windowsScript(withCwd), "utf16le").toString("base64")
    const run = await captureTool(shell, ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], process.cwd(), { timeoutMs: 60_000 }).catch((error: unknown) => (error instanceof Error ? error.message : String(error)))
    if (typeof run === "string") return `powershell Win32_Process: ${run}`
    if (run.exitCode !== 0) return `powershell Win32_Process exited ${String(run.exitCode)}`
    let rows: unknown
    try {
        rows = JSON.parse(run.stdout)
    } catch {
        return "powershell Win32_Process printed no json"
    }
    return (Array.isArray(rows) ? rows : [rows]).map((raw) => {
        const row = raw as { readonly p?: number; readonly q?: number; readonly n?: string; readonly w?: number; readonly c?: string | null; readonly k?: number | null; readonly u?: number | null; readonly s?: number | null; readonly d?: string | null }
        // KernelModeTime and UserModeTime count 100 ns units.
        const cpuMs = typeof row.k === "number" && typeof row.u === "number" ? (row.k + row.u) / 10_000 : null
        return { pid: row.p ?? 0, ppid: row.q ?? 0, name: row.n ?? "", workingSetMb: Math.round((row.w ?? 0) / 1_048_576), commandLine: row.c ?? "", cpuMs, startedMs: typeof row.s === "number" ? row.s : null, cwd: typeof row.d === "string" && row.d !== "" ? row.d : null }
    })
}

/** A `ps` elapsed time ("[dd-][hh:]mm:ss[.cc]") in ms; null when it does not parse. */
export const psTimeMs = (text: string): number | null => {
    const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(text.trim())
    if (match === null) return null
    return (((Number(match[1] ?? 0) * 24 + Number(match[2] ?? 0)) * 60 + Number(match[3])) * 60 + Number(match[4])) * 1000
}

/** Every process's working folder where /proc has none: one `lsof -d cwd` over the host (macOS and the BSDs). */
const lsofCwds = async (): Promise<Map<number, string>> => {
    const found = new Map<number, string>()
    const run = await captureTool("lsof", ["-n", "-d", "cwd", "-Fpn"], process.cwd(), { timeoutMs: 30_000 }).catch(() => undefined)
    let pid = 0
    for (const line of (run?.stdout ?? "").split("\n")) {
        if (line.startsWith("p")) pid = Number(line.slice(1))
        else if (line.startsWith("n") && pid > 0) found.set(pid, line.slice(1))
    }
    return found
}

const procCwd = (pid: number): string | null => {
    try {
        return readlinkSync(join("/proc", String(pid), "cwd"))
    } catch {
        return null
    }
}

const listPosix = async (withCwd: boolean): Promise<HostProcess[] | string> => {
    const run = await captureTool("ps", ["-eo", "pid=,ppid=,rss=,etime=,comm=,args="], process.cwd(), { timeoutMs: 30_000 }).catch((error: unknown) => (error instanceof Error ? error.message : String(error)))
    if (typeof run === "string") return `ps: ${run}`
    if (run.exitCode !== 0) return `ps exited ${String(run.exitCode)}`
    const proc = existsSync("/proc/self/cwd")
    const cwds = withCwd && !proc ? await lsofCwds() : new Map<number, string>()
    const at = Date.now()
    return run.stdout.split("\n").flatMap((line) => {
        const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s*(.*)$/.exec(line)
        if (match === null) return []
        const pid = Number(match[1])
        const elapsed = psTimeMs(match[4] ?? "")
        const cwd = withCwd ? (proc ? procCwd(pid) : (cwds.get(pid) ?? null)) : null
        return [{ pid, ppid: Number(match[2]), name: match[5] ?? "", workingSetMb: Math.round(Number(match[3]) / 1024), commandLine: match[6] ?? "", cpuMs: null, startedMs: elapsed === null ? null : at - elapsed, cwd }]
    })
}

/** Every process of the host (`HostProcess`); `withCwd` reads each one's working folder too. A host without the tool answers why not. */
export const listProcesses = async (withCwd = false): Promise<HostProcess[] | string> => (process.platform === "win32" ? listWindows(withCwd) : listPosix(withCwd))
