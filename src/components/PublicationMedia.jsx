import { useEffect, useState } from 'react'
import { getMedia } from '../lib/mediaStorage'

function mediaShape(network, format) {
  if (/story/i.test(format) || /tiktok/i.test(network)) return 'vertical'
  if (/youtube/i.test(network)) return 'horizontal'
  if (/instagram/i.test(network)) return 'square'
  return 'original'
}

function MediaItem({ attachment, shape, onRemove, disabled }) {
  const [source, setSource] = useState(null)
  const current = source?.id === attachment.id && source?.file === attachment.file ? source : null
  const url = current?.url
  const failed = current?.failed
  useEffect(() => {
    let cancelled = false
    let objectUrl
    async function load() {
      try {
        const blob = attachment.file || await getMedia(attachment.id)
        if (!blob) throw new Error('Mídia indisponível')
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setSource({ id: attachment.id, file: attachment.file, url: objectUrl, failed: false })
      } catch {
        if (!cancelled) setSource({ id: attachment.id, file: attachment.file, failed: true })
      }
    }
    load()
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [attachment.id, attachment.file])
  return <figure className="publication-media-item">
    <div className={'publication-media-frame media-' + shape}>
      {failed ? <p role="status">Mídia indisponível ou formato não reproduzível. Remova o anexo e selecione novamente no formulário.</p>
        : !url ? <p role="status">Carregando mídia…</p>
          : attachment.type?.startsWith('video/')
            ? <video src={url} controls playsInline preload="metadata" aria-label={attachment.name} onError={() => setSource(current => ({ ...current, failed: true }))} />
            : <img src={url} alt={attachment.name} onError={() => setSource(current => ({ ...current, failed: true }))} />}
    </div>
    <figcaption><span>{attachment.name}</span>{onRemove && <button type="button" disabled={disabled} onClick={() => onRemove(attachment.id)} aria-label={'Remover ' + attachment.name + ' desta publicação'}>Remover</button>}</figcaption>
  </figure>
}

export default function PublicationMedia({ attachments = [], network = '', format = '', onRemove, disabled = false }) {
  if (!attachments.length) return null
  return <section className="publication-media" aria-label="Mídia da publicação">
    {attachments.map(attachment => <MediaItem key={attachment.id} attachment={attachment} shape={mediaShape(network, format)} onRemove={onRemove} disabled={disabled} />)}
  </section>
}
