# PostAI

Gerador de rascunhos para redes sociais. React e Vite no frontend, Express no backend e geração via cenário Make com Gemini. O Express usa Multer em memória e extrai texto de PDF, DOCX e TXT. O navegador guarda histórico e favoritos em localStorage e mídia em IndexedDB.

## Rodar localmente

Use Node 24 LTS atualizado ou uma versão compatível (validação executada com Node 26.13.0). Na raiz:

```powershell
npm ci --include=dev
Copy-Item server/.env.example server/.env
```

Preencha MAKE_WEBHOOK_URL em server/.env com o webhook existente. O exemplo contém somente os nomes. Preserve a chave Gemini na configuração do cenário Make. O servidor usa PORT=3001 por padrão.

```powershell
# Terminal 1
npm start
# Terminal 2
npm run dev
```

Abra http://localhost:5173. O Vite encaminha /api para 127.0.0.1:3001. Healthcheck em http://127.0.0.1:3001/api/health. Use npm.cmd no PowerShell se o wrapper npm.ps1 estiver bloqueado.

```powershell
npm run lint
npm run build
node --test tests/*.test.mjs
$env:NODE_ENV='production'
npm start
```

Em produção, abra a porta do Express. O servidor publica dist e /api na mesma origem. O frontend usa /api/create-content por URL relativa. Nenhuma variável VITE_ é necessária.

## Integração e limites

O formulário envia ideia, redes, tipo, tom e materiais ao Express. O servidor envia metadados e texto extraído para o webhook do Make, aguarda JSON com publications e devolve os rascunhos. O Gemini é chamado no Make. O retorno externo tem timeout de 40 segundos. A API retorna JSON em falhas de formulário, configuração ou provedor.

A geração aceita até 10 arquivos, 5 MB por arquivo e 20 MB somados. São até seis solicitações por IP por minuto e duas em andamento por processo. Limites em memória são reiniciados com o serviço. A API rejeita outras origens no navegador. A verificação de origem não é autenticação. Monitore a quota disponível no Make e no Gemini durante a demonstração.

A prévia de imagem e vídeo usa os arquivos do navegador quando selecionados como material da publicação ou para ambos os usos. Áudio, imagens e vídeos não são interpretados pelo backend. A extração de PDFs digitalizados sem texto não faz OCR. Evite dados pessoais ou confidenciais. A ideia, os nomes de arquivos e o texto extraído seguem para o cenário externo. Histórico e anexos dependem do navegador, perfil e domínio, sem sincronização entre dispositivos.

## Deploy manual no Render

1. Em um repositório Git dedicado ao PostAI, confira a lista de arquivos antes do commit. Use git status --short --untracked-files=all e verifique que .env, variações de ambiente, chaves, backups, dados de teste privados e a configuração local multiworkspace estão fora. server/.env.example pode entrar vazio. Envie o código a um repositório conectado ao Render.
2. Após autorização, selecione New > Web Service e conecte o repositório. Use runtime Node, raiz do PostAI, build command npm ci --include=dev && npm run build e start command npm start.
3. Em Environment, configure NODE_ENV=production, NODE_VERSION=24 e MAKE_WEBHOOK_URL como segredo, usando a URL do cenário existente. Deixe PORT ser gerenciado pelo Render. Nenhuma chave Gemini vai para o frontend ou para este repositório.
4. Em Advanced, use /api/health como caminho de healthcheck e desative Auto-Deploy durante a revisão, se desejar publicar manualmente cada versão. Use uma instância sem suspensão se a primeira abertura precisar ser imediata. A instância gratuita pode suspender quando ociosa.
5. Faça o deploy somente após autorização. Abra a URL HTTPS em janela anônima e complete o checklist antes de divulgar o link no portfólio.

Documentação oficial: [Express no Render](https://render.com/docs/deploy-node-express-app), [Web Services](https://render.com/docs/web-services) e [primeiro deploy](https://render.com/docs/your-first-deploy).

## Checklist de publicação

- [ ] Confirmar cenário Make disponível, quota Gemini e resposta JSON do webhook.
- [ ] Conferir repositório sem segredos e configurar a URL do webhook no ambiente do servidor.
- [ ] Validar URL HTTPS e /api/health em janela anônima. Gerar com texto de teste e conferir rascunhos reais.
- [ ] Editar, salvar, favoritar e recarregar. Reabrir Publicações e Favoritos e confirmar as mudanças.
- [ ] Gerar com imagem e vídeo curtos selecionados como material da publicação. Conferir renderização, reprodução, persistência após recarga e exclusão do anexo e da publicação.
- [ ] Conferir formulário e controle de upload com Tab e Enter, telas estreitas e mensagem clara quando a geração falhar.
- [ ] Revisar quotas e logs sem segredos. Só então usar a URL pública no portfólio.

## Validação de preparação

Lint, build e os dois testes automatizados existentes passaram. Os testes cobrem persistência e limpeza de mídia, compatibilidade do histórico e verificações estáticas de prévia. Em produção local, página e health retornaram 200, rota inválida 404, formulário inválido 400, origem externa 403 e arquivo acima do limite 413. No navegador, a navegação para Publicações respondeu ao Enter e o layout não apresentou rolagem horizontal em 320, 390, 768 e 1440 px.

O teste real de geração com uma ideia sintética chegou ao Express e retornou 502. A rede do ambiente recusou a saída para o domínio do Make (EACCES). A execução ponta a ponta com geração, edição, favoritos e prévias de imagem/vídeo ainda precisa ser repetida em ambiente com acesso ao webhook. O teste de saúde confirma o processo Express.

