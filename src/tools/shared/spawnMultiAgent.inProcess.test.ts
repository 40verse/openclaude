/**
 * Tests for handleSpawnInProcess() atomicity and TOCTOU ordering.
 *
 * Key invariants under test:
 *   1. Team file is NOT written when spawnInProcessTeammate() fails.
 *   2. Team file IS written when spawn succeeds.
 *   3. writeTeamFileAsync() is always called AFTER spawnInProcessTeammate()
 *      (spawn-then-persist ordering, not persist-then-spawn).
 *   4. spawnTeammate() re-throws the spawn error without swallowing it.
 *
 * All heavy dependencies are replaced via mock.module() so the tests
 * run without a real filesystem, AppState, or agent process.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

// ─── Call-order tracking ────────────────────────────────────────────────────

const callOrder: string[] = []

// ─── Shared mock state ──────────────────────────────────────────────────────

let spawnShouldSucceed = true

const mockWriteTeamFileAsync = mock(async (_name: string, _file: unknown) => {
  callOrder.push('writeTeamFileAsync')
})

const mockSpawnInProcessTeammate = mock(
  async (config: { name: string; teamName: string }) => {
    callOrder.push('spawnInProcessTeammate')
    if (!spawnShouldSucceed) {
      return {
        success: false,
        agentId: `${config.name}@${config.teamName}`,
        error: 'mock spawn failure',
      }
    }
    return {
      success: true,
      agentId: `${config.name}@${config.teamName}`,
      taskId: 'task-001',
      abortController: new AbortController(),
      teammateContext: { parentSessionId: 'parent-session-id' },
    }
  },
)

const mockStartInProcessTeammate = mock((_opts: unknown) => {
  // fire-and-forget; no return value needed
})

const baseTeamFile = {
  name: 'test-team',
  createdAt: 0,
  leadAgentId: 'team-lead@test-team',
  members: [
    {
      agentId: 'team-lead@test-team',
      name: 'team-lead',
      joinedAt: 0,
      tmuxPaneId: 'leader',
      cwd: '/tmp',
      subscriptions: [],
      backendType: 'in-process',
    },
  ],
}

// ─── Module mocks (must be set up before dynamic import) ───────────────────

beforeEach(() => {
  callOrder.length = 0
  spawnShouldSucceed = true
  mockWriteTeamFileAsync.mockClear()
  mockSpawnInProcessTeammate.mockClear()
  mockStartInProcessTeammate.mockClear()

  mock.module('react', () => ({
    default: { createElement: () => null },
    createElement: () => null,
  }))

  mock.module('../../Task.js', () => ({
    createTaskStateBase: (_id: string, _type: string, desc: string) => ({
      id: _id,
      type: _type,
      description: desc,
      status: 'running',
    }),
    generateTaskId: (_type: string) => `task-${Math.random().toString(36).slice(2)}`,
  }))

  mock.module('../../utils/agentId.js', () => ({
    formatAgentId: (name: string, team: string) => `${name}@${team}`,
    parseAgentId: (id: string) => {
      const [agentName, teamName] = id.split('@')
      return { agentName, teamName }
    },
  }))

  mock.module('../../utils/bash/shellQuote.js', () => ({
    quote: (s: string) => `'${s}'`,
  }))

  mock.module('../../utils/errors.js', () => ({
    errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  }))

  mock.module('../../utils/execFileNoThrow.js', () => ({
    execFileNoThrow: async () => ({ code: 0, stdout: '', stderr: '' }),
  }))

  mock.module('../../utils/swarm/backends/types.js', () => ({
    isPaneBackend: (_type: string) => false,
  }))

  mock.module('../../utils/swarm/constants.js', () => ({
    SWARM_SESSION_NAME: 'claude-swarm',
    TEAM_LEAD_NAME: 'team-lead',
    TEAMMATE_COMMAND_ENV_VAR: 'CLAUDE_TEAMMATE_COMMAND',
    TMUX_COMMAND: 'tmux',
  }))

  mock.module('../../utils/swarm/It2SetupPrompt.js', () => ({
    It2SetupPrompt: () => null,
  }))

  mock.module('../../utils/swarm/spawnUtils.js', () => ({
    buildInheritedEnvVars: () => ({}),
  }))

  mock.module('../../utils/task/framework.js', () => ({
    registerTask: () => {},
    evictTerminalTask: () => {},
    STOPPED_DISPLAY_MS: 3000,
  }))

  mock.module('../../utils/teammateMailbox.js', () => ({
    writeToMailbox: async () => {},
  }))

  mock.module('../AgentTool/loadAgentsDir.js', () => ({
    isCustomAgent: () => false,
  }))

  mock.module('../../utils/swarm/backends/registry.js', () => ({
    isInProcessEnabled: () => true,
    detectAndGetBackend: async () => ({}),
    getBackendByType: () => ({}),
    markInProcessFallback: () => {},
    resetBackendDetection: () => {},
  }))

  mock.module('../../utils/swarm/spawnInProcess.js', () => ({
    spawnInProcessTeammate: mockSpawnInProcessTeammate,
  }))

  mock.module('../../utils/swarm/teamHelpers.js', () => ({
    readTeamFileAsync: async () => ({ ...baseTeamFile, members: [...baseTeamFile.members] }),
    writeTeamFileAsync: mockWriteTeamFileAsync,
    buildTeamContextBlock: (_name: string, _type: string, _file: unknown) =>
      '[TEAM CONTEXT]\n[/TEAM CONTEXT]',
    ensureTeamFileExists: async () => ({ ...baseTeamFile, members: [...baseTeamFile.members] }),
    getTeamFilePath: (name: string) => `/tmp/.claude/teams/${name}/config.json`,
    registerTeamForSessionCleanup: () => {},
    sanitizeAgentName: (n: string) => n,
    sanitizeName: (n: string) => n,
  }))

  mock.module('../../utils/swarm/inProcessRunner.js', () => ({
    startInProcessTeammate: mockStartInProcessTeammate,
  }))

  mock.module('../../bootstrap/state.js', () => ({
    getSessionId: () => 'test-session-id',
    getSessionCreatedTeams: () => new Set<string>(),
    getChromeFlagOverride: () => undefined,
    getFlagSettingsPath: () => undefined,
    getInlinePlugins: () => [],
    getMainLoopModelOverride: () => null,
    getSessionBypassPermissionsMode: () => undefined,
  }))

  mock.module('../../utils/cwd.js', () => ({
    getCwd: () => '/tmp',
  }))

  mock.module('../../utils/config.js', () => ({
    getGlobalConfig: () => ({ teammateDefaultModel: undefined }),
  }))

  mock.module('../../utils/swarm/teammateLayoutManager.js', () => ({
    assignTeammateColor: (_id: string) => '#ff0000',
    createTeammatePaneInSwarmView: async () => 'pane-1',
    enablePaneBorderStatus: async () => {},
    sendCommandToPane: async () => {},
    isInsideTmux: async () => false,
  }))

  mock.module('../../utils/swarm/backends/teammateModeSnapshot.js', () => ({
    getTeammateModeFromSnapshot: () => 'auto',
  }))

  mock.module('../../utils/swarm/teammateModel.js', () => ({
    getHardcodedTeammateModelFallback: () => 'claude-sonnet-4-6',
  }))

  mock.module('../../utils/model/model.js', () => ({
    parseUserSpecifiedModel: (m: string) => m,
  }))

  mock.module('../../utils/debug.js', () => ({
    logForDebugging: () => {},
  }))

  mock.module('../../utils/swarm/backends/detection.js', () => ({
    isTmuxAvailable: async () => false,
    isInsideTmux: async () => false,
  }))

  mock.module('../../utils/bundledMode.js', () => ({
    isInBundledMode: () => false,
  }))
})

afterEach(() => {
  mock.restore()
})

// ─── Minimal ToolUseContext stub ────────────────────────────────────────────

function makeContext(teamName = 'test-team') {
  const state = {
    teamContext: { teamName, teamFilePath: '', leadAgentId: '', teammates: {} },
    tasks: {},
    mainLoopModel: 'claude-sonnet-4-6',
  }
  return {
    setAppState: (updater: (s: unknown) => unknown) => {
      Object.assign(state, updater(state))
    },
    getAppState: () => state,
    toolUseId: 'tool-use-001',
    options: {
      agentDefinitions: { activeAgents: [] },
    },
    messages: [],
  } as unknown as import('../../Tool.js').ToolUseContext
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('handleSpawnInProcess – team file atomicity', () => {
  it('does NOT write the team file when spawnInProcessTeammate fails', async () => {
    spawnShouldSucceed = false

    const { spawnTeammate } = await import('./spawnMultiAgent.js')

    await expect(
      spawnTeammate(
        { name: 'researcher', prompt: 'do some research', team_name: 'test-team' },
        makeContext(),
      ),
    ).rejects.toThrow('mock spawn failure')

    expect(mockWriteTeamFileAsync).not.toHaveBeenCalled()
  })

  it('writes the team file when spawnInProcessTeammate succeeds', async () => {
    spawnShouldSucceed = true

    const { spawnTeammate } = await import('./spawnMultiAgent.js')

    await spawnTeammate(
      { name: 'coder', prompt: 'write some code', team_name: 'test-team' },
      makeContext(),
    )

    expect(mockWriteTeamFileAsync).toHaveBeenCalledTimes(1)
  })

  it('calls spawnInProcessTeammate BEFORE writeTeamFileAsync (no TOCTOU)', async () => {
    spawnShouldSucceed = true

    const { spawnTeammate } = await import('./spawnMultiAgent.js')

    await spawnTeammate(
      { name: 'tester', prompt: 'run the tests', team_name: 'test-team' },
      makeContext(),
    )

    const spawnIdx = callOrder.indexOf('spawnInProcessTeammate')
    const writeIdx = callOrder.indexOf('writeTeamFileAsync')

    expect(spawnIdx).toBeGreaterThanOrEqual(0)
    expect(writeIdx).toBeGreaterThanOrEqual(0)
    expect(spawnIdx).toBeLessThan(writeIdx)
  })

  it('re-throws the spawn error message verbatim', async () => {
    spawnShouldSucceed = false

    const { spawnTeammate } = await import('./spawnMultiAgent.js')

    await expect(
      spawnTeammate(
        { name: 'analyst', prompt: 'analyse the logs', team_name: 'test-team' },
        makeContext(),
      ),
    ).rejects.toThrow('mock spawn failure')
  })

  it('writes team file exactly once per successful spawn', async () => {
    spawnShouldSucceed = true

    const { spawnTeammate } = await import('./spawnMultiAgent.js')

    await spawnTeammate(
      { name: 'writer', prompt: 'draft the docs', team_name: 'test-team' },
      makeContext(),
    )

    expect(mockWriteTeamFileAsync).toHaveBeenCalledTimes(1)
  })

  it('passes the updated team file (with new member) to writeTeamFileAsync', async () => {
    spawnShouldSucceed = true

    const { spawnTeammate } = await import('./spawnMultiAgent.js')

    await spawnTeammate(
      { name: 'reviewer', prompt: 'review the PR', team_name: 'test-team' },
      makeContext(),
    )

    const [writtenName, writtenFile] = mockWriteTeamFileAsync.mock.calls[0] as [
      string,
      { members: Array<{ name: string }> },
    ]
    expect(writtenName).toBe('test-team')
    expect(writtenFile.members.some(m => m.name === 'reviewer')).toBe(true)
  })

  it('does not call startInProcessTeammate when spawn fails', async () => {
    spawnShouldSucceed = false

    const { spawnTeammate } = await import('./spawnMultiAgent.js')

    await expect(
      spawnTeammate(
        { name: 'runner', prompt: 'run the build', team_name: 'test-team' },
        makeContext(),
      ),
    ).rejects.toThrow()

    expect(mockStartInProcessTeammate).not.toHaveBeenCalled()
  })
})
