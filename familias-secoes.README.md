# Seções de famílias no catálogo

Esta mudança adiciona títulos como “Perfil baixo” e “Carretilhas para pesqueiro”.
As seções guardam os IDs das famílias, sem depender de faixas fixas de posições.
A ordem numérica existente continua definindo a sequência dentro de cada seção.
A ordem das seções é independente e pode ser alterada com as setas do novo painel.
Famílias visíveis sem seção aparecem em “Outras famílias”. Seções sem resultados
no filtro atual não geram títulos vazios. Kits continuam disponíveis separadamente.

## Ativar

1. Revisar e executar uma vez `familias-secoes.sql` no SQL Editor do Supabase do
   projeto tabela. O arquivo cria somente `catalogo_secoes_familias` e ativa RLS.
   O backend utiliza a chave de serviço existente. Nenhuma credencial nova é necessária.
2. Publicar `server_novo.js`, `admin_novo.html`, `index.html`,
   `familias-ordem-cliente.js`, `familias-secoes-server.js`, `familias-secoes.js`
   e `familias-secoes-admin.js`. Manter também os scripts da ordenação já publicados.
3. Reiniciar o servidor e recarregar admin e catálogo com Ctrl+F5.

A migração NÃO foi executada pelo desenvolvimento e não houve conexão à produção.
Sem a tabela nova, o catálogo continua sem seções e o admin informa a configuração
pendente. Se a API de seções estiver indisponível, os produtos continuam disponíveis.
O servidor valida IDs existentes e famílias duplicadas antes de salvar a configuração
inteira de um grupo em uma única operação. Não modifica produtos, famílias, pedidos
ou os campos de ordenação existentes.

## Usar

Em Admin → Famílias → Seções com título no catálogo:

1. Escolher o grupo, por exemplo CARRETILHAS.
2. Selecionar as famílias individualmente ou usar “Da posição 1 até 16 → Selecionar faixa”.
3. Informar “Perfil baixo” e clicar em “Criar com selecionadas”.
4. Selecionar outra faixa, informar “Carretilhas para pesqueiro” e criar a segunda seção.
5. Ajustar títulos e a sequência das seções com as setas, depois clicar em “Salvar seções”.

As faixas servem apenas para selecionar. Depois de criar a seção, cada família segue
vinculada pelo seu ID, mesmo que seja movida na ordenação visual/numerada.
Para transferir famílias, selecioná-las e usar “Mover selecionadas para”.
“Deixar sem seção” e “Remover seção” removem somente o vínculo visual.
“Descartar alterações” abandona apenas a prévia não salva.

## Voltar ao visual anterior

Desmarcar “Exibir seções no catálogo” para cada grupo configurado e salvar.
Isso preserva os nomes e vínculos, mas volta à ordem anterior sem os títulos.

Uma cópia dos cinco arquivos anteriores também está em
`backups/antes_secoes_familias_20261116_214758/`.
O script `restaurar.ps1` nessa pasta restaura somente esses arquivos locais.
Depois é necessário republicá-los e reiniciar o servidor. Não remove tabelas nem dados.
Os novos scripts ficam sem uso ao restaurar os arquivos anteriores.

## Verificação

Os testes usam dados sintéticos, renderer real do index em VM, DOM simulado e
cliente Supabase simulado. Não iniciam o servidor nem acessam o banco de produção.

```powershell
node --test --test-isolation=none familias-secoes.test.mjs familias-ordem.test.mjs familias-ordem-cliente.test.mjs
```
