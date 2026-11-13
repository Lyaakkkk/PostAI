
import { useEffect, useRef, useState } from 'react'
import PublicationMedia from './components/PublicationMedia'
import { STORAGE_KEY, readHistory, commitHistory, persistMedia, attachmentMetadata, storageError, registerMediaSession } from './lib/mediaStorage'
import './App.css'

const menuItems = [
  { id: 'inicio', icon: '⌂', label: 'Início' },
  { id: 'criar', icon: '✦', label: 'Criar conteúdo' },
  { id: 'publicacoes', icon: '▤', label: 'Publicações' },
  { id: 'favoritos', icon: '♡', label: 'Favoritos' },
  { id: 'desempenho', icon: '▥', label: 'Desempenho' },
]

const networks = [
  'Instagram',
  'LinkedIn',
  'TikTok',
  'Facebook',
  'YouTube',
  'X',
]


function loadPublications() {
  try {
    return readHistory().items
  } catch {
    return []
  }
}

const panelStyle = { background: '#fff', border: '1px solid #e9e5f3', borderRadius: 18, padding: 20, marginBottom: 16 }
const smallButtonStyle = { padding: '9px 13px', borderRadius: 10, border: '1px solid #d8cdef', background: '#f8f5ff', color: '#5b36a0', cursor: 'pointer', fontWeight: 600 }

