# Changelog

## 0.10.0

- Renovação automática da sessão Google pelo Worker.
- Descoberta e seleção explícita de cofre remoto existente.
- Primeiro download com staging, hashes, proteção de notas locais e backup de configurações.
- Transporte `fetch` restrito às sessões confiáveis de upload retomável do Google.
- Diagnóstico descartável para uploads acima de 5 MB.
- Modo multipart limitado a 20 MB para contornar bloqueios do PUT retomável no Electron.
- Diretório do próprio plugin ignorado na sincronização.

## 0.9.3

- Primeiro envio confirmado com upload multipart para arquivos pequenos.
