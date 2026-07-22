# Changelog

## 0.10.5

- Adiciona barra de progresso ao primeiro upload, primeiro download e análise local.
- Mostra porcentagem, arquivos concluídos, etapa e caminho atual sem recarregar a tela.

## 0.10.4

- Torna os testes de upload compatíveis com a ordem não determinística das transferências paralelas.

## 0.10.3

- Mostra a pasta remota vinculada ao vault aberto.
- Permite trocar explicitamente a pasta remota sem apagar conteúdo do Google Drive.
- Limpa o modo inicial anterior ao trocar de pasta para impedir envios acidentais.

## 0.10.2

- Envia e baixa até três arquivos simultaneamente para reduzir a latência do Google Drive.
- Mantém limite de memória, verificação individual por SHA-256 e manifesto somente ao final.
- Continua aplicando downloads localmente em sequência para preservar backups e conflitos.

## 0.10.1

- Repete automaticamente falhas transitórias de DNS e transporte no Android.
- Mostra orientação específica para Wi-Fi, dados móveis, DNS privado, VPN e bloqueadores.

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
