import express from 'express'
import multer from 'multer'
import dotenv from 'dotenv'
import { PDFParse } from 'pdf-parse'
import mammoth from 'mammoth'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Localização correta dos arquivos
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Carrega o arquivo .env que fica dentro da pasta server
dotenv.config({
  path: path.join(__dirname, '.env')
})

const app = express()
const PORT = Number(process.env.PORT || 3001)
const isProduction = process.env.NODE_ENV === 'production'
const distDirectory = path.resolve(__dirname, '../dist')
const MAX_FILES = 10
const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_TOTAL_BYTES = 20 * 1024 * 1024
const MAX_CONCURRENT_REQUESTS = 2
const RATE_WINDOW_MS = 60_000
const MAX_REQUESTS_PER_WINDOW = 6

app.disable('x-powered-by')
// Render is the single reverse proxy for the production service.
if (isProduction && process.env.RENDER === 'true') app.set('trust proxy', 1)

let activeRequests = 0
const requestWindows = new Map()

function limitGeneration(req, res, next) {
  const origin = req.get('origin')
  const expectedOrigin = `${req.protocol}://${req.get('host')}`
  const isLocalVite = !isProduction && /^http:\/\/(localhost|127\.0\.0\.1):(5173|4173)$/.test(origin || '')
  if (origin && origin !== expectedOrigin && !isLocalVite) {
    return res.status(403).json({ error: 'Origem da solicitação inválida.' })
  }
  if (!req.is('multipart/form-data')) {
    return res.status(415).json({ error: 'Envie a solicitação como formulário multipart.' })
  }
  const length = Number(req.get('content-length'))
  if (length > MAX_TOTAL_BYTES + 256 * 1024) {
    return res.status(413).json({ error: 'Os anexos podem somar até 20 MB.' })
  }

  const now = Date.now()
  for (const [ip, entry] of requestWindows) {
    if (entry.expiresAt <= now) requestWindows.delete(ip)
  }
  const window = requestWindows.get(req.ip) || { count: 0, expiresAt: now + RATE_WINDOW_MS }
  if (activeRequests >= MAX_CONCURRENT_REQUESTS ||
      window.count >= MAX_REQUESTS_PER_WINDOW || requestWindows.size >= 1000) {
    res.set('Retry-After', '60')
    return res.status(429).json({ error: 'Geração temporariamente ocupada. Tente novamente em um minuto.' })
  }
  window.count++
  requestWindows.set(req.ip, window)
  activeRequests++
  let released = false
  const release = () => {
    if (!released) {
      released = true
      activeRequests--
    }
  }
  res.once('finish', release)
  res.once('close', release)
  next()
}


const storage = multer.memoryStorage()

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_BYTES,
    files: MAX_FILES,
    fields: 5,
    fieldSize: 16 * 1024,
    parts: MAX_FILES + 6
  }
})

const MAX_TEXT_LENGTH = 30000

async function extractDocument(file) {
  const extension = file.originalname
    .split('.')
    .pop()
    .toLowerCase()

  try {
    let extractedText = ''
    let fileType = ''

    if (extension === 'pdf') {
      fileType = 'PDF'

      const parser = new PDFParse({
        data: file.buffer
      })

      try {
        const result = await parser.getText()
        extractedText = result.text || ''
      } finally {
        await parser.destroy()
      }

    } else if (extension === 'docx') {
      fileType = 'Word'

      const result = await mammoth.extractRawText({
        buffer: file.buffer
      })

      extractedText = result.value || ''

    } else if (extension === 'txt') {
      fileType = 'Texto'
      extractedText = file.buffer.toString('utf8')

    } else {
      return {
        name: file.originalname,
        type: file.mimetype,
        size: file.size,
        status: 'unsupported',
        message: 'Formato ainda não suportado.'
      }
    }

    if (!extractedText.trim()) {
      return {
        name: file.originalname,
        type: file.mimetype,
        size: file.size,
        fileType,
        status: 'empty',
        message: 'Nenhum texto encontrado.'
      }
    }

    return {
      name: file.originalname,
      type: file.mimetype,
      size: file.size,
      fileType,
      status: 'processed',
      extractedText: extractedText.slice(0, MAX_TEXT_LENGTH),
      truncated: extractedText.length > MAX_TEXT_LENGTH
    }

  } catch (error) {
    console.error('Falha ao extrair texto:', error.name)

    return {
      name: file.originalname,
      type: file.mimetype,
      size: file.size,
      status: 'error',
      message: 'Não foi possível ler o arquivo.'
    }
  }
}