function App() {
  const [activePage, setActivePage] = useState('inicio')
  const [idea, setIdea] = useState('')
  const [mode, setMode] = useState('multiple')
  const [selectedNetworks, setSelectedNetworks] = useState([
    'Instagram',
    'LinkedIn',
  ])
  const [contentType, setContentType] = useState('Post')
  const [tone, setTone] = useState('Profissional e próximo')

  const [materials, setMaterials] = useState([])
  const [materialUse, setMaterialUse] = useState('reference')

  const [isSending, setIsSending] = useState(false)
  const [submissionError, setSubmissionError] = useState('')
  const [submissionMessage, setSubmissionMessage] = useState('')
  const [receivedData, setReceivedData] = useState(null)
  const [savedPublications, setSavedPublications] = useState(loadPublications)
  const [draftPublications, setDraftPublications] = useState([])
  const [copyMessage, setCopyMessage] = useState('')

  const [isSaving, setIsSaving] = useState(false)
  const savingRef = useRef(false)
  const historySnapshot = useRef(undefined)

  useEffect(() => {
    const releaseSession = registerMediaSession()
    function refreshHistory() {
      try {
        const history = readHistory()
        historySnapshot.current = history.raw
        setSavedPublications(history.items)
      } catch (error) {
        historySnapshot.current = undefined
        setCopyMessage(storageError(error))
      }
    }
    refreshHistory()
    function handleStorage(event) {
      if (event.key === STORAGE_KEY || event.key === null) {
        refreshHistory()
        historySnapshot.current = undefined
        setCopyMessage('O histórico mudou em outra aba. Seu rascunho foi mantido; revise antes de salvar.')
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => { window.removeEventListener('storage', handleStorage); releaseSession() }
  }, [])

  async function persistPublications(transform, prepare, message = 'Publicação salva no histórico deste navegador.') {
    if (savingRef.current) return false
    savingRef.current = true
    setIsSaving(true)
    setCopyMessage('Salvando…')
    try {
      const history = await commitHistory(historySnapshot.current, transform, prepare)
      historySnapshot.current = history.raw
      setSavedPublications(history.items)
      setCopyMessage(message + (history.warning ? ' Aviso: ' + history.warning : ''))
      return true
    } catch (error) {
      setCopyMessage(storageError(error))
      try {
        const history = readHistory()
        historySnapshot.current = history.raw
        setSavedPublications(history.items)
      } catch { /* Preserve invalid history rather than overwrite it. */ }
      return false
    } finally {
      savingRef.current = false
      setIsSaving(false)
    }
  }

  function updateDraft(id, field, value) {
    setDraftPublications(current => current.map(item => item.id === id ? { ...item, [field]: value } : item))
  }

  async function savePublication(item) {
    const attachments = (item.attachments || []).map(attachment => ({ ...attachment }))
    let nextItems
    return persistPublications(items => {
      const saved = items.find(publication => publication.id === item.id)
      const publication = { ...item, favorite: saved?.favorite ?? item.favorite, savedAt: new Date().toISOString() }
      nextItems = [publication, ...items.filter(saved => saved.id !== item.id)]
      return nextItems
    }, async () => {
      await persistMedia(attachments)
      nextItems[0].attachments = attachmentMetadata(attachments)
    })
  }

  async function toggleFavorite(id) {
    const saved = savedPublications.find(item => item.id === id)
    if (!saved) return
    const favorite = !saved.favorite
    if (!await persistPublications(items => items.map(item => item.id === id ? { ...item, favorite } : item))) return
    setDraftPublications(current => current.map(item => item.id === id ? { ...item, favorite } : item))
  }

  async function deletePublication(id) {
    if (!window.confirm('Excluir esta publicação do histórico? Arquivos compartilhados com outras publicações serão preservados.')) return
    if (!await persistPublications(items => items.filter(item => item.id !== id), undefined, 'Publicação excluída do histórico.')) return
    setDraftPublications(current => current.filter(item => item.id !== id))
  }

  async function copyPublication(item) {
    try {
      await navigator.clipboard.writeText([item.title, item.content, (item.hashtags || []).join(' ')].filter(Boolean).join('\n\n'))
      setCopyMessage('Texto copiado!')
    } catch { setCopyMessage('Não foi possível copiar automaticamente. Selecione o texto para copiar.') }
  }

  function renderPublication(item, editable = false) {
    const isFavorite = savedPublications.find(saved => saved.id === item.id)?.favorite ?? item.favorite
    return (
      <article key={item.id} style={panelStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <strong style={{ color: '#7654C8' }}>{item.network || 'Rede social'}</strong>
          <span style={{ fontSize: 12, color: '#6b6479' }}>{item.suggestedFormat || 'Publicação'}</span>
        </div>
        <PublicationMedia attachments={item.attachments} network={item.network} format={item.previewFormat || item.suggestedFormat}
          disabled={isSaving} onRemove={mediaId => {
            if (editable) updateDraft(item.id, 'attachments', (item.attachments || []).filter(attachment => attachment.id !== mediaId))
            else persistPublications(items => items.map(saved => saved.id === item.id ? { ...saved, attachments: (saved.attachments || []).filter(attachment => attachment.id !== mediaId) } : saved), undefined, 'Anexo removido da publicação.')
          }} />
        {editable ? (
          <>
            <label className="field-label">Título</label>
            <input aria-label="Título da publicação" value={item.title || ''} onChange={e => updateDraft(item.id, 'title', e.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: 12, marginBottom: 12, borderRadius: 10, border: '1px solid #ddd' }} />
            <label className="field-label">Conteúdo</label>
            <textarea aria-label="Texto da publicação" value={item.content || ''} onChange={e => updateDraft(item.id, 'content', e.target.value)} style={{ width: '100%', minHeight: 170, boxSizing: 'border-box', padding: 12, borderRadius: 10, border: '1px solid #ddd' }} />
            <label className="field-label">Hashtags (separadas por espaço)</label>
            <input aria-label="Hashtags" value={(item.hashtags || []).join(' ')} onChange={e => updateDraft(item.id, 'hashtags', e.target.value.split(/\s+/).filter(Boolean))} style={{ width: '100%', boxSizing: 'border-box', padding: 12, marginBottom: 12, borderRadius: 10, border: '1px solid #ddd' }} />
          </>
        ) : (
          <>
            <h3 style={{ margin: '0 0 10px' }}>{item.title}</h3>
            <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.65 }}>{item.content}</p>
            <p style={{ color: '#7654C8', overflowWrap: 'anywhere' }}>{(item.hashtags || []).join(' ')}</p>
          </>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          <button style={smallButtonStyle} onClick={() => copyPublication(item)}>Copiar</button>
          {editable && <button style={smallButtonStyle} disabled={isSaving} onClick={() => savePublication(item)}>{isSaving ? 'Salvando…' : 'Salvar'}</button>}
          <button style={smallButtonStyle} disabled={isSaving} onClick={async () => {
            if (!savedPublications.some(saved => saved.id === item.id)) {
              if (!await savePublication({ ...item, favorite: true })) return
              setDraftPublications(current => current.map(d => d.id === item.id ? { ...d, favorite: true } : d))
            } else toggleFavorite(item.id)
          }}>{isFavorite ? '♥ Favorito' : '♡ Favoritar'}</button>
          {savedPublications.some(saved => saved.id === item.id) && <button style={smallButtonStyle} disabled={isSaving} onClick={() => deletePublication(item.id)}>Excluir publicação</button>}
        </div>
      </article>
    )
  }


  function toggleNetwork(network) {
    setSelectedNetworks((current) =>
      current.includes(network)
        ? current.filter((item) => item !== network)
        : [...current, network]
    )
  }

  function handleFileChange(event) {
    const newFiles = Array.from(event.target.files)

    setMaterials((current) => {
      const uniqueFiles = newFiles.filter(
        (file) =>
          !current.some(
            (item) =>
              item.name === file.name &&
              item.lastModified === file.lastModified
          )
      )

      return [...current, ...uniqueFiles]
    })

    event.target.value = ''
  }

  function removeMaterial(index) {
    setMaterials((current) =>
      current.filter((_, fileIndex) => fileIndex !== index)
    )
  }

  function formatFileSize(bytes) {
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`
    }

    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }

  function getFileIcon(file) {
    if (file.type.startsWith('image/')) return '🖼️'
    if (file.type.startsWith('audio/')) return '🎧'
    if (file.type.startsWith('video/')) return '🎬'
    if (file.type.includes('pdf')) return '📕'
    if (file.type.includes('word')) return '📝'
    if (file.type.startsWith('text/')) return '📄'

    return '📎'
  }

  async function handleCreateContent() {
    if (!idea.trim()) {
      setSubmissionError('Escreva uma ideia antes de continuar.')
      return
    }

    if (selectedNetworks.length === 0) {
      setSubmissionError('Selecione pelo menos uma rede social.')
      return
    }

    const submissionMaterials = [...materials]
    if (submissionMaterials.length > 10 ||
        submissionMaterials.some(file => file.size > 5 * 1024 * 1024) ||
        submissionMaterials.reduce((total, file) => total + file.size, 0) > 20 * 1024 * 1024) {
      setSubmissionError('Envie até 10 arquivos, com até 5 MB cada e 20 MB no total.')
      return
    }

    const submissionUse = materialUse
    const submissionFormat = contentType
    const previewAttachments = submissionUse === 'reference' ? [] : submissionMaterials
      .filter(file => file.type.startsWith('image/') || file.type.startsWith('video/'))
      .map(file => ({ id: crypto.randomUUID(), name: file.name, type: file.type, size: file.size, file }))
    setIsSending(true)
    setSubmissionError('')
    setSubmissionMessage('')

    try {
      const formData = new FormData()

      formData.append('idea', idea)
      formData.append('networks', JSON.stringify(selectedNetworks))
      formData.append('contentType', contentType)
      formData.append('tone', tone)
      formData.append('materialUse', submissionUse)

      submissionMaterials.forEach((file) => {
        formData.append('materials', file)
      })

      const response = await fetch(
        '/api/create-content',
        {
          method: 'POST',
          body: formData,
        }
      )

      const result = await response.json().catch(() => null)

      if (!response.ok || !result?.success) {
        throw new Error(
          result?.error || 'Não foi possível enviar os dados. Tente novamente em instantes.'
        )
      }

      setReceivedData(result.data)
      setDraftPublications((result.data?.publications || []).map(publication => ({
        id: crypto.randomUUID(),
        network: publication.network || 'Rede social',
        title: publication.title || '',
        content: publication.content || '',
        hashtags: Array.isArray(publication.hashtags) ? publication.hashtags : [],
        suggestedFormat: publication.suggestedFormat || contentType,
        favorite: false,
        previewFormat: submissionFormat,
        attachments: previewAttachments.map(attachment => ({ ...attachment }))
      })))
      setCopyMessage('')
      setSubmissionMessage(result.message)
      setActivePage('criar')
    } catch (error) {
      console.error('Erro ao enviar:', error)

      setSubmissionError(
        error.message || 'Não foi possível conectar ao servidor.'
      )
    } finally {
      setIsSending(false)
    }
  }

  const activeLabel = menuItems.find(
    (item) => item.id === activePage
  )?.label

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">✦</div>
          <span>
            Post<span className="brand-ai">AI</span>
          </span>
        </div>

        <div className="menu-label">MENU PRINCIPAL</div>

        <nav className="navigation" aria-label="Menu principal">
          {menuItems.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${
                activePage === item.id ? 'active' : ''
              }`}
              aria-current={activePage === item.id ? 'page' : undefined}
              onClick={() => setActivePage(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="upgrade-card">
            <div className="upgrade-sparkle">✦</div>
            <strong>Suas ideias não têm limites.</strong>
            <p>Transforme inspiração em conteúdo.</p>
          </div>

          <button
            className={`nav-item ${
              activePage === 'configuracoes' ? 'active' : ''
            }`}
            onClick={() => setActivePage('configuracoes')}
          >
            <span className="nav-icon">⚙</span>
            Configurações
          </button>

          <div className="profile">
            <div className="avatar">P</div>
            <div>
              <strong>Meu espaço</strong>
              <span>Área de criação</span>
            </div>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            PostAI <span>/</span>{' '}
            {activeLabel || 'Configurações'}
          </div>

          <div className="topbar-actions">
            <span className="status-label">
              <span className="status-dot"></span>
              Seu espaço de criação
            </span>

            <button
              className="notification-button"
              aria-label="Notificações"
            >
              ♧
            </button>

            <div className="avatar small">P</div>
          </div>
        </header>

        {activePage === 'inicio' && copyMessage && <p role="status" className="media-operation-status">{copyMessage}</p>}
        {activePage === 'inicio' && (
          <div className="page-content">
            <section className="welcome">
              <div>
                <span className="eyebrow">
                  SEU ESTÚDIO DE CRIAÇÃO
                </span>

                <h1>
                  Olá! Vamos criar algo <span>incrível?</span>
                </h1>

                <p>
                  Suas ideias merecem virar conteúdos que conectam.
                </p>
              </div>

              <div className="welcome-decoration">✦</div>
            </section>

            <section className="creation-card">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">COMECE POR AQUI</span>
                  <h2>O que vamos criar hoje?</h2>
                </div>

                <span className="ai-tag">✦ Assistente IA</span>
              </div>

              <label className="field-label" htmlFor="idea">
                Conte sua ideia
              </label>

              <textarea
                id="idea"
                value={idea}
                onChange={(event) => setIdea(event.target.value)}
                placeholder="Ex.: Quero criar um conteúdo sobre a importância de aprender novas habilidades..."
              />

              <div className="materials-section">
                <div className="materials-heading">
                  <div>
                    <label className="field-label">
                      Materiais de referência
                    </label>

                    <p>
                      Adicione documentos, imagens, áudios ou vídeos
                      para complementar sua ideia.
                    </p>
                  </div>

                  <span className="materials-icon">📎</span>
                </div>

                <label
                  className="upload-area"
                  htmlFor="materialUpload"
                >
                  <span className="upload-icon">☁</span>
                  <strong>Adicionar arquivos</strong>
                  <span>
                    Clique para selecionar um ou mais arquivos
                  </span>
                  <small>
                    PDF, DOCX, TXT, imagens, áudio e vídeo · até 5 MB por arquivo e 20 MB no total
                  </small>
                </label>

                <input
                  id="materialUpload"
                  className="file-input"
                  type="file"
                  multiple
                  accept=".pdf,.docx,.txt,image/*,audio/*,video/*"
                  onChange={handleFileChange}
                />

                <div className="material-usage">
                  <span className="field-label">
                    Como deseja utilizar os arquivos?
                  </span>

                  <label>
                    <input
                      type="radio"
                      name="materialUse"
                      value="reference"
                      checked={materialUse === 'reference'}
                      onChange={(event) =>
                        setMaterialUse(event.target.value)
                      }
                    />
                    Usar como referência para a IA
                  </label>

                  <label>
                    <input
                      type="radio"
                      name="materialUse"
                      value="post"
                      checked={materialUse === 'post'}
                      onChange={(event) =>
                        setMaterialUse(event.target.value)
                      }
                    />
                    Usar como material da publicação
                  </label>

                  <label>
                    <input
                      type="radio"
                      name="materialUse"
                      value="both"
                      checked={materialUse === 'both'}
                      onChange={(event) =>
                        setMaterialUse(event.target.value)
                      }
                    />
                    Usar das duas formas
                  </label>
                </div>

                {materials.length > 0 && (
                  <div className="selected-materials">
                    <strong>
                      Arquivos selecionados ({materials.length})
                    </strong>

                    {materials.map((file, index) => (
                      <div
                        className="material-item"
                        key={`${file.name}-${file.lastModified}`}
                      >
                        <span>{getFileIcon(file)}</span>

                        <div className="material-info">
                          <strong>{file.name}</strong>
                          <small>
                            {formatFileSize(file.size)}
                          </small>
                        </div>

                        <button
                          type="button"
                          className="remove-material"
                          onClick={() => removeMaterial(index)}
                          aria-label={`Remover ${file.name}`}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="form-divider"></div>

              <div className="field-group">
                <span className="field-label">
                  Como deseja criar?
                </span>

                <div className="mode-options">
                  <button
                    className={`mode-option ${
                      mode === 'single' ? 'selected' : ''
                    }`}
                    onClick={() => {
                      setMode('single')
                      setSelectedNetworks(current => current.slice(0, 1))
                    }}
                  >
                    <span className="mode-icon">◉</span>
                    <span>
                      <strong>Uma rede</strong>
                      <small>Conteúdo individual</small>
                    </span>
                  </button>

                  <button
                    className={`mode-option ${
                      mode === 'multiple' ? 'selected' : ''
                    }`}
                    onClick={() => setMode('multiple')}
                  >
                    <span className="mode-icon">✧</span>
                    <span>
                      <strong>Várias redes</strong>
                      <small>Versões adaptadas</small>
                    </span>
                  </button>
                </div>
              </div>

              <div className="field-group">
                <span className="field-label">
                  {mode === 'single'
                    ? 'Escolha uma rede social'
                    : 'Escolha as redes sociais'}
                </span>

                <div className="network-options">
                  {networks.map((network) => (
                    <button
                      key={network}
                      className={`network-chip ${
                        selectedNetworks.includes(network)
                          ? 'selected'
                          : ''
                      }`}
                      onClick={() => {
                        if (mode === 'single') {
                          setSelectedNetworks([network])
                        } else {
                          toggleNetwork(network)
                        }
                      }}
                    >
                      {selectedNetworks.includes(network) && (
                        <span>✓ </span>
                      )}
                      {network}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-row">
                <div className="field-group">
                  <label
                    className="field-label"
                    htmlFor="contentType"
                  >
                    Formato
                  </label>

                  <select
                    id="contentType"
                    value={contentType}
                    onChange={(event) =>
                      setContentType(event.target.value)
                    }
                  >
                    <option>Post</option>
                    <option>Carrossel</option>
                    <option>Story</option>
                    <option>Roteiro de vídeo</option>
                    <option>Legenda</option>
                    <option>Descrição de vídeo</option>
                  </select>
                </div>

                <div className="field-group">
                  <label className="field-label" htmlFor="tone">
                    Tom de comunicação
                  </label>

                  <select
                    id="tone"
                    value={tone}
                    onChange={(event) =>
                      setTone(event.target.value)
                    }
                  >
                    <option>Profissional e próximo</option>
                    <option>Descontraído</option>
                    <option>Educativo</option>
                    <option>Inspirador</option>
                    <option>Persuasivo</option>
                    <option>Formal</option>
                  </select>
                </div>
              </div>

              <div className="creation-footer">
                <span>
                  ✦ Sua criatividade, potencializada por IA.
                </span>

                <button
                  className="primary-button"
                  onClick={handleCreateContent}
                  disabled={
                    !idea.trim() ||
                    selectedNetworks.length === 0 ||
                    isSending
                  }
                >
                  {isSending ? 'Enviando...' : 'Continuar criação'}
                  {!isSending && <span>→</span>}
                </button>
              </div>

              {submissionError && (
                <p role="alert" style={{ color: '#dc2626', marginTop: '12px' }}>
                  {submissionError}
                </p>
              )}
            </section>

            <section className="overview-section">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">ACOMPANHAMENTO</span>
                  <h2>Visão geral</h2>
                </div>

                <span className="muted-text">
                  Seu espaço de criação
                </span>
              </div>

              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-icon purple">✦</div>
                  <span>Conteúdos criados</span>
                  <strong>0</strong>
                  <small>
                    Suas criações aparecerão aqui
                  </small>
                </div>

                <div className="stat-card">
                  <div className="stat-icon lavender">▤</div>
                  <span>Rascunhos</span>
                  <strong>0</strong>
                  <small>Conteúdos em andamento</small>
                </div>

                <div className="stat-card">
                  <div className="stat-icon pink">♡</div>
                  <span>Favoritos</span>
                  <strong>0</strong>
                  <small>Suas ideias favoritas</small>
                </div>
              </div>
            </section>

            <section className="recent-section">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">SEU HISTÓRICO</span>
                  <h2>Publicações recentes</h2>
                </div>

                <button
                  className="text-button"
                  onClick={() => setActivePage('publicacoes')}
                >
                  Ver todas →
                </button>
              </div>

              {savedPublications.length > 0 ? savedPublications.slice(0, 3).map(item => renderPublication(item)) : <div className="empty-state">
                <div className="empty-icon">▤</div>
                <strong>
                  Suas próximas ideias começam aqui
                </strong>
                <p>
                  Quando você criar e salvar conteúdos, eles
                  aparecerão nesta área.
                </p>
              </div>}
            </section>
          </div>
        )}

        {activePage !== 'inicio' && (
          <div className="page-content secondary-page">
            <span className="eyebrow">
              POSTAI •{' '}
              {activeLabel?.toUpperCase() || 'CONFIGURAÇÕES'}
            </span>

            <h1>{activeLabel || 'Configurações'}</h1>

            <p>
              Esta área faz parte da estrutura inicial do PostAI.
              Vamos desenvolver suas funcionalidades nas próximas
              etapas.
            </p>

            {activePage === 'criar' && (
              <div className="creation-summary">
                <h2>Resumo da sua criação</h2>

                {submissionMessage && (
                  <p style={{ color: '#16803c' }}>
                    ✓ {submissionMessage}
                  </p>
                )}

                {receivedData && (
                  <>
                    <p>
                      <strong>Ideia:</strong> {receivedData.idea}
                    </p>

                    <p>
                      <strong>Redes:</strong>{' '}
                      {receivedData.networks.join(', ')}
                    </p>

                    <p>
                      <strong>Formato:</strong>{' '}
                      {receivedData.contentType}
                    </p>

                    <p>
                      <strong>Tom:</strong> {receivedData.tone}
                    </p>

                    <p>
                      <strong>Materiais recebidos:</strong>{' '}
                      {receivedData.materials.length} arquivo(s)
                    </p>

                    {receivedData.materials.map((file, index) => (
                      <p key={`${file.name}-${index}`}>
                        📎 {file.name} — {formatFileSize(file.size)}
                      </p>
                    ))}

                    <p>
                      <strong>Uso dos materiais:</strong>{' '}
                      {receivedData.materialUse === 'reference'
                        ? 'Referência para IA'
                        : receivedData.materialUse === 'post'
                          ? 'Material da publicação'
                          : 'Ambas as formas'}
                    </p>
                  </>
                )}

                <h2 style={{ marginTop: 24 }}>Publicações geradas</h2>
                <p>Edite cada versão e clique em Salvar para manter no histórico deste navegador.</p>
                {draftPublications.length ? draftPublications.map(item => renderPublication(item, true)) : <p>Nenhuma publicação foi retornada.</p>}
                {copyMessage && <p role="status" style={{ color: '#7654C8' }}>{copyMessage}</p>}
                <small>Arquivos PDF, DOCX e TXT podem ser extraídos pelo servidor. Imagens e vídeos podem acompanhar a prévia, mas não são analisados pela IA neste fluxo. O histórico e a mídia ficam somente neste navegador; limpar os dados do site os remove.</small>
              </div>
            )}

            {(activePage === 'publicacoes' || activePage === 'favoritos') && (
              <section style={{ marginTop: 20 }}>
                <h2>{activePage === 'favoritos' ? 'Publicações favoritas' : 'Histórico salvo'}</h2>
                {(activePage === 'favoritos' ? savedPublications.filter(item => item.favorite) : savedPublications).length === 0
                  ? <p>Nenhuma publicação salva nesta seção ainda.</p>
                  : (activePage === 'favoritos' ? savedPublications.filter(item => item.favorite) : savedPublications).map(item => renderPublication(item))}
                {copyMessage && <p role="status">{copyMessage}</p>}
              </section>
            )}

            <button
              className="primary-button"
              onClick={() => setActivePage('inicio')}
            >
              ← Voltar ao início
            </button>
          </div>
        )}

        <footer className="footer">
          <span>PostAI © 2026</span>
          <span>
            Ideias boas merecem ser compartilhadas.
          </span>
        </footer>
      </main>
    </div>
  )
}

export default App
