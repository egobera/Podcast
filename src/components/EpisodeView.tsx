import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, callFunction, signedUrl, uploadAudio, readDuration } from '../lib/supabase'
import {
  parseScript, uniqueCharacters, formatMs, hash, layout, runtime, estimateSpeechMs,
  IDX_SCRIPT_START, IDX_STEP,
} from '../lib/parser'
import { insertBlock, removeBlock, insertVaultAsset, findCueSpans, applyTemplate, missingTemplateAssets } from '../lib/template'
import { pacingFor } from '../lib/pacing'
import { useHistory } from '../lib/history'
import ManualNote from './ManualNote'
import Inspector from './Inspector'
import Suggestions from './Suggestions'
import BottomPanel from './BottomPanel'
import TrimEditor from './TrimEditor'
import { Confirm, ConfirmTyped, Keys, useToast } from './ui'
import { deleteEpisode } from '../lib/deletion'
import { loadUsage } from '../lib/usageQuery'
import { autofillVault, seedVault } from '../lib/autofill'
import ExportPanel from './ExportPanel'
import { Play as PlayIcon, Pause as PauseIcon, Check as CheckIcon } from './icons'
import { usePreview } from '../lib/usePreview'
import { usePhone } from '../lib/useMedia'
import { announce, reportPosition, clearSession } from '../lib/mediaSession'
import { tap } from '../lib/pwa'
import MobileEpisode from './MobileEpisode'
import { EpisodePlayer, findEdges } from '../lib/player'
import type { Clip } from '../lib/player'
import type { AudioElement, Character, Comment, Episode, Job, Project, SeriesAsset, SeriesBlock, Take } from '../lib/types'

const COST_PER_ELEMENT = 0.04

