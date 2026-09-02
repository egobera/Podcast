import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!url || !anon) {
  console.warn('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.')
}

export const supabase = createClient(url ?? '', anon ?? '')

/** Storage paths are namespaced by user id so the storage policies can check ownership. */
export function audioPath(userId: string, projectId: string, filename: string) {
  return `${userId}/${projectId}/${filename}`
}

const signedCache = new Map<string, { url: string; expires: number }>()

export async function signedUrl(path: string): Promise<string | null> {
  const cached = signedCache.get(path)
  if (cached && cached.expires > Date.now()) return cached.url
  const { data, error } = await supabase.storage.from('audio').createSignedUrl(path, 3600)
  if (error || !data) return null
  signedCache.set(path, { url: data.signedUrl, expires: Date.now() + 3000_000 })
  return data.signedUrl
}

export async function uploadAudio(userId: string, projectId: string, name: string, file: File | Blob) {
  const path = audioPath(userId, projectId, `${Date.now()}-${name}`)
  const { error } = await supabase.storage.from('audio').upload(path, file, { upsert: false })
  if (error) throw error
  return path
}

/** Reads real duration from the file instead of trusting the estimate. */
export function readDuration(file: File | Blob): Promise<number> {
  return new Promise(resolve => {
    const el = document.createElement('audio')
    el.preload = 'metadata'
    el.onloadedmetadata = () => {
      URL.revokeObjectURL(el.src)
      resolve(Math.round(el.duration * 1000))
    }
    el.onerror = () => resolve(0)
    el.src = URL.createObjectURL(file)
  })
}

export async function callFunction<T>(name: string, body: unknown): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`/.netlify/functions/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token ?? ''}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<T>
}
