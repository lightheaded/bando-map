import { useRef, useState } from 'react'
import { useAppStore } from '../state/store'
import { useContribStore, refreshSubmissions } from '../state/contrib'
import { postPhoto } from '../sync/api'
import { signIn } from '../sync/auth'
import { preparePhoto, type PreparedPhoto } from '../photos/prepare'
import { fmtBytes } from '../offline/storage'
import { useOnline } from './useOnline'
import { CameraIcon } from './icons'
import type { Bando } from '../types'

/**
 * Add a photo of one place. Everything expensive happens before the upload: the
 * browser decodes the file, downscales it to a 1600px view copy and a 480px
 * thumbnail, and re-encodes both — which is also what removes the original's
 * EXIF, the GPS tag where it was taken included. What leaves the device is
 * ~200 KB of pixels and nothing else.
 *
 * The photo then waits in the review queue like any other contribution, and the
 * contributor is told so. Nothing they upload is visible to anyone but a
 * reviewer until it is approved.
 */
export function PhotoUpload({ item }: { item: Bando }) {
  const email = useAppStore((s) => s.sync.email)
  const showToast = useAppStore((s) => s.showToast)
  const submissions = useContribStore((s) => s.submissions)
  const online = useOnline()
  const fileInput = useRef<HTMLInputElement>(null)
  const [prepared, setPrepared] = useState<PreparedPhoto>()
  const [own, setOwn] = useState(false)
  const [credit, setCredit] = useState('')
  const [busy, setBusy] = useState(false)

  const waiting = submissions.filter(
    (s) => s.data.type === 'photo' && s.data.targetId === item.id && s.status === 'pending',
  ).length

  const pick = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    try {
      setPrepared(await preparePhoto(file))
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'could not read that image')
    } finally {
      setBusy(false)
      // Let the same file be chosen again after a failure or a cancel.
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const reset = () => {
    setPrepared(undefined)
    setOwn(false)
    setCredit('')
  }

  const send = async () => {
    if (!prepared || !own) return
    setBusy(true)
    try {
      await postPhoto({
        targetId: item.id,
        name: item.name,
        own: true,
        credit: credit.trim() || undefined,
        full: prepared.full,
        thumb: prepared.thumb,
      })
      reset()
      showToast('Photo submitted for review')
      await refreshSubmissions()
    } catch {
      showToast('Upload failed — try again')
    } finally {
      setBusy(false)
    }
  }

  if (!email) {
    return (
      <div className="photo-add">
        <span className="offline-sub">Sign in to add a photo of this place.</span>
        <button className="btn btn-small btn-primary" onClick={signIn} disabled={!online}>
          Sign in
        </button>
      </div>
    )
  }

  return (
    <div className="photo-add">
      {!prepared ? (
        <>
          <button className="btn btn-small" disabled={busy || !online} onClick={() => fileInput.current?.click()}>
            <CameraIcon />
            {busy ? 'Preparing…' : 'Add a photo'}
          </button>
          {waiting > 0 && (
            <span className="offline-sub">
              {waiting} of yours {waiting === 1 ? 'is' : 'are'} waiting for review
            </span>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => pick(e.target.files?.[0])}
          />
        </>
      ) : (
        <div className="photo-draft">
          <img
            src={`data:${prepared.ext === 'webp' ? 'image/webp' : 'image/jpeg'};base64,${prepared.thumb}`}
            alt="The photo you are about to submit"
          />
          <div className="photo-draft-form">
            <span className="offline-sub">
              {prepared.w}×{prepared.h} · {fmtBytes(prepared.bytes)} · location data removed
            </span>
            <label className="checkbox">
              <input type="checkbox" checked={own} onChange={(e) => setOwn(e.target.checked)} />
              <span>I took this photo and agree it can be published here</span>
            </label>
            <input
              className="contrib-note"
              placeholder="Credit line (optional)"
              value={credit}
              maxLength={120}
              onChange={(e) => setCredit(e.target.value)}
            />
            <div className="offline-actions">
              <button className="btn btn-small btn-muted" onClick={reset} disabled={busy}>
                Cancel
              </button>
              <button className="btn btn-small btn-primary" onClick={send} disabled={busy || !own || !online}>
                {busy ? 'Uploading…' : 'Submit for review'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
