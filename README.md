# Obsidian Drive Sync

Plugin pessoal para manter um cofre do Obsidian em uma estrutura dedicada no Google Drive. O projeto usa APIs portáteis do Obsidian e foi desenhado para desktop e Android.

> **Pré-lançamento:** o primeiro envio e o primeiro download estão implementados. A sincronização incremental contínua ainda não está ativa; mantenha um backup independente e não edite o mesmo cofre em dois aparelhos durante os testes.

## Recursos atuais — 0.10.5

- login Google pelo navegador e retorno por `obsidian://drive-sync-auth`;
- escopo limitado `drive.file` e conta autorizada por allowlist;
- tokens locais no `SecretStorage` do Obsidian;
- renovação automática do access token por Cloudflare Worker;
- descoberta e seleção explícita de cofres remotos criados pelo plugin;
- exibição e troca segura da pasta remota vinculada a cada vault local;
- estrutura remota identificada por IDs e `appProperties`: `vault/`, `backups/`, `trash/` e `sync-data/`;
- inventário local com SHA-256, texto e binários;
- primeiro envio idempotente, com manifesto confirmado somente ao final;
- primeiro download baseado no manifesto, com verificação de tamanho e SHA-256;
- bloqueio de sobrescrita quando uma nota local difere da remota;
- backup de configurações locais do Obsidian antes de substituí-las no primeiro download;
- upload multipart limitado a 20 MB como modo de compatibilidade do Obsidian e retomável acima desse limite;
- até três uploads ou downloads simultâneos, com aplicação local sequencial;
- barra de progresso com porcentagem, contagem, etapa e arquivo atual;
- diagnóstico de 18 MB que envia dados artificiais, verifica o retorno e move o teste para a lixeira;
- regras de decisão de três vias e nomes de conflito já testados para o futuro executor incremental.

## Limitações atuais

- **Sincronizar agora** ainda não executa sincronização incremental.
- Os modos **Combinar local e remoto**, exclusões, conflitos e retenção de backups ainda não estão ligados à interface.
- O teste real de 18 MB deve ser concluído no desktop e no Android antes de enviar arquivos pessoais grandes.
- Projetos Google OAuth no status **Teste** podem exigir nova autorização periodicamente. Revise o status de publicação antes do uso permanente.
- Cada arquivo é carregado individualmente na memória para SHA-256 e transferência. Isso precisa ser observado em aparelhos móveis com arquivos muito grandes.

## Segurança

- Nunca grave `GOOGLE_CLIENT_SECRET`, tokens ou conteúdo de `data.json` no GitHub.
- O diretório do próprio plugin, workspaces locais, `.trash`, `node_modules`, `.git` e arquivos temporários são ignorados por padrão.
- O Worker não mantém banco de tokens; o segredo OAuth fica nos Secrets do Cloudflare.
- O primeiro download prepara e valida os arquivos antes da aplicação. Notas locais divergentes interrompem a operação.
- Configurações locais substituídas recebem cópia em `sync-data/pre-download-backups/`, dentro do diretório ignorado do plugin.

## Estrutura

```text
main.ts          ciclo de vida e composição
src/auth/        OAuth, callback cifrado e renovação
src/domain/      metadados e decisões puras
src/drive/       cliente REST e estrutura remota
src/services/    inventário, hashes e estado
src/settings/    configuração local por aparelho
src/sync/        primeiro envio/download e diagnósticos
src/ui/          configurações do plugin
oauth-worker/    Cloudflare Worker OAuth stateless
```

## Desenvolvimento

Requer Node.js 18 ou mais recente.

```bash
npm ci
npm run build
npm run lint
npm run format:check
npm test
npm --prefix oauth-worker run typecheck
```

Depois do build, recarregue o plugin no Obsidian.

## Instalação de teste com BRAT

Depois que o repositório e uma release forem publicados:

1. Instale e habilite o BRAT no Obsidian.
2. Abra as configurações do BRAT.
3. Escolha **Add Beta Plugin**.
4. Informe `USUARIO/REPOSITORIO`.
5. Habilite **Obsidian Drive Sync** nos plugins da comunidade.

Cada release deve anexar `main.js`, `manifest.json` e `styles.css`. O workflow deste repositório faz isso quando uma tag `v*` é enviada.

## Processo entre aparelhos

No computador principal, crie o cofre remoto e use **Enviar este cofre ao Drive**. Em um aparelho novo, abra uma pasta local nova, instale o plugin, use **Usar cofre existente** e escolha **Baixar o cofre do Drive**. Nunca envie um cofre local vazio sobre um remoto já preenchido.

## Publicação segura

Antes da primeira publicação:

1. redefina o Client Secret que foi exposto durante o desenvolvimento;
2. atualize o Secret `GOOGLE_CLIENT_SECRET` no Worker;
3. execute novamente build, lint, testes e a busca por credenciais;
4. crie o repositório sem adicionar `data.json` ou arquivos `.dev.vars`;
5. crie e envie a tag da versão somente após o teste manual.

## Licença

MIT.
