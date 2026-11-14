# Identidade oficial do PostAI

Fonte: `postai-media-kit.svg`, cópia integral do arquivo fornecido pelo usuário
(`Downloads/PostAI svg`). A prancha possui 1536 × 1024 unidades e contém a marca,
suas aplicações, a paleta e a especificação Outfit Semibold.

## Recursos extraídos

- `postai-logo.svg`: símbolo e nome integrados, sem o slogan da prancha.
- `postai-symbol.svg`: símbolo isolado da marca principal.
- `../favicon.svg`: o mesmo símbolo, com margem quadrada para uso no navegador.

A extração conserva os seis paths originais da marca no grupo
`translate(260 55)`: os dois primeiros paths (A e I) e os quatro paths com
gradientes `g38`, `g39`, `g40` e `g41`. O símbolo é o path `g38`.
Os dados dos paths e dos gradientes foram mantidos literalmente. Somente a
translação de posicionamento na prancha foi removida, e o viewBox foi ajustado.
Não houve redesenho, substituição por texto, suavização ou alteração de cores.

O slogan embutido na prancha é “Boas Ideias merecem ser compartilhadas.”.
A interface usa o texto explicitamente aprovado pelo usuário:
“Ideias boas merecem ser compartilhadas.”, separado do logotipo para legibilidade.

## Estilos

Os tokens em `src/index.css` seguem a paleta da prancha: `#171329`, `#7654C8`,
`#A78BFA`, `#EDE7FF`, `#FFFFFF`; gradiente `#A78BFA` → `#5B21B6`.
Outfit é carregada pelo Google Fonts, com peso 600 nos títulos principais e
fallback local do sistema se a fonte externa não estiver disponível.