// Verificação do servidor
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    application: 'PostAI',
    message: 'Servidor funcionando!'
  })
})

// Criação de conteúdo
app.post(
  '/api/create-content',
  limitGeneration,
  upload.array('materials', MAX_FILES),
  async (req, res) => {
    try {
      const {
        idea,
        networks,
        contentType,
        tone,
        materialUse
      } = req.body

      if (typeof idea !== 'string' || !idea.trim()) {
        return res.status(400).json({
          error: 'Informe uma ideia para criar o conteúdo.'
        })
      }

      let selectedNetworks
      try {
        selectedNetworks = JSON.parse(networks || '[]')
      } catch {
        return res.status(400).json({ error: 'Seleção de redes sociais inválida.' })
      }

      if (
        !Array.isArray(selectedNetworks) ||
        selectedNetworks.length === 0 ||
        selectedNetworks.length > 10 ||
        selectedNetworks.some(network => typeof network !== 'string' || !network.trim())
      ) {
        return res.status(400).json({
          error: 'Selecione pelo menos uma rede social.'
        })
      }

      if ((req.files || []).reduce((bytes, file) => bytes + file.size, 0) > MAX_TOTAL_BYTES) {
        return res.status(413).json({ error: 'Os anexos podem somar até 20 MB.' })
      }

      const webhookUrl = process.env.MAKE_WEBHOOK_URL
      if (!webhookUrl) {
        return res.status(503).json({ error: 'Geração de conteúdo indisponível no momento.' })
      }

      const materials = await Promise.all(
        (req.files || []).map(file => extractDocument(file))
      )

      const makeResponse = await fetch(webhookUrl, {
        method: 'POST',
        signal: AbortSignal.timeout(40_000),
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          application: 'PostAI',
          idea,
          networks: selectedNetworks,
          contentType,
          tone,
          materialUse,
          materials
        })
      })

      const responseText = await makeResponse.text()

      if (!makeResponse.ok) {
        throw new Error(
          `Erro na resposta do Make: ${makeResponse.status}`
        )
      }

      let generatedContent

      try {
        generatedContent = JSON.parse(responseText)
      } catch {
        throw new Error(
          'O Make não retornou um JSON válido.'
        )
      }

      const publications = generatedContent.publications

      if (
        !Array.isArray(publications) ||
        publications.length === 0
      ) {
        throw new Error(
          'O Gemini não retornou publicações no formato esperado.'
        )
      }

      res.json({
        success: true,
        message: 'Publicações geradas com sucesso!',
        data: {
          idea,
          networks: selectedNetworks,
          contentType,
          tone,
          materialUse,

          materials: materials.map(file => ({
            name: file.name,
            type: file.type,
            size: file.size,
            status: file.status
          })),

          publications
        },
        processing: 'completed',
        aiGeneration: 'completed'
      })

    } catch (error) {
      console.error('Falha na geração:', error.name)

      const timeout = error.name === 'TimeoutError'
      res.status(timeout ? 504 : 502).json({
        success: false,
        error: timeout
          ? 'A geração demorou demais. Tente novamente em instantes.'
          : 'Não foi possível gerar as publicações. Tente novamente em instantes.'
      })
    }
  }
)

app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota inexistente.' }))

if (isProduction) app.use(express.static(distDirectory))

app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error)
  if (error instanceof multer.MulterError) {
    const limitExceeded = ['LIMIT_FILE_SIZE', 'LIMIT_FILE_COUNT', 'LIMIT_PART_COUNT', 'LIMIT_FIELD_COUNT', 'LIMIT_FIELD_VALUE'].includes(error.code)
    return res.status(limitExceeded ? 413 : 400).json({
      error: limitExceeded ? 'Limite excedido. Envie até 10 arquivos de 5 MB cada e 20 MB no total.' : 'Campo de arquivo inválido.'
    })
  }
  return res.status(400).json({ error: 'Não foi possível ler o formulário.' })
})

app.listen(PORT, isProduction ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`PostAI ouvindo na porta ${PORT}.`)
})