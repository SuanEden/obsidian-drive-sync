# Obsidian Drive Sync

Base inicial de um plugin pessoal para sincronização bidirecional de um cofre do Obsidian com uma pasta dedicada no Google Drive. Esta versão **não acessa a rede e não altera arquivos do cofre**.

## Estado da fase 1

- plugin compatível com desktop e mobile (`isDesktopOnly: false`);
- tela de configurações em português do Brasil;
- indicador inicial no rodapé;
- comando e botão **Sincronizar agora** registrados como operação segura sem efeito;
- preferências locais tipadas e lista inicial de itens ignorados;
- build, lint, formatação e testes automatizados.

## Arquitetura proposta

```text
main.ts                    ciclo de vida e composição
src/domain/                regras puras, metadados e decisões de sincronização
src/settings/              configuração local por aparelho
src/services/              coordenação, estado, histórico e exclusão mútua
src/auth/                  OAuth 2.0 e ciclo de tokens (fase futura)
src/drive/                 cliente REST do Google Drive (fase futura)
src/vault/                 acesso portátil via Vault/Adapter (fase futura)
src/sync/                  plano e execução transacional (fase futura)
src/ui/                    configurações, conflitos, backups e histórico
```

O motor será dividido em duas etapas: primeiro calcula um plano imutável a partir dos estados local, remoto e da última sincronização; depois executa operações idempotentes, com backup antes de substituição e tombstones antes de exclusão. Caminhos remotos serão normalizados e validados antes de qualquer chamada ao `Adapter`. A raiz remota será persistida pelo ID do Drive.

### Estrutura remota planejada

A estrutura solicitada será mantida: `vault/`, `backups/`, `trash/` e `sync-data/`. Dentro de `sync-data/`, o manifesto será versionado e escrito por substituição segura. A adoção definitiva depende dos testes de concorrência e será confirmada antes de qualquer implementação que possa remover ou substituir dados.

## Decisão OAuth antes da implementação

O escopo planejado é `https://www.googleapis.com/auth/drive.file`, que limita o acesso aos itens criados ou explicitamente disponibilizados ao aplicativo. Não será solicitado acesso amplo a todo o Drive.

- **Desktop:** aplicativo instalado, Authorization Code com PKCE, navegador do sistema e redirecionamento para loopback local. O Google mantém loopback para clientes OAuth de desktop.
- **Android:** o loopback é bloqueado para clientes Android, e um plugin JavaScript do Obsidian não controla o pacote/assinatura do aplicativo hospedeiro nem consegue integrar diretamente o SDK nativo recomendado pelo Google. O fluxo em navegador embutido também não é permitido.

Portanto, a autenticação móvel não será improvisada. As opções que precisam de decisão antes da fase de OAuth são: um pequeno callback HTTPS intermediário em domínio controlado (sem guardar tokens; ainda exige operação, política de privacidade e análise de risco), ou limitar a autorização inicial ao desktop e estudar uma transferência local protegida da credencial para o aparelho. `data.json` não é armazenamento criptografado; nenhum refresh token será salvo nele sem uma decisão explícita sobre esse risco.

Não serão usados client secrets confidenciais no bundle. Um client ID de aplicativo instalado é identificador público, não senha. Tokens nunca entrarão em logs nem no conjunto sincronizado.

## Fases seguintes

1. Modelos de metadados, validação de caminhos, regras de comparação por hash e testes de tabela.
2. Persistência local, inventário do cofre via `Vault`/`Adapter` e histórico, ainda sem Drive.
3. OAuth após aprovação explícita da estratégia para Android e do armazenamento de tokens.
4. Cliente Drive paginado, upload resumível, retry com backoff e criação/seleção da raiz remota.
5. Primeira sincronização nos três modos, conflitos, backups e exclusões protegidas.
6. Automação por eventos, debounce, intervalo e retomada; revisão móvel e testes de falha.

## Desenvolvimento

Requer Node.js 18 ou mais recente.

```bash
npm install
npm run build
npm run lint
npm test
```

Para recompilar continuamente durante o desenvolvimento:

```bash
npm run dev
```

Depois do build, recarregue o Obsidian, abra **Configurações → Plugins da comunidade** e habilite **Obsidian Drive Sync**. Use a paleta de comandos para executar **Sincronizar agora**. A tela própria aparece nas configurações do Obsidian.

## Segurança atual

- nenhum dado real ou credencial é usado;
- nenhuma API externa é chamada pelo plugin;
- nenhum arquivo do cofre é criado, alterado ou excluído;
- `data.json` e os futuros metadados internos do plugin são ignorados por padrão.

## Licença

MIT.
