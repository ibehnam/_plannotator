import { describe, expect, test } from 'bun:test'
import type { register } from './register'

// The review gate (this fork, patch 35; apps/hook/server/plan-review-gate.ts)
// needs one behaviour of upstream's mod: with `PLANNOTATOR_PLAN_REVIEW=0` the
// mod passes ExitPlanMode on, at tool.call and at classic.PermissionRequest, so
// Claude Code runs the plugin's command hook, where the gate is asked. This
// fork owns this check, so a release that changes that behaviour fails the
// fork's build. The control (switch unset: the mod reviews) proves the pass is
// the switch, not a mod that never started.

type Hook = ($: unknown, e: unknown, next: (e: unknown) => unknown) => unknown

function hooks(registerOn: typeof register) {
  const held = new Map<string, Hook>()
  registerOn((event: string, ...args: unknown[]) => {
    if (!held.has(event)) held.set(event, args.at(-1) as Hook)
  })
  return (event: string) => held.get(event)!
}

/** Each test gets its own module: session.start decides once per process. */
async function freshRegister(name: string): Promise<typeof register> {
  return ((await import(`./register?${name}`)) as { register: typeof register }).register
}

function engine(env: Record<string, string>) {
  const files = new Map<string, string>([['/bin/sh', '']])
  let now = 1_000_000
  const values: Record<string, string> = { HOME: '/home/me', PLANNOTATOR_DATA_DIR: '/data', PLANNOTATOR_INBOX_TOOL: '0', ...env }
  return {
    env: { get: async (name: string) => values[name], set: async () => undefined },
    fs: {
      exists: async (path: string) => files.has(path) || path === '/data',
      read: async (path: string) => {
        const text = files.get(path)
        if (text === undefined) throw new Error(`ENOENT: ${path}`)
        return text
      },
      write: async (path: string, text: string) => void files.set(path, text),
      mkdir: async () => undefined,
      remove: async () => undefined,
      stat: async () => null,
    },
    session: {
      id: async () => 'sess-gate',
      cwd: async () => '/w',
      root: async () => '/w',
      messages: async () => [],
      version: async () => ({ version: '2.1.316', base: '2.1.316' }),
    },
    clock: { now: async () => now, sleep: async (ms: number) => void (now += ms), every: () => ({ cancel: () => undefined }) },
    store: { get: async () => undefined, set: async () => undefined },
    process: {
      run: async (argv: string[]) => {
        const at = argv.indexOf('plannotator-launch')
        if (at >= 0) files.set(`${argv[at + 1]}/ready`, `${JSON.stringify({ url: 'http://localhost:4321', isRemote: false, port: 4321 })}\n`)
        return { exitCode: 0, stdout: '', stderr: '' }
      },
      spawn: async () => ({ pid: 1 }),
    },
    http: { fetch: async () => ({ status: 404, ok: false, text: '' }) },
    tool: { register: async (spec: { name: string }) => ({ tool: `mcp__plugin_plannotator__${spec.name}` }) },
    command: { list: async () => [], register: async () => undefined },
    ui: { log: () => undefined, status: () => undefined, toast: () => undefined },
    prompt: { submit: async () => undefined, suggest: async () => undefined },
    turn: { abort: async () => undefined },
  }
}

const planCall = { tool: 'ExitPlanMode', tool_use_id: 'toolu_1', plan: '# Ship it\n' }
const permission = { tool_name: 'ExitPlanMode', tool_use_id: 'toolu_1', tool_input: { plan: '# Ship it\n' } }
const passed = { passed: true }

describe('the mod with plan review off passes ExitPlanMode on to the command hook', () => {
  test('PLANNOTATOR_PLAN_REVIEW=0: tool.call and classic.PermissionRequest pass it on', async () => {
    const on = hooks(await freshRegister('review-gate-off'))
    const $ = engine({ PLANNOTATOR_PLAN_REVIEW: '0' })
    await on('session.start')($, { isInteractive: true }, async () => ({ cwd: '/w' }))
    expect(await on('tool.call')($, planCall, () => passed)).toBe(passed)
    expect(await on('classic.PermissionRequest')($, permission, () => passed)).toBe(passed)
  })

  test('control, the switch unset: the mod reviews ExitPlanMode itself', async () => {
    const on = hooks(await freshRegister('review-gate-unset'))
    const $ = engine({})
    await on('session.start')($, { isInteractive: true }, async () => ({ cwd: '/w' }))
    const reviewed = (await on('tool.call')($, planCall, () => passed)) as { deny?: string }
    expect(reviewed).not.toBe(passed)
    expect(reviewed.deny).toContain('NOT approved')
  })
})
