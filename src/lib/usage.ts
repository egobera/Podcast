/**
 * What is still in use, counted from the episodes that exist right now.
 *
 * The vault used to carry a stored counter that only ever went up, so deleting an episode
 * left every sound it had introduced looking as busy as ever. After a few deletions nobody
 * could tell which entries the series still needed.
 *
 * Counting live is slower by one query and always true.
 */

export interface Usage {
  /** series_asset_id or character_id -> how many episodes still reference it. */
  assets: Map<string, number>
  characters: Map<string, number>
  episodes: number
}

/**
 * Entries no episode references any more.
 *
 * Themes are left out on purpose: they are placed by the template rather than asked for by
 * a script, so a series between episodes would otherwise be told to delete its own theme.
 */
export function orphanAssets<T extends { id: string; auto_place?: string | null }>(
  assets: T[],
  usage: Usage,
): T[] {
  if (usage.episodes === 0) return []
  return assets.filter(a =>
    a.auto_place !== 'open' && a.auto_place !== 'close' && !usage.assets.has(a.id))
}
