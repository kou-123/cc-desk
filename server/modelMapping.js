/** Shared helpers for Claude Code / CC Switch model alias fields. */

export const ONE_M_RE = /\[1m\]$/i

export function stripOneM(value = '') {
  return String(value || '').trim().replace(ONE_M_RE, '')
}

export function hasOneM(value = '') {
  return ONE_M_RE.test(String(value || '').trim())
}

/** Apply lowercase [1m] suffix when declared. */
export function withOneM(value = '', enabled = false) {
  const base = stripOneM(value)
  if (!base) return ''
  return enabled ? `${base}[1m]` : base
}

/**
 * Read a role from env:
 * - modelId: ANTHROPIC_DEFAULT_*_MODEL (request id, may include [1m])
 * - displayName: ANTHROPIC_DEFAULT_*_MODEL_NAME (menu label)
 */
export function readRole(env, idKey, nameKey) {
  const rawId = env[idKey] || ''
  const rawName = nameKey ? env[nameKey] || '' : ''
  return {
    modelId: stripOneM(rawId),
    displayName: stripOneM(rawName),
    supports1m: hasOneM(rawId) || hasOneM(rawName),
  }
}

export function writeRole(env, idKey, nameKey, { modelId, displayName, supports1m }) {
  if (typeof modelId !== 'string' && typeof displayName !== 'string' && supports1m == null) {
    return
  }
  const id =
    typeof modelId === 'string' ? modelId.trim() : stripOneM(env[idKey] || '')
  const name =
    typeof displayName === 'string'
      ? displayName.trim()
      : stripOneM(env[nameKey] || '')
  const oneM =
    typeof supports1m === 'boolean'
      ? supports1m
      : hasOneM(env[idKey] || '') || hasOneM(env[nameKey] || '')

  if (!id && !name) {
    delete env[idKey]
    if (nameKey) delete env[nameKey]
    return
  }

  const finalId = withOneM(id || name, oneM)
  if (finalId) env[idKey] = finalId
  else delete env[idKey]

  if (nameKey) {
    // Display name stays without [1m] — menu label only.
    const finalName = stripOneM(name || id)
    if (finalName) env[nameKey] = finalName
    else delete env[nameKey]
  }
}

export function readMappingFromEnv(env = {}) {
  const def = readRole(env, 'ANTHROPIC_MODEL', null)
  const sonnet = readRole(
    env,
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME',
  )
  const opus = readRole(
    env,
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME',
  )
  const fable = readRole(
    env,
    'ANTHROPIC_DEFAULT_FABLE_MODEL',
    'ANTHROPIC_DEFAULT_FABLE_MODEL_NAME',
  )
  const haiku = readRole(
    env,
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME',
  )
  const subRaw = env.CLAUDE_CODE_SUBAGENT_MODEL || ''
  return {
    anthropicModel: def.modelId,
    anthropicModel1m: def.supports1m,
    sonnetModel: sonnet.modelId,
    sonnetName: sonnet.displayName,
    sonnet1m: sonnet.supports1m,
    opusModel: opus.modelId,
    opusName: opus.displayName,
    opus1m: opus.supports1m,
    fableModel: fable.modelId,
    fableName: fable.displayName,
    fable1m: fable.supports1m,
    haikuModel: haiku.modelId,
    haikuName: haiku.displayName,
    haiku1m: haiku.supports1m,
    subagentModel: stripOneM(subRaw),
    subagent1m: hasOneM(subRaw),
  }
}

export function applyMappingPatch(env, patch = {}) {
  if ('anthropicModel' in patch || 'anthropicModel1m' in patch) {
    writeRole(env, 'ANTHROPIC_MODEL', null, {
      modelId:
        typeof patch.anthropicModel === 'string'
          ? patch.anthropicModel
          : stripOneM(env.ANTHROPIC_MODEL || ''),
      displayName: '',
      supports1m:
        typeof patch.anthropicModel1m === 'boolean'
          ? patch.anthropicModel1m
          : hasOneM(env.ANTHROPIC_MODEL || ''),
    })
  }

  const roles = [
    [
      'sonnetModel',
      'sonnetName',
      'sonnet1m',
      'ANTHROPIC_DEFAULT_SONNET_MODEL',
      'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME',
    ],
    [
      'opusModel',
      'opusName',
      'opus1m',
      'ANTHROPIC_DEFAULT_OPUS_MODEL',
      'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME',
    ],
    [
      'fableModel',
      'fableName',
      'fable1m',
      'ANTHROPIC_DEFAULT_FABLE_MODEL',
      'ANTHROPIC_DEFAULT_FABLE_MODEL_NAME',
    ],
    [
      'haikuModel',
      'haikuName',
      'haiku1m',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME',
    ],
  ]
  for (const [idField, nameField, oneMField, idKey, nameKey] of roles) {
    if (idField in patch || nameField in patch || oneMField in patch) {
      writeRole(env, idKey, nameKey, {
        modelId:
          typeof patch[idField] === 'string'
            ? patch[idField]
            : stripOneM(env[idKey] || ''),
        displayName:
          typeof patch[nameField] === 'string'
            ? patch[nameField]
            : stripOneM(env[nameKey] || ''),
        supports1m:
          typeof patch[oneMField] === 'boolean'
            ? patch[oneMField]
            : hasOneM(env[idKey] || ''),
      })
    }
  }

  if ('subagentModel' in patch || 'subagent1m' in patch) {
    const id =
      typeof patch.subagentModel === 'string'
        ? patch.subagentModel.trim()
        : stripOneM(env.CLAUDE_CODE_SUBAGENT_MODEL || '')
    const oneM =
      typeof patch.subagent1m === 'boolean'
        ? patch.subagent1m
        : hasOneM(env.CLAUDE_CODE_SUBAGENT_MODEL || '')
    const final = withOneM(id, oneM)
    if (final) env.CLAUDE_CODE_SUBAGENT_MODEL = final
    else delete env.CLAUDE_CODE_SUBAGENT_MODEL
  }
}

export const MAPPING_ENV_KEYS = [
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL_NAME',
  'CLAUDE_CODE_SUBAGENT_MODEL',
]