export default function EpisodeView({
  project, episode, userId, userEmail, onDeleted,
}: {
  project: Project
  episode: Episode
  userId: string
  userEmail: string | null
  onDeleted: () => void
}) {
  const [elements, setElements] = useState<AudioElement[]>([])
  const [chars, setChars] = useState<Character[]>([])
  const [assets, setAssets] = useState<SeriesAsset[]>([])
  const [blocks, setBlocks] = useState<SeriesBlock[]>([])
  const [comments, setComments] = useState<Comment[]>([])
  const [missingThemes, setMissingThemes] = useState<{ id: string; name: string }[]>([])
  const [takes, setTakes] = useState<Record<string, Take[]>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [alsoSelected, setAlsoSelected] = useState<Set<string>>(new Set())
  const [script, setScript] = useState(episode.script_text ?? '')
  const [importing, setImporting] = useState(false)
  const [job, setJob] = useState<Job | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [cursor, setCursor] = useState(0)
  const [askGenerate, setAskGenerate] = useState<number | null>(null)
  const [exporting, setExporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [run, setRun] = useState<{ done: number; failed: number; total: number; error: string } | null>(null)
  const cancelRun = useRef(false)
  const [trimming, setTrimming] = useState<{ path: string; title: string } | null>(null)
  /** Rows added by a block or the vault, marked briefly so the eye can find them. */
  const [justAdded, setJustAdded] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<'all' | 'todo' | 'review' | 'done'>('all')
  const toast = useToast()
  const preview = usePreview()
  const phone = usePhone()
  const [phonePlaying, setPhonePlaying] = useState(false)
  const phonePlayer = useRef<EpisodePlayer | null>(null)
  const [phonePos, setPhonePos] = useState(0)
  const history = useHistory(() => load())
  const uploadInput = useRef<HTMLInputElement | null>(null)
  const uploadTarget = useRef<string | null>(null)

  const load = useCallback(async () => {
    const [{ data: els }, { data: cs }, { data: sa }, { data: bl }, { data: cm }] = await Promise.all([
      supabase.from('elements').select('*').eq('episode_id', episode.id).order('idx'),
      supabase.from('characters').select('*').eq('project_id', project.id),
      supabase.from('series_assets').select('*').eq('project_id', project.id),
      supabase.from('series_blocks').select('*').eq('project_id', project.id),
      supabase.from('comments').select('*').eq('episode_id', episode.id).order('created_at'),
    ])
    setElements((els ?? []) as AudioElement[])
    setChars((cs ?? []) as Character[])
    setAssets((sa ?? []) as SeriesAsset[])
    setBlocks((bl ?? []) as SeriesBlock[])
    setComments((cm ?? []) as Comment[])
    setMissingThemes(await missingTemplateAssets(episode.id, project.id))
  }, [episode.id, project.id])

  useEffect(() => { load(); setScript(episode.script_text ?? '') }, [load, episode.id])

  useEffect(() => {
    if (!job || ['done', 'failed', 'cancelled'].includes(job.status)) return
    let stalled = 0
    const t = setInterval(async () => {
      const { data } = await supabase.from('jobs').select('*').eq('id', job.id).single()
      if (data) {
        setJob(data as Job)
        if (data.status === 'done' || data.status === 'failed') load()
        // Still queued after a minute means the worker never woke up.
        if (data.status === 'queued' && ++stalled > 24) {
          toast('The run never started. Background functions need a paid Netlify plan.', 'bad')
          setJob(null)
        }
      }
    }, 2500)
    return () => clearInterval(t)
  }, [job, load])

  async function loadTakes(elementId: string) {
    const { data } = await supabase.from('takes').select('*')
      .eq('element_id', elementId).order('created_at', { ascending: false })
    setTakes(t => ({ ...t, [elementId]: (data ?? []) as Take[] }))
  }

  /**
   * Re-reading the script replaces only what came from the script.
   * Template themes and inserted freeze blocks survive untouched, and approved takes
   * whose line has not changed keep their audio.
   */
  async function importScript() {
    setImporting(true)
    setError('')
    setNotice('')
    try {
      const { elements: parsed, marks, cast } = parseScript(script)
      if (parsed.length === 0) {
        setError('No lines found. Character lines look like NAME: text and sound cues go in parentheses.')
        return
      }

      const existing = new Map(chars.map(c => [c.name, c]))
      const described = new Map(cast.map(c => [c.name, c.description]))

      const missing = uniqueCharacters(parsed).filter(n => !existing.has(n))
      if (missing.length) {
        const { data } = await supabase.from('characters')
          .insert(missing.map(name => ({
            project_id: project.id,
            name,
            description: described.get(name) ?? '',
          }))).select()
        for (const c of (data ?? []) as Character[]) existing.set(c.name, c)
      }

      // Fill in descriptions the script provides, but never overwrite one someone edited.
      for (const [name, description] of described) {
        const c = existing.get(name)
        if (c && !c.description?.trim() && description) {
          await supabase.from('characters').update({ description }).eq('id', c.id)
        }
      }

      const scriptElements = elements.filter(e => e.origin === 'script')
      const previous = new Map(scriptElements.map(e => [`${e.kind}:${e.source_hash}`, e]))
      const kept = scriptElements.filter(e => e.status === 'approved').length

      // Script elements are replaced, and so are blocks that inserted themselves.
      // Blocks a person placed by hand survive untouched.
      await supabase.from('elements').delete().eq('episode_id', episode.id).eq('origin', 'script')
      await supabase.from('elements').delete()
        .eq('episode_id', episode.id).eq('origin', 'block').eq('auto', true)

      const rows = parsed.map(p => {
        const h = hash(p.text)
        const old = previous.get(`${p.kind}:${h}`)
        return {
          episode_id: episode.id,
          idx: IDX_SCRIPT_START + p.idx * IDX_STEP,
          scene: p.scene,
          kind: p.kind,
          character_id: p.characterName ? existing.get(p.characterName)?.id ?? null : null,
          text_content: p.text,
          source_hash: h,
          origin: 'script',
          anchor: p.anchor,
          gain_role: p.gainRole,
          direction: p.direction,
          duration_ms: old?.duration_ms ?? p.estimatedMs,
          // A pause is silence. There is nothing to generate, so it is done on arrival.
          status: p.kind === 'pause' || old?.status === 'approved' ? 'approved' : 'missing',
          approved_take_id: old?.approved_take_id ?? null,
          prompt: old?.prompt ?? '',
        }
      })

      const { data: inserted } = await supabase.from('elements').insert(rows).select()
      await supabase.from('episodes').update({ script_text: script }).eq('id', episode.id)

      const fresh = (inserted ?? []) as AudioElement[]

      // Now place the blocks the script asked for.
      const placed = await applyAutoBlocks(fresh, marks)

      // And fill the vault: link what it already has, add what this script needs.
      await seedVault(project.id)
      const filled = await autofillVault(project.id, fresh)

      await load()

      const carried = rows.filter(r => r.status === 'approved').length
      const bits: string[] = []
      if (kept > 0) {
        bits.push(`${carried} of ${kept} approved takes carried over`)
        if (kept - carried > 0) bits.push(`${kept - carried} lines changed and need a new take`)
      }
      if (placed > 0) bits.push(`${placed} ${placed === 1 ? 'block' : 'blocks'} placed automatically`)
      if (filled.linked > 0) bits.push(`${filled.linked} sounds linked to the vault`)
      if (filled.created > 0) bits.push(`${filled.created} new vault entries`)
      if (bits.length) setNotice(bits.join('. ') + '.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  /**
   * Places every block the script asks for: first by marker, then by stage direction for
   * blocks that declare one. Everything placed here is flagged automatic, so the next read
   * of the script can rebuild it without disturbing manual work.
   */
  async function applyAutoBlocks(fresh: AudioElement[], marks: { name: string; fromIdx: number; toIdx: number }[]) {
    if (blocks.length === 0) return 0
    const byIdx = new Map(fresh.map(e => [(e.idx - IDX_SCRIPT_START) / IDX_STEP, e]))
    let count = 0
    const claimed = new Set<number>()

    for (const mark of marks) {
      const block = blocks.find(b =>
        (b.trigger_marker || b.name).toLowerCase() === mark.name.toLowerCase())
      const from = byIdx.get(mark.fromIdx)
      const to = byIdx.get(mark.toIdx)
      if (!block || !from || !to) continue
      try {
        await insertBlock(episode.id, block, assets, from, to, true)
        for (let i = mark.fromIdx; i <= mark.toIdx; i++) claimed.add(i)
        count++
      } catch { /* the block has no audio yet, skip it quietly */ }
    }

    // Stage direction fallback, for scripts written before markers existed.
    for (const block of blocks) {
      if (!block.trigger_cue) continue
      for (const span of findCueSpans(block, fresh)) {
        const fromKey = (span.fromIdx - IDX_SCRIPT_START) / IDX_STEP
        const toKey = (span.toIdx - IDX_SCRIPT_START) / IDX_STEP
        if (claimed.has(fromKey)) continue
        const from = byIdx.get(fromKey)
        const to = byIdx.get(toKey)
        if (!from || !to) continue
        try {
          await insertBlock(episode.id, block, assets, from, to, true)
          count++
        } catch { /* skip */ }
      }
    }
    return count
  }

  function flag(ids: string[]) {
    setJustAdded(new Set(ids))
    setTimeout(() => setJustAdded(new Set()), 1400)
  }

  async function addBlockAround(el: AudioElement, blockId: string) {
    const block = blocks.find(b => b.id === blockId)
    if (!block) return
    try {
      const before = new Set(elements.map(e => e.id))
      await insertBlock(episode.id, block, assets, el)
      const { data } = await supabase.from('elements').select('id').eq('episode_id', episode.id)
      flag((data ?? []).map(r => r.id).filter(id => !before.has(id)))
      await load()
      toast(`${block.name} wrapped around that line. The repeats spread across it and move with it.`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not insert the block', 'bad')
    }
  }

  async function addVaultAsset(el: AudioElement, assetId: string, anchor: 'line' | 'scene') {
    const asset = assets.find(a => a.id === assetId)
    if (!asset) return
    await insertVaultAsset(episode.id, asset, el, anchor)
    await load()
  }

  /**
   * One take, or three.
   *
   * A single generation forces you to judge it against a memory of the last one, which is
   * a bad way to choose a performance. Three at once turns it into a comparison, and the
   * difference between them is usually larger than the difference a prompt tweak makes.
   */
  async function generateOne(el: AudioElement, count = 1) {
    preview.stop()
    setBusyId(el.id)
    setError('')
    try {
      for (let i = 0; i < count; i++) {
        await callFunction('generate-element', { element_id: el.id })
      }
      await load()
      await loadTakes(el.id)
      if (count > 1) toast(`${count} takes ready. Play them one after the other.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setBusyId(null)
    }
  }

  /**
   * The first pass runs from the browser, one element at a time.
   *
   * It used to be handed to a Netlify background function, which needs a paid plan and,
   * worse, was written to answer immediately and finish the work afterwards. The runtime
   * freezes a function the moment it responds, so the work never happened and the counter
   * sat at zero forever.
   *
   * Driving it from here is slower per call but it works on any plan, the progress is real
   * because it counts finished calls, and it can be stopped halfway.
   */
  async function runFirstPass() {
    preview.stop()

    const pending = elements.filter(e => e.status === 'missing' || e.status === 'stale')

    /*
     * Vault entries the episode points at but nobody has filled.
     *
     * These elements arrive marked approved, because a vault asset is meant to exist
     * already, so the batch skipped them and the episode played silence where a doorbell
     * should be. They belong in the same run.
     */
    const usedAssetIds = new Set(
      elements.map(e => e.series_asset_id).filter(Boolean) as string[],
    )
    const emptyAssets = assets.filter(a =>
      usedAssetIds.has(a.id) && !a.storage_path && a.kind === 'sfx')

    if (pending.length === 0 && emptyAssets.length === 0) {
      toast('Nothing left to generate.')
      return
    }

    cancelRun.current = false
    const total = pending.length + emptyAssets.length
    setRun({ done: 0, failed: 0, total, error: '' })

    const queue = [...pending]
    let done = 0
    let failed = 0
    let lastError = ''

    // Two at a time. More and ElevenLabs starts refusing.
    const workers = Array.from({ length: 2 }, async () => {
      while (queue.length && !cancelRun.current) {
        const el = queue.shift()!
        try {
          await callFunction('generate-element', { element_id: el.id })
          done++
        } catch (e) {
          failed++
          lastError = e instanceof Error ? e.message : String(e)
        }
        setRun({ done, failed, total, error: lastError })
      }
    })

    await Promise.all(workers)

    for (const asset of emptyAssets) {
      if (cancelRun.current) break
      try {
        await callFunction('generate-sound', {
          asset_id: asset.id,
          prompt: (asset.description ?? '').trim() || asset.name,
          seconds: asset.expected_ms ? asset.expected_ms / 1000 : undefined,
        })
        done++
      } catch (e) {
        failed++
        lastError = e instanceof Error ? e.message : String(e)
      }
      setRun({ done, failed, total, error: lastError })
    }
    await load()
    setRun(null)

    if (cancelRun.current) { toast(`Stopped. ${done} generated.`); return }
    if (failed > 0) toast(`${done} generated, ${failed} failed. ${lastError}`, 'bad')
    else toast(`${done} takes ready to review.`)
  }

  /**
   * Approve everything that generated cleanly.
   *
   * Approval locks a take and pins the timing to the audio. Doing that 150 times by hand
   * after a first pass is the largest piece of work left, and nothing about it is a
   * judgement: the judgement is which takes to redo, and that is easier to make once the
   * whole thing plays.
   */
  async function approveAll() {
    const waiting = elements.filter(e => e.status === 'generated')
    if (waiting.length === 0) { toast('Nothing waiting for approval.'); return }

    const before = waiting.map(e => ({
      id: e.id, status: e.status, approved_take_id: e.approved_take_id,
    }))

    setBusyId('bulk')
    try {
      const { data: takeRows } = await supabase.from('takes')
        .select('id, element_id, storage_path, duration_ms, created_at')
        .in('element_id', waiting.map(e => e.id))
        .order('created_at', { ascending: false })

      const newest = new Map<string, { id: string; duration_ms: number }>()
      for (const t of takeRows ?? []) {
        if (!newest.has(t.element_id)) newest.set(t.element_id, { id: t.id, duration_ms: t.duration_ms })
      }

      for (const el of waiting) {
        const take = newest.get(el.id)
        if (!take) continue
        await supabase.from('elements').update({
          approved_take_id: take.id,
          status: 'approved',
          duration_ms: take.duration_ms || el.duration_ms,
          source_hash: hash(el.text_content),
        }).eq('id', el.id)
      }

      await load()
      history.record({
        label: `approve ${waiting.length}`,
        undo: async () => {
          for (const row of before) {
            await supabase.from('elements')
              .update({ status: row.status, approved_take_id: row.approved_take_id })
              .eq('id', row.id)
          }
        },
        redo: async () => {
          for (const el of waiting) {
            const take = newest.get(el.id)
            if (take) {
              await supabase.from('elements')
                .update({ status: 'approved', approved_take_id: take.id }).eq('id', el.id)
            }
          }
        },
      })
      toast(`${waiting.length} approved. Listen, and redo the ones that are wrong.`)
    } finally {
      setBusyId(null)
    }
  }

  async function approve(el: AudioElement, take: Take, advance = false) {
    // Measure the dead air at each end once, here, so the timeline can skip it from now on.
    let lead = 0
    let tail = 0
    try {
      const url = await signedUrl(take.storage_path)
      if (url) {
        const ctx = new AudioContext()
        const buf = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer())
        const edges = findEdges(buf)
        lead = Math.round(edges.lead * 1000)
        tail = Math.round(edges.tail * 1000)
        await ctx.close()
      }
    } catch { /* measuring is a bonus, not a requirement */ }

    await supabase.from('elements').update({
      approved_take_id: take.id,
      status: 'approved',
      duration_ms: take.duration_ms || el.duration_ms,
      lead_silence_ms: lead,
      tail_silence_ms: tail,
      source_hash: hash(el.text_content),
    }).eq('id', el.id)
    await load()
    if (advance) goToNext()
  }

  /** Moves the cursor to the next row that still needs attention. */
  function goToNext(from = cursor) {
    const next = visibleRef.current.findIndex((e, i) => i > from && e.status !== 'approved')
    const target = next === -1 ? Math.min(from + 1, visibleRef.current.length - 1) : next
    const el = visibleRef.current[target]
    if (!el) return
    setCursor(target)
    setSelected(el.id)
    loadTakes(el.id)
    reveal(el.id)
  }

  async function uploadOwn(elementId: string, file: File) {
    setBusyId(elementId)
    try {
      if (!file.type.startsWith('audio/') && !/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name)) {
        toast('That does not look like an audio file.', 'bad')
        return
      }
      const duration = await readDuration(file)
      const path = await uploadAudio(userId, project.id, file.name, file)
      const { data } = await supabase.from('takes').insert({
        element_id: elementId, storage_path: path, duration_ms: duration, provider: 'upload',
      }).select().single()
      const el = elements.find(e => e.id === elementId)!
      if (data) await approve(el, data as Take)
      await loadTakes(elementId)
      toast(`Uploaded and approved. ${formatMs(duration)}`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Upload failed', 'bad')
    } finally {
      setBusyId(null)
    }
  }

  async function play(el: AudioElement) {
    let path: string | null = null
    if (el.series_asset_id) {
      path = assets.find(a => a.id === el.series_asset_id)?.storage_path ?? null
    } else if (el.approved_take_id) {
      const list = takes[el.id] ?? []
      path = list.find(t => t.id === el.approved_take_id)?.storage_path ?? null
      if (!path) {
        const { data } = await supabase.from('takes').select('storage_path')
          .eq('id', el.approved_take_id).single()
        path = data?.storage_path ?? null
      }
    } else {
      // No approved take, so play the newest one. Reviewing comes before approving.
      const { data } = await supabase.from('takes').select('storage_path')
        .eq('element_id', el.id).order('created_at', { ascending: false }).limit(1)
      path = data?.[0]?.storage_path ?? null
    }
    if (!path) return
    if (preview.playing === path) { preview.stop(); return }
    const url = await signedUrl(path)
    if (url) preview.toggle(path, url)
  }

  const positionedRef = useRef<(AudioElement & { start_ms: number })[]>([])
  const totalRef = useRef(0)

  /** Resolves every playable element to a signed URL so the mix can be assembled. */
  const buildClips = useCallback(async (): Promise<Clip[]> => {
    /*
     * Approved audio wins, but an unapproved take still plays.
     *
     * This used to require approval, which meant an episode you had just generated came
     * back silent, and the only way to hear a take was to approve it first. Reviewing is
     * listening; approval is what you do afterwards.
     */
    const candidates = positionedRef.current.filter(e => e.kind !== 'pause')

    const { data: allTakes } = await supabase.from('takes')
      .select('id, element_id, storage_path, created_at')
      .in('element_id', candidates.map(e => e.id))
      .order('created_at', { ascending: false })

    const newestByElement = new Map<string, string>()
    const pathById = new Map<string, string>()
    for (const t of allTakes ?? []) {
      pathById.set(t.id, t.storage_path)
      if (!newestByElement.has(t.element_id)) newestByElement.set(t.element_id, t.storage_path)
    }

    const withAudio = candidates.filter(e =>
      e.series_asset_id || e.approved_take_id || newestByElement.has(e.id))

    if (withAudio.length === 0) {
      toast('Nothing to play yet. Generate a take or add audio from the vault.')
      return []
    }
    const takePath = pathById

    const clips: Clip[] = []
    for (const el of withAudio) {
      const path = el.series_asset_id
        ? assets.find(a => a.id === el.series_asset_id)?.storage_path
        : el.approved_take_id
          ? takePath.get(el.approved_take_id)
          : newestByElement.get(el.id)
      if (!path) continue
      const url = await signedUrl(path)
      if (!url) continue
      const role = el.gain_role === 'auto'
        ? (el.kind === 'dialogue' ? 'voice' : el.kind === 'music' ? 'bed' : 'spot')
        : el.gain_role
      clips.push({
        id: el.id, url, startMs: el.start_ms, durationMs: el.duration_ms,
        role, anchor: el.anchor, gainDb: el.gain_db ?? 0,
        leadMs: el.lead_silence_ms ?? 0,
        fadeInMs: el.fade_in_ms ?? undefined,
        fadeOutMs: el.fade_out_ms ?? undefined,
      })
    }
    /*
     * Room tone, under everything.
     *
     * The gaps between lines were true digital silence, and nothing recorded in a real
     * room is ever that quiet. That absolute nothing between every line is a large part
     * of why an episode sounds synthetic. One very quiet bed, looped underneath, is what
     * makes the silences sound like a room instead of a file.
     */
    const under = assets.find(a => a.auto_place === 'under' && a.storage_path)
    if (under) {
      const url = await signedUrl(under.storage_path!)
      if (url) {
        clips.push({
          id: `roomtone-${under.id}`,
          url,
          startMs: 0,
          durationMs: totalRef.current,
          role: 'ambience',
          anchor: 'scene',
          gainDb: -12,
          loop: true,
          loopUntilMs: totalRef.current,
        })
      }
    }

    return clips
  }, [assets, toast])

  const starts = useMemo(() => layout(elements, pacingFor(episode)), [elements, episode])
  const positioned = useMemo(
    () => elements.map(e => ({ ...e, start_ms: starts.get(e.id) ?? 0 }))
      .sort((a, b) => a.start_ms - b.start_ms || a.idx - b.idx),
    [elements, starts],
  )
  const total = useMemo(() => runtime(elements, starts), [elements, starts])
  totalRef.current = total

  positionedRef.current = positioned

  const allRows = positioned.filter(e => e.block_role !== 'pulse')
  const counts = {
    all: allRows.length,
    todo: allRows.filter(e => e.status === 'missing' || e.status === 'stale').length,
    review: allRows.filter(e => e.status === 'generated').length,
    done: allRows.filter(e => e.status === 'approved').length,
  }
  const visible = allRows.filter(e =>
    filter === 'all' ? true
      : filter === 'todo' ? (e.status === 'missing' || e.status === 'stale')
        : filter === 'review' ? e.status === 'generated'
          : e.status === 'approved')
  const approved = elements.filter(e => e.status === 'approved').length
  const pct = elements.length ? Math.round((approved / elements.length) * 100) : 0
  const inRange = total >= episode.target_min_ms && total <= episode.target_max_ms
  const usableBlocks = blocks.filter(b =>
    [b.entry_asset_id, b.repeat_asset_id, b.return_asset_id]
      .some(id => assets.some(a => a.id === id && a.storage_path)))

  const visibleRef = useRef(visible)
  visibleRef.current = visible

  const selectedEl = positioned.find(e => e.id === selected) ?? null
  const blockPulses = selectedEl?.block_id
    ? positioned.filter(e => e.block_id === selectedEl.block_id && e.block_role === 'pulse')
    : []
  const blockReturnMs = selectedEl?.block_id
    ? positioned.find(e => e.block_id === selectedEl.block_id && e.block_role === 'return')?.start_ms ?? null
    : null
  const pulseCount = blockPulses.length

  /**
   * Held arrow keys queue up smooth scrolls faster than they can finish, and the page ends
   * up trailing the cursor by half a screen. Anything under a quarter of a second after
   * the last move jumps instead.
   */
  const lastMove = useRef(0)
  function reveal(id: string) {
    const now = performance.now()
    const fast = now - lastMove.current < 250
    lastMove.current = now
    document.getElementById(`row-${id}`)?.scrollIntoView({
      block: 'center',
      behavior: fast ? 'auto' : 'smooth',
    })
  }

  const openNotes = new Map<string, number>()
  for (const c of comments) {
    if (!c.resolved) openNotes.set(c.element_id, (openNotes.get(c.element_id) ?? 0) + 1)
  }

  const scriptCount = elements.filter(e => e.origin === 'script').length

  /**
   * Keyboard review. Approving 160 elements with a mouse is not a workflow, it is a chore.
   * Arrows move, Enter opens, A approves the newest take, G asks for another one.
   */
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
      if (e.metaKey || e.ctrlKey || visible.length === 0) return

      const move = (delta: number) => {
        e.preventDefault()
        const next = Math.min(Math.max(cursor + delta, 0), visible.length - 1)
        setCursor(next)
        setSelected(visible[next].id)
        loadTakes(visible[next].id)
        reveal(visible[next].id)
      }

      if (e.key === 'ArrowDown' || e.key === 'j') return move(1)
      if (e.key === 'ArrowUp' || e.key === 'k') return move(-1)

      const el = visible[cursor]
      if (!el) return
      if (e.key === 'Enter') { e.preventDefault(); setSelected(s => s === el.id ? null : el.id); loadTakes(el.id) }
      if (e.key === 'a') {
        const newest = (takes[el.id] ?? [])[0]
        if (newest) { await approve(el, newest, true) }
        else toast('No take to approve on this line yet.')
      }
      if (e.key === 'g' && el.origin === 'script') generateOne(el)
      if (e.key === 'n') { e.preventDefault(); goToNext() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  if (scriptCount === 0) {
    return (
      <div className="page">
        <h2>{episode.title}</h2>
        <p className="lede">
          Paste the script and Estudio turns it into a list of everything this episode needs.
          Character lines look like <code>NAME: text</code>. Sound cues go in parentheses on their own line.
          {elements.length > 0 && ' The themes from your vault are already in place.'}
        </p>
        <div className="field">
          <label htmlFor="script">Script</label>
          <textarea id="script" value={script} onChange={e => setScript(e.target.value)} style={{ minHeight: 340 }} />
        </div>
        {error && <p className="error">{error}</p>}
        <div className="btn-row" style={{ marginTop: 14 }}>
          <button className="btn" data-variant="primary" disabled={!script.trim() || importing} onClick={importScript}>
            {importing ? 'Reading' : 'Read script'}
          </button>
        </div>
      </div>
    )
  }

  let lastScene = ''

  if (phone) {
    return (
      <MobileEpisode
        episode={episode}
        elements={positioned}
        characters={chars}
        comments={comments}
        busyId={busyId}
        total={total}
        position={phonePos}
        playingAll={phonePlaying}
        onPlayElement={play}
        onGenerate={el => generateOne(el, 1)}
        onApprove={async el => {
          const { data } = await supabase.from('takes').select('*')
            .eq('element_id', el.id).order('created_at', { ascending: false }).limit(1)
          const take = (data ?? [])[0] as Take | undefined
          if (take) await approve(el, take)
        }}
        onPlayAll={async () => {
          tap()
          if (phonePlaying) {
            phonePlayer.current?.pause()
            setPhonePlaying(false)
            reportPosition(phonePos, total, false)
            return
          }
          preview.stop()
          if (!phonePlayer.current) {
            phonePlayer.current = new EpisodePlayer(project.music_duck_db)
            const clips = await buildClips()
            if (clips.length === 0) return
            await phonePlayer.current.prepare(clips)
          }
          phonePlayer.current.play(phonePos)
          setPhonePlaying(true)
          /*
           * The lock screen. An episode is seven minutes and people listen while doing
           * something else, so the screen goes off and the audio has to stay reachable.
           */
          announce({
            title: episode.title,
            series: project.name,
            onPlay: () => { phonePlayer.current?.play(phonePos); setPhonePlaying(true) },
            onPause: () => { phonePlayer.current?.pause(); setPhonePlaying(false) },
            onSeek: to => { phonePlayer.current?.seek(to); setPhonePos(to) },
          })

          const tick = () => {
            const at = phonePlayer.current?.currentMs ?? 0
            setPhonePos(at)
            reportPosition(at, total, !!phonePlayer.current?.playing)
            if (at < total && phonePlayer.current?.playing) requestAnimationFrame(tick)
            else { setPhonePlaying(false); reportPosition(at, total, false) }
          }
          requestAnimationFrame(tick)
        }}
      />
    )
  }

  return (
    <>
      <div className="progress-bar">
        <div className="segmented" role="group" aria-label="Filter lines">
          {([
            ['all', 'All'], ['todo', 'To do'], ['review', 'Review'], ['done', 'Done'],
          ] as const).map(([key, label]) => (
            <button key={key} aria-pressed={filter === key} onClick={() => { setFilter(key); setCursor(0) }}>
              {label}<span className="n">{counts[key]}</span>
            </button>
          ))}
        </div>
        <div className="meter"><span style={{ width: `${pct}%` }} /></div>
        <span className="meter-text" style={{ color: inRange ? 'var(--blue)' : 'var(--alert)' }}>
          {formatMs(total)} / {formatMs(episode.target_min_ms)} to {formatMs(episode.target_max_ms)}
        </span>
        {run ? (
          <button className="btn" onClick={() => { cancelRun.current = true }}>
            Stop · {run.done + run.failed}/{run.total}
          </button>
        ) : (
          <button
            className="btn" data-variant="primary"
            onClick={() => {
              const pending = elements.filter(e => e.status === 'missing' || e.status === 'stale').length
              if (pending === 0) { toast('Nothing left to generate.'); return }
              setAskGenerate(pending)
            }}
          >
            Generate first pass
          </button>
        )}
        {counts.review > 0 && (
          <button className="btn" disabled={busyId === 'bulk'} onClick={approveAll}
            title="Lock every take that is waiting, and pin the timings to the audio">
            {busyId === 'bulk' ? 'Approving' : `Approve ${counts.review}`}
          </button>
        )}

        <div className="undo-pair">
          <button className="btn" data-variant="quiet" disabled={!history.canUndo}
            onClick={() => history.undo()}
            title={history.canUndo ? `Undo ${history.lastLabel} (⌘Z)` : 'Nothing to undo'}>
            Undo
          </button>
          <button className="btn" data-variant="quiet" disabled={!history.canRedo}
            onClick={() => history.redo()}
            title={history.canRedo ? `Redo ${history.nextLabel} (⇧⌘Z)` : 'Nothing to redo'}>
            Redo
          </button>
        </div>
        <button className="btn" onClick={() => setExporting(true)}>Export</button>
      </div>

      <div className="episode-grid">
      <div className="page">
        <h2>{episode.title}</h2>
        <p className="lede">
          Every line and every sound this episode needs, in the order the listener hears it.
        </p>

        {error && <p className="error">{error}</p>}
        {notice && <p className="notice">{notice}</p>}
        {run && run.error && (
          <p className="error">Last failure: {run.error}</p>
        )}

        {visible.length === 0 && (
          <div className="empty">
            {filter === 'todo'
              ? 'Nothing left to make. Every line has audio.'
              : filter === 'review'
                ? 'Nothing waiting for you. Generate a take or switch to All.'
                : 'No lines here yet.'}
          </div>
        )}

        {visible.map(el => {
          const showScene = el.scene !== lastScene
          lastScene = el.scene
          const char = chars.find(c => c.id === el.character_id)
          const isOpen = selected === el.id
          const isBlock = el.origin === 'block'
          const isTemplate = el.origin === 'template'
          const pulses = el.block_role === 'entry'
            ? positioned.filter(p => p.block_id === el.block_id && p.block_role === 'pulse')
            : []

          return (
            <div key={el.id}>
              {showScene && <div className="scene-head">{el.scene}</div>}
              <div
                id={`row-${el.id}`}
                className="row"
                data-kind={el.kind}
                data-selected={isOpen}
                data-cursor={visible[cursor]?.id === el.id}
                data-new={justAdded.has(el.id)}
                onClick={() => { setSelected(isOpen ? null : el.id); if (!isOpen) loadTakes(el.id) }}
              >
                <span className="row-who">
                  {char?.name ?? (isTemplate ? 'theme' : isBlock ? 'block'
                    : el.kind === 'pause' ? 'pause'
                      : el.kind === 'music' ? 'music'
                        : el.kind === 'ambience' ? 'ambience' : 'sound')}
                </span>
                <span className="row-text">
                  {el.text_content}
                  {el.block_role === 'entry' && pulses.length > 0 && (
                    <span className="dur" style={{ marginLeft: 10 }}>
                      {pulses.length} pulses to {formatMs((positioned.find(p =>
                        p.block_id === el.block_id && p.block_role === 'return')?.start_ms) ?? 0)}
                    </span>
                  )}
                </span>
                <span className="row-side">
                  <span className="row-actions">
                    {(el.series_asset_id || el.approved_take_id || el.status === 'generated') && (
                      <button className="icon-btn" title="Play this" aria-label="Play this"
                        data-on={!!el.approved_take_id && preview.playing !== null}
                        onClick={ev => { ev.stopPropagation(); play(el) }}>
                        <PlayIcon size={12} />
                      </button>
                    )}
                    {el.status === 'generated' && (
                      <button className="icon-btn" title="Approve the newest take"
                        onClick={async ev => {
                          ev.stopPropagation()
                          const list = takes[el.id] ?? await (async () => {
                            const { data } = await supabase.from('takes').select('*')
                              .eq('element_id', el.id).order('created_at', { ascending: false })
                            return (data ?? []) as Take[]
                          })()
                          if (list[0]) approve(el, list[0])
                        }} aria-label="Approve the newest take"><CheckIcon size={13} /></button>
                    )}
                  </span>
                  {openNotes.get(el.id) && (
                    <span className="note-count tnum" title="Open notes on this line">
                      {openNotes.get(el.id)}
                    </span>
                  )}
                  <span className="dur">{formatMs(el.start_ms)}</span>
                  <span className="pip" data-s={el.status} title={el.status} />
                </span>
              </div>

            </div>
          )
        })}

        <Suggestions
          project={project}
          elements={elements.filter(e => e.origin === 'script')}
          fullElements={elements.filter(e => e.origin === 'script')}
          assets={assets}
          scope="episode"
          onApplied={load}
        />

        <div className="shortcuts">
          <span><Keys>space</Keys> play the episode</span>
          <span><Keys>↑</Keys><Keys>↓</Keys> move</span>
          <span><Keys>enter</Keys> open</span>
          <span><Keys>a</Keys> approve</span>
          <span><Keys>g</Keys> new take</span>
          <span><Keys>n</Keys> next gap</span>
          <span><Keys>⌘Z</Keys> undo</span>
          <span><Keys>+</Keys><Keys>−</Keys><Keys>0</Keys> zoom the timeline</span>
        </div>

        <ManualNote topic="fine-edit" />
        <ManualNote topic="mastering" />

        <details style={{ marginTop: 30 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--text-soft)' }}>Edit the script</summary>
          <div className="field" style={{ marginTop: 12 }}>
            <textarea value={script} onChange={e => setScript(e.target.value)} style={{ minHeight: 300 }} />
          </div>
          <p className="notice">
            Re-reading keeps every approved take whose line has not changed, and leaves your themes
            and freeze blocks exactly where they are.
          </p>
          <button className="btn" onClick={importScript} disabled={importing}>
            {importing ? 'Reading' : 'Re-read script'}
          </button>
        </details>
      </div>

      <Inspector
        element={selectedEl}
        character={chars.find(c => c.id === selectedEl?.character_id)}
        characters={chars}
        assets={assets}
        takes={selectedEl ? takes[selectedEl.id] ?? [] : []}
        busy={busyId === selectedEl?.id}
        blocks={usableBlocks}
        comments={selectedEl ? comments.filter(c => c.element_id === selectedEl.id) : []}
        userId={userId}
        userEmail={userEmail}
        episodeId={episode.id}
        onCommentsChanged={load}
        blockReturnMs={blockReturnMs}
        pulseCount={pulseCount}
        episode={episode}
        elements={positioned}
        total={total}
        onPatch={fields => {
          if (!selectedEl) return
          supabase.from('elements').update(fields).eq('id', selectedEl.id).then(load)
        }}
        onGenerate={count => selectedEl && generateOne(selectedEl, count ?? 1)}
        onUpload={() => { if (selectedEl) { uploadTarget.current = selectedEl.id; uploadInput.current?.click() } }}
        onApprove={t => selectedEl && approve(selectedEl, t)}
        onPlayTake={async t => {
          if (preview.playing === t.storage_path) { preview.stop(); return }
          const url = await signedUrl(t.storage_path)
          if (url) preview.toggle(t.storage_path, url)
        }}
        onPlayElement={() => selectedEl && play(selectedEl)}
        onAddBlock={id => selectedEl && addBlockAround(selectedEl, id)}
        onStopAudio={() => preview.stop()}
        onRemoveBlock={async id => { await removeBlock(id); await load() }}
        onAddVault={id => selectedEl && addVaultAsset(selectedEl, id, 'scene')}
        onExport={() => setExporting(true)}
        onDeleteEpisode={() => setDeleting(true)}
        missingThemes={missingThemes}
        readiness={(() => {
          /*
           * What still stands between this episode and hearing it end to end. Not a to do
           * list of everything: only the things that make the difference between silence
           * and a first listen.
           */
          const voiced = new Set(chars.filter(c => c.voice_id).map(c => c.id))
          const speaking = new Set(
            elements.filter(e => e.kind === 'dialogue').map(e => e.character_id).filter(Boolean) as string[],
          )
          const withoutVoice = [...speaking].filter(id => !voiced.has(id))

          const lines = elements.filter(e => e.kind === 'dialogue')
          const silentLines = lines.filter(e => e.status === 'missing' || e.status === 'stale')

          const usedAssets = new Set(elements.map(e => e.series_asset_id).filter(Boolean) as string[])
          const emptyAssets = assets.filter(a => usedAssets.has(a.id) && !a.storage_path)

          const guessed = elements.filter(e =>
            e.kind === 'dialogue' && e.status !== 'missing' && !e.lead_silence_ms && !e.tail_silence_ms)

          return [
            {
              label: withoutVoice.length === 0
                ? 'Every speaking character has a voice'
                : `${withoutVoice.length} characters still need a voice`,
              done: withoutVoice.length === 0,
              hint: 'Open Characters and design or clone one. Nothing generates without it.',
            },
            {
              label: silentLines.length === 0
                ? 'Every line has audio'
                : `${silentLines.length} of ${lines.length} lines have no audio`,
              done: silentLines.length === 0,
              hint: 'Generate first pass makes them all in one run.',
            },
            {
              label: emptyAssets.length === 0
                ? 'Every sound this episode asks for exists'
                : `${emptyAssets.length} vault sounds are still empty`,
              done: emptyAssets.length === 0,
              hint: 'They play as silence until they have audio. The first pass now fills them too.',
            },
            {
              label: missingThemes.length === 0
                ? 'Themes are in place'
                : `${missingThemes.length} themes are not in this episode`,
              done: missingThemes.length === 0,
              hint: 'Place them from the button above. An episode only picks them up when it is created.',
            },
            {
              label: (() => {
                const themes = assets.filter(a => a.auto_place === 'open' || a.auto_place === 'close')
                const empty = themes.filter(a => !a.storage_path)
                if (themes.length === 0) return 'No themes in the vault yet'
                return empty.length === 0
                  ? 'Themes have their audio'
                  : `${empty.length} themes are still empty`
              })(),
              done: assets.some(a => a.auto_place === 'open' || a.auto_place === 'close')
                && assets.filter(a => (a.auto_place === 'open' || a.auto_place === 'close') && !a.storage_path).length === 0,
              hint: 'Upload them in the vault. Music comes from outside; it is not generated.',
            },
            {
              label: guessed.length === 0
                ? 'Timings come from the audio'
                : `${guessed.length} lines are still placed by word count`,
              done: guessed.length === 0,
              hint: 'Press play once and they measure themselves.',
            },
          ]
        })()}
        onEditText={async text => {
          if (!selectedEl) return
          const clean = text.trim()
          if (!clean || clean === selectedEl.text_content) return
          const before = {
            text_content: selectedEl.text_content,
            source_hash: selectedEl.source_hash,
            status: selectedEl.status,
            duration_ms: selectedEl.duration_ms,
          }
          const id = selectedEl.id
          history.record({
            label: 'edit the line',
            undo: async () => { await supabase.from('elements').update(before).eq('id', id) },
            redo: async () => {
              await supabase.from('elements').update({
                text_content: clean, source_hash: hash(clean), status: 'stale',
              }).eq('id', id)
            },
          })
          await supabase.from('elements').update({
            text_content: clean,
            source_hash: hash(clean),
            // The approved audio says the old words, so it is no longer approved.
            status: selectedEl.status === 'approved' ? 'stale' : selectedEl.status,
            duration_ms: selectedEl.kind === 'dialogue'
              ? estimateSpeechMs(clean)
              : selectedEl.duration_ms,
          }).eq('id', selectedEl.id)
          await load()
          toast(selectedEl.status === 'approved'
            ? 'Line changed. It needs a new take.'
            : 'Line changed.')
        }}
        onDeleteElement={async () => {
          if (!selectedEl) return
          // Keep the whole row so undo can put it back exactly as it was.
          const { data: full } = await supabase.from('elements')
            .select('*').eq('id', selectedEl.id).single()
          await supabase.from('elements').delete().eq('id', selectedEl.id)
          setSelected(null)
          await load()
          if (full) {
            history.record({
              label: 'delete the line',
              undo: async () => { await supabase.from('elements').insert(full) },
              redo: async () => { await supabase.from('elements').delete().eq('id', full.id) },
            })
          }
          toast('Line deleted. Everything after it moved up.')
        }}
        onInsertAfter={async kind => {
          if (!selectedEl) return

          /*
           * A script is a starting point, not a cage. Anything an episode needs can be
           * added here: another line, a sound the script never mentioned, a bed under a
           * moment, a silence, or a scene break that regroups everything after it.
           */
          const base = {
            episode_id: episode.id,
            idx: selectedEl.idx + 25,
            scene: selectedEl.scene,
            origin: 'script' as const,
            status: 'missing' as const,
          }

          const shapes: Record<string, Record<string, unknown>> = {
            dialogue: {
              kind: 'dialogue', character_id: selectedEl.character_id,
              text_content: 'Una línea nueva.', anchor: 'line', gain_role: 'voice',
              duration_ms: 2000,
            },
            sfx: {
              kind: 'sfx', text_content: 'Un sonido nuevo.', anchor: 'line',
              gain_role: 'spot', duration_ms: 3000,
            },
            ambience: {
              kind: 'ambience', text_content: 'AMBIENTE · Un lugar nuevo.', anchor: 'scene',
              gain_role: 'ambience', duration_ms: 12000,
            },
            music: {
              kind: 'music', text_content: 'MÚSICA · Una cama nueva.', anchor: 'scene',
              gain_role: 'bed', duration_ms: 60000,
            },
            pause: {
              kind: 'pause', text_content: 'Silencio. 2 segundos.', anchor: 'line',
              gain_role: 'auto', duration_ms: 2000, status: 'approved' as const,
            },
          }

          if (kind === 'scene') {
            // A scene break renames everything from here on, so the rhythm engine opens a
            // real gap and the script reads as two places instead of one long one.
            const name = `Escena ${new Set(elements.map(e => e.scene)).size + 1}`
            const after = positionedRef.current
              .filter(e => e.idx >= selectedEl.idx && e.scene === selectedEl.scene)
            for (const e of after) {
              await supabase.from('elements').update({ scene: name }).eq('id', e.id)
            }
            await load()
            toast(`Scene break added. ${after.length} elements moved into ${name}.`)
            return
          }

          const { data } = await supabase.from('elements')
            .insert({ ...base, ...shapes[kind] }).select().single()
          await load()
          if (data) {
            const made = data as AudioElement
            setSelected(made.id)
            history.record({
              label: 'add',
              undo: async () => { await supabase.from('elements').delete().eq('id', made.id) },
              redo: async () => { await supabase.from('elements').insert(data) },
            })
            toast(kind === 'pause' ? 'Silence added.' : 'Added. Write it and generate.')
          }
        }}
        onPacing={async next => {
          const merged = { ...pacingFor(episode), ...next }
          await supabase.from('episodes').update({ pacing: merged }).eq('id', episode.id)
          episode.pacing = merged
          setElements(e => [...e])
        }}
        onPlaceThemes={async () => {
          const placed = await applyTemplate(episode.id, project.id)
          await load()
          toast(placed > 0 ? `${placed} placed. They are at the start and the end.` : 'Nothing to place.')
        }}
      />
      </div>

      <input
        ref={uploadInput} type="file" accept="audio/*" hidden
        onChange={e => {
          const f = e.target.files?.[0]
          if (f && uploadTarget.current) uploadOwn(uploadTarget.current, f)
          e.target.value = ''
        }}
      />

      {trimming && (
        <TrimEditor
          path={trimming.path}
          title={trimming.title}
          userId={userId}
          projectId={project.id}
          onSaved={async (newPath, ms) => {
            const el = positionedRef.current.find(e => e.id === selected)
            if (!el) return
            const { data } = await supabase.from('takes').insert({
              element_id: el.id, storage_path: newPath, duration_ms: ms, provider: 'trim',
            }).select().single()
            if (data) await approve(el, data as Take)
          }}
          onClose={() => setTrimming(null)}
        />
      )}

      {deleting && (
        <ConfirmTyped
          title={`Delete ${episode.title}`}
          phrase={episode.title}
          confirmLabel="Delete the episode"
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            const { error } = await supabase.from('episodes').delete().eq('id', episode.id)
            if (error) { toast(error.message, 'bad'); return }
            toast(`${episode.title} is gone.`)
            onDeleted()
          }}
          body={
            <>
              <p>
                {elements.length} elements go with it, including {approved} approved{' '}
                {approved === 1 ? 'take' : 'takes'}. The script text goes too.
              </p>
              <p className="notice">
                The vault is untouched. Anything this episode borrowed from it stays available to
                the others.
              </p>
            </>
          }
        />
      )}

      {trimming && (
        <TrimEditor
          path={trimming.path}
          title={trimming.title}
          userId={userId}
          projectId={project.id}
          onSaved={async (newPath, ms) => {
            const el = positionedRef.current.find(e => e.id === selected)
            if (!el) return
            const { data } = await supabase.from('takes').insert({
              element_id: el.id, storage_path: newPath, duration_ms: ms, provider: 'trim',
            }).select().single()
            if (data) await approve(el, data as Take)
          }}
          onClose={() => setTrimming(null)}
        />
      )}

      {deleting && (
        <ConfirmTyped
          title={`Delete ${episode.title}`}
          phrase={episode.title}
          confirmLabel="Delete the episode"
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            try {
              const files = await deleteEpisode(episode.id)
              const after = await loadUsage(project.id)
              const stranded = assets.filter(a =>
                a.auto_place !== 'open' && a.auto_place !== 'close' && !after.assets.has(a.id)).length
              toast(stranded > 0
                ? `${episode.title} deleted with ${files} audio files. ${stranded} vault sounds are now unused; the vault will offer to clear them.`
                : `${episode.title} deleted, along with ${files} audio files.`)
              onDeleted()
            } catch (e) {
              toast(e instanceof Error ? e.message : 'Could not delete the episode', 'bad')
            }
          }}
          body={
            <>
              <p>
                The script, all {elements.length} elements and every take goes. {approved} of them
                were approved.
              </p>
              <p className="notice">
                Vault audio stays: themes and blocks belong to the series, not to this episode.
                Nothing here can be recovered.
              </p>
            </>
          }
        />
      )}

      {exporting && (
        <ExportPanel
          project={project}
          episode={episode}
          elements={positioned}
          total={total}
          buildClips={buildClips}
          onClose={() => setExporting(false)}
        />
      )}

      {askGenerate !== null && (
        <Confirm
          title="Generate a first pass"
          confirmLabel={`Generate ${askGenerate}`}
          onClose={() => setAskGenerate(null)}
          onConfirm={runFirstPass}
          body={
            <>
              <p>
                {askGenerate} elements have no audio yet. Estimated cost is about{' '}
                ${(askGenerate * COST_PER_ELEMENT).toFixed(2)}.
              </p>
              <p>
                This makes a first pass, not a finished episode. Everything comes back as an
                unapproved take for you to keep or replace.
              </p>
              <p className="notice">
                It runs in the background. You can close this tab and come back.
              </p>
            </>
          }
        />
      )}

      <BottomPanel
        elements={positioned}
        total={total}
        duckDb={project.music_duck_db}
        selectedId={selected}
        buildClips={buildClips}
        episode={episode}
        onLaneGain={async (lane, db) => {
          const next = { ...(episode.lane_gain ?? {}), [lane]: db }
          await supabase.from('episodes').update({ lane_gain: next }).eq('id', episode.id)
          episode.lane_gain = next
          setElements(e => [...e])
        }}
        onNudge={async (id, offsetMs) => {
          const before = elements.find(e => e.id === id)?.offset_ms ?? 0
          const set = async (v: number) => {
            await supabase.from('elements').update({ offset_ms: v }).eq('id', id)
            setElements(list => list.map(e => (e.id === id ? { ...e, offset_ms: v } : e)))
          }
          await set(offsetMs)
          history.record({
            label: 'move',
            undo: () => set(before),
            redo: () => set(offsetMs),
          })
        }}
        onMeasured={async measured => {
          /*
           * Write back only what is still a guess. Anything already measured, trimmed by
           * hand or approved keeps the value it has, or listening would quietly undo the
           * edits somebody made.
           */
          const pending = measured.filter(m => {
            const el = elements.find(e => e.id === m.id)
            if (!el || el.kind === 'pause' || el.series_asset_id) return false
            if (el.lead_silence_ms || el.tail_silence_ms) return false
            return Math.abs(el.duration_ms - m.durationMs) > 120
          })
          if (pending.length === 0) return

          for (const m of pending) {
            await supabase.from('elements').update({
              duration_ms: m.durationMs,
              lead_silence_ms: m.leadMs,
              tail_silence_ms: m.tailMs,
            }).eq('id', m.id)
          }
          await load()
          toast(`${pending.length} lines now sit where the audio actually falls.`)
        }}
        onFade={async (id, inMs, outMs) => {
          const el = elements.find(e => e.id === id)
          const before = { fade_in_ms: el?.fade_in_ms ?? null, fade_out_ms: el?.fade_out_ms ?? null }
          const set = async (v: { fade_in_ms: number | null; fade_out_ms: number | null }) => {
            await supabase.from('elements').update(v).eq('id', id)
            setElements(list => list.map(e => (e.id === id ? { ...e, ...v } : e)))
          }
          const next = { fade_in_ms: inMs, fade_out_ms: outMs }
          await set(next)
          history.record({ label: 'fade', undo: () => set(before), redo: () => set(next) })
        }}
        onSplit={async (id, atMs) => {
          /*
           * Splitting does not cut the file. The first half keeps the audio and gains a
           * tail trim; the second half is a new element pointing at the same audio with a
           * matching lead trim. Nothing is destroyed, and a silence or another sound can
           * go in the join.
           */
          const el = positionedRef.current.find(e => e.id === id)
          if (!el) return
          const into = Math.round(atMs - el.start_ms)
          if (into < 200 || into > el.duration_ms - 200) {
            toast('Put the playhead further inside the clip.', 'bad')
            return
          }

          const lead = el.lead_silence_ms ?? 0
          const { data } = await supabase.from('elements').insert({
            episode_id: episode.id,
            idx: el.idx + 25,
            scene: el.scene,
            kind: el.kind,
            character_id: el.character_id,
            series_asset_id: el.series_asset_id,
            approved_take_id: el.approved_take_id,
            text_content: `${el.text_content} (2)`,
            direction: el.direction,
            origin: el.origin,
            anchor: el.anchor,
            gain_role: el.gain_role,
            gain_db: el.gain_db,
            duration_ms: el.duration_ms,
            lead_silence_ms: lead + into,
            tail_silence_ms: el.tail_silence_ms ?? 0,
            status: el.status,
          }).select().single()

          const firstTail = Math.max(el.duration_ms - lead - into, 0)
          await supabase.from('elements')
            .update({ tail_silence_ms: firstTail }).eq('id', el.id)
          await load()

          if (data) {
            const made = data as AudioElement
            history.record({
              label: 'split',
              undo: async () => {
                await supabase.from('elements').delete().eq('id', made.id)
                await supabase.from('elements')
                  .update({ tail_silence_ms: el.tail_silence_ms ?? 0 }).eq('id', el.id)
              },
              redo: async () => {
                await supabase.from('elements').insert(data)
                await supabase.from('elements')
                  .update({ tail_silence_ms: firstTail }).eq('id', el.id)
              },
            })
            toast('Split. Both halves point at the same audio, so nothing was cut.')
          }
        }}
        onTrimEdges={async (id, leadMs, tailMs) => {
          const el = elements.find(e => e.id === id)
          const before = { lead: el?.lead_silence_ms ?? 0, tail: el?.tail_silence_ms ?? 0 }
          const set = async (lead: number, tail: number) => {
            await supabase.from('elements')
              .update({ lead_silence_ms: lead, tail_silence_ms: tail }).eq('id', id)
            setElements(list => list.map(e =>
              e.id === id ? { ...e, lead_silence_ms: lead, tail_silence_ms: tail } : e))
          }
          await set(leadMs, tailMs)
          history.record({
            label: 'trim',
            undo: () => set(before.lead, before.tail),
            redo: () => set(leadMs, tailMs),
          })
        }}
        onGain={async (id, db) => {
          const before = elements.find(e => e.id === id)?.gain_db ?? 0
          const set = async (v: number) => {
            await supabase.from('elements').update({ gain_db: v }).eq('id', id)
            setElements(list => list.map(e => (e.id === id ? { ...e, gain_db: v } : e)))
          }
          await set(db)
          history.record({ label: 'level', undo: () => set(before), redo: () => set(db) })
        }}
        onTrimSelected={async () => {
          const el = positionedRef.current.find(e => e.id === selected)
          if (!el) return
          let path: string | null = null
          if (el.series_asset_id) {
            path = assets.find(a => a.id === el.series_asset_id)?.storage_path ?? null
          } else if (el.approved_take_id) {
            const { data } = await supabase.from('takes').select('storage_path')
              .eq('id', el.approved_take_id).single()
            path = data?.storage_path ?? null
          }
          if (!path) { toast('That line has no approved audio to trim yet.', 'bad'); return }
          setTrimming({ path, title: el.text_content.slice(0, 30) })
        }}
        extraSelected={alsoSelected}
        onSelect={(id, additive) => {
          setAlsoSelected(prev => {
            if (!additive) return new Set([id])
            const next = new Set(prev)
            next.has(id) ? next.delete(id) : next.add(id)
            next.add(selected ?? id)
            return next
          })
          setSelected(id)
          loadTakes(id)
          const i = visibleRef.current.findIndex(v => v.id === id)
          if (i >= 0) setCursor(i)
          reveal(id)
        }}
      />
    </>
  )
}
