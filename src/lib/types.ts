export type ElementKind = 'dialogue' | 'sfx' | 'ambience' | 'music' | 'pause'
export type ElementStatus = 'missing' | 'generated' | 'approved' | 'stale'
export type Anchor = 'line' | 'scene'
export type GainRole = 'auto' | 'voice' | 'ambience' | 'spot' | 'impact' | 'bed' | 'theme'

export type Role = 'owner' | 'editor' | 'viewer'

export interface Team {
  id: string
  name: string
  created_by: string
}

export interface TeamMember {
  team_id: string
  user_id: string
  email: string | null
  role: Role
}

export interface TeamInvite {
  id: string
  team_id: string
  email: string
  role: Role
}

export interface Project {
  team_id: string
  id: string
  owner: string
  name: string
  language: string
  language_code: string
  accent: string
  dismissed_patterns: string[]
  mix_target_lufs: number
  music_duck_db: number
  style_notes: string
}

export interface SeriesAsset {
  id: string
  project_id: string
  kind: string
  name: string
  storage_path: string | null
  description: string
  sort: number
  auto: boolean
  match_key: string | null
  uses: number
  duration_ms: number | null
  expected_ms: number | null
  pulse_count: number | null
  provider: string | null
  license_note: string | null
  auto_place: string | null
  locked: boolean
  version: number
}

export interface Character {
  id: string
  project_id: string
  name: string
  description: string
  source: 'catalog' | 'cloned' | 'human'
  voice_id: string | null
  model: string
  stability: number
  similarity: number
  style: number
  direction_notes: string
  accent: string | null
  sample_language: string | null
  consent_url: string | null
  locked: boolean
}

export interface SeriesBlock {
  id: string
  project_id: string
  name: string
  description: string
  entry_asset_id: string | null
  repeat_asset_id: string | null
  return_asset_id: string | null
  repeat_count: number
  trigger_marker: string
  trigger_cue: string
  end_cue: string
}

export interface Episode {
  id: string
  project_id: string
  number: number
  title: string
  script_text: string
  target_min_ms: number
  target_max_ms: number
  lane_gain: Record<string, number>
}

export type Origin = 'script' | 'template' | 'block'
export type BlockRole = 'entry' | 'pulse' | 'return'

export interface AudioElement {
  id: string
  episode_id: string
  idx: number
  origin: Origin
  block_id: string | null
  block_role: BlockRole | null
  block_seq: number
  auto: boolean
  scene: string
  kind: ElementKind
  character_id: string | null
  series_asset_id: string | null
  text_content: string
  source_hash: string
  prompt: string
  anchor: Anchor
  start_ms: number
  duration_ms: number
  gain_role: GainRole
  gain_db: number
  direction: string
  status: ElementStatus
  approved_take_id: string | null
}

export interface Comment {
  id: string
  element_id: string
  episode_id: string
  author: string
  author_email: string | null
  body: string
  resolved: boolean
  created_at: string
}

export interface Take {
  id: string
  element_id: string
  storage_path: string
  duration_ms: number
  prompt_used: string
  provider: string
  cost_cents: number
  created_at: string
}

export interface Job {
  id: string
  episode_id: string
  status: 'queued' | 'running' | 'done' | 'cancelled' | 'failed'
  total: number
  done: number
  failed: number
  message: string
}

/** Gain offsets in dB relative to the voice reference, from the project mix rules. */
export const GAIN_TABLE: Record<Exclude<GainRole, 'auto'>, number> = {
  voice: 0,
  ambience: -18,
  spot: -8,
  impact: 1,
  bed: -20,
  theme: 0,
}
