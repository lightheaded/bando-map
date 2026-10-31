/**
 * The dropped pin: a marker on any point of the map, put there by a long press
 * (touch), a right-click (mouse) or a `#p/<lat>,<lon>` link. It is not a place
 * — it lives only in this tab and its URL — but its popup can share it, open it
 * in other maps, or promote it to a place of your own.
 */
import maplibregl from 'maplibre-gl'
import { wgs84ToLest97 } from '../geo/lest97'
import { GMAPS_URL, OSM_URL, XGIS_URL } from '../types'
import { useAppStore, type DroppedPin } from '../state/store'
import { useMarksStore } from '../state/marks'
import { revealPlace } from '../state/filters'
import { pinHash } from '../state/deeplink'

const PIN_COLOR = '#7c3aed'
const DEFAULT_NAME = 'Dropped pin'
/** L-EST97 and XGIS cover Estonia only; elsewhere (the Canaries) they mean nothing. */
const inEstonia = (lat: number, lon: number) => lat > 57.3 && lat < 59.9 && lon > 21.3 && lon < 28.4

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function pinPopupHtml(pin: DroppedPin): string {
  const lat = pin.lat.toFixed(6)
  const lon = pin.lon.toFixed(6)
  const lest = inEstonia(pin.lat, pin.lon) ? wgs84ToLest97(pin.lat, pin.lon) : undefined
  const links = [
    `<a href="${GMAPS_URL(Number(lat), Number(lon))}" target="_blank" rel="noopener">Google Maps</a>`,
    `<a href="${OSM_URL(Number(lat), Number(lon))}" target="_blank" rel="noopener">OpenStreetMap</a>`,
    lest ? `<a href="${XGIS_URL(lest.x, lest.y)}" target="_blank" rel="noopener">XGIS</a>` : '',
  ].filter(Boolean)
  return (
    `<div class="hint-popup pin-popup"><strong>${esc(pin.label || DEFAULT_NAME)}</strong>` +
    `<div class="pin-coords"><code>${lat}, ${lon}</code>` +
    (lest ? `<br><span>L-EST97 ${lest.y} N, ${lest.x} E</span>` : '') +
    `</div>` +
    `<div class="hint-links">${links.join(' · ')}</div>` +
    `<div class="pin-actions">` +
    `<button type="button" class="btn btn-small pin-share">Share</button>` +
    `<button type="button" class="btn btn-small pin-copy">Copy coordinates</button>` +
    `<button type="button" class="btn btn-small pin-save">＋ Save as place</button>` +
    `<button type="button" class="btn btn-small btn-muted pin-remove">Remove pin</button>` +
    `</div></div>`
  )
}

async function copy(text: string, done: string) {
  const { showToast } = useAppStore.getState()
  try {
    await navigator.clipboard.writeText(text)
    showToast(done)
  } catch {
    showToast('Could not access the clipboard')
  }
}

function wire(popup: maplibregl.Popup, pin: DroppedPin) {
  const root = popup.getElement()
  if (!root) return
  const on = (cls: string, fn: () => void) => root.querySelector(`.${cls}`)?.addEventListener('click', fn)
  on('pin-share', async () => {
    const url = location.origin + location.pathname + pinHash(pin)
    if (navigator.share) {
      try {
        await navigator.share({ title: pin.label || DEFAULT_NAME, url })
      } catch {
        /* user cancelled the share sheet */
      }
    } else {
      await copy(url, 'Link copied')
    }
  })
  on('pin-copy', () => copy(`${pin.lat.toFixed(6)}, ${pin.lon.toFixed(6)}`, 'Coordinates copied'))
  on('pin-save', () => {
    const name = pin.label || DEFAULT_NAME
    const id = useMarksStore.getState().addPlace({ name, lat: pin.lat, lon: pin.lon })
    const app = useAppStore.getState()
    app.setDroppedPin(undefined)
    app.select(id)
    const widened = revealPlace(id)
    app.showToast(`Saved "${name}" as your place${widened ? ' — filters widened to show it' : ''}`, {
      label: 'Undo',
      onClick: () => useMarksStore.getState().removePlace(id),
    })
  })
  on('pin-remove', () => useAppStore.getState().setDroppedPin(undefined))
}

/**
 * Draw `pin` on the map, replacing `current`. The popup opens with it; closing
 * the popup (a tap elsewhere) leaves the pin, and a tap on the pin reopens it.
 */
export function showDroppedPin(map: maplibregl.Map, current: maplibregl.Marker | undefined, pin?: DroppedPin) {
  current?.remove()
  if (!pin) return undefined
  const popup = new maplibregl.Popup({ maxWidth: '320px', offset: 30, focusAfterOpen: false }).setHTML(pinPopupHtml(pin))
  // The content node survives a close and reopen, so its buttons are wired once.
  popup.once('open', () => wire(popup, pin))
  const marker = new maplibregl.Marker({ color: PIN_COLOR }).setLngLat([pin.lon, pin.lat]).setPopup(popup).addTo(map)
  marker.getElement().classList.add('dropped-pin')
  marker.getElement().title = pin.label || DEFAULT_NAME
  marker.togglePopup()
  return marker
}
