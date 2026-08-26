import { COMMUNITY_PHOTO_URL, PHOTO_URL, type Bando } from '../types'

/**
 * The one picture that stands for a place, wherever a place is drawn small —
 * the map marker and the in-view list.
 *
 * Three sources, in the order they are preferred: the archived register
 * thumbnail (local, and the only one an offline client has), the register's
 * own photo server, then an approved contributed photo. The last is what a
 * user-added place has, and the only thing it ever has: a community spot is in
 * no register, so without it every one of them draws a placeholder however
 * many pictures of it are live.
 *
 * Returns an empty string when the place has no picture at all — the caller
 * then draws the placeholder glyph.
 */
export function thumbUrl(b: Bando): string {
  const archived = b.thumbs?.find(Boolean)
  if (archived) return `${import.meta.env.BASE_URL}${archived}`
  if (b.photos.length) return PHOTO_URL(b.photos[0])
  const contributed = b.communityPhotos?.[0]
  return contributed ? COMMUNITY_PHOTO_URL(contributed, 'thumb') : ''
}

/** The glyph a place without a picture falls back to. */
export const thumbGlyph = (b: Bando): string => (b.custom || b.community ? '★' : '▢')
