# Serviço OAuth do Drive Sync

Cloudflare Worker sem banco de dados. Valida a identidade Google, restringe a conta por allowlist e cifra os tokens para uma chave temporária do plugin.

## Segurança

- Não grava tokens, códigos ou e-mails em logs ou armazenamento.
- Client Secret existe somente como Cloudflare Secret.
- Estado OAuth autenticado por HMAC e válido por dez minutos.
- Retorno cifrado com ECDH P-256, HKDF-SHA-256 e AES-256-GCM.
- Conta fora da allowlist tem o token revogado.

## Desenvolvimento

Copie `.dev.vars.example` para `.dev.vars`, preencha localmente e execute:

```bash
npm install
npm run typecheck
npm run dev
```

## Produção

Worker publicado em `https://drive-sync-oauth.suan-obsidian-sync.workers.dev`. O callback Google é:

`https://drive-sync-oauth.suan-obsidian-sync.workers.dev/oauth/callback`

Cadastre os valores sem colocá-los no `wrangler.jsonc`:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_REDIRECT_URI
npx wrangler secret put OAUTH_STATE_SECRET
npx wrangler secret put ALLOWED_GOOGLE_EMAIL
```

`GOOGLE_REDIRECT_URI` deve coincidir exatamente com o callback cadastrado no Google Cloud. Depois de alterar código ou segredos, execute `npm run deploy` para publicar uma nova versão.
