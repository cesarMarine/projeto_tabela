# Indicadores da carteira do vendedor

Arquivos de execução: `vendedor.html`, `vendedor-metricas.js`,
`vendedor-metricas-server.js` e `server_novo.js`.
Publicar os quatro, reiniciar o servidor da tabela e recarregar com Ctrl+F5.
Não é necessária uma nova tabela ou migração para o painel.

O painel aparece após o login e atualiza a cada 30 segundos enquanto a aba estiver
visível. A consulta usa o código e a senha do login em cabeçalho, sem guardar
credenciais em localStorage ou colocá-las na URL. O servidor autentica o vendedor
e lê clientes e pedidos apenas do representante. Não consulta Supabase durante
o desenvolvimento ou testes e não modifica registros.

## Significado dos indicadores

- Clientes que acessaram: documentos distintos da carteira atual com acesso
  registrado no dia escolhido. Acessos repetidos não aumentam essa contagem.
- Montando pedido (15 min): clientes com rascunho cujo `data_criacao` foi atualizado
  pelo salvamento nos últimos 15 minutos. Não comprova que o cliente esteja online.
- Clientes com rascunho e valor em rascunhos: registros em aberto agora, de qualquer data.
- Pedidos/valor enviados: somente status `ENVIADO`, no dia escolhido, conforme
  `data_criacao`. Não equivale a nota fiscal, faturamento ou finalização pelo vendedor.
- A lista de acessos mostra o horário e aparelho do último acesso registrado de
  cada cliente naquele dia; não atribui esse aparelho ao pedido.
- Os chips de aparelhos contam eventos de acesso, incluindo acessos repetidos.
- Datas e horários usam `America/Sao_Paulo`, independentemente do fuso do servidor.

O tipo de aparelho vem da coluna `logins_clientes.dispositivo` já usada pelo sistema.
Registros sem essa informação mostram “Não informado”. Se a coluna não existir,
o painel mantém os outros indicadores e lê os acessos sem ela. A migração anterior
`dispositivos.sql` pode ser revisada separadamente caso seja necessário habilitar
novos registros de aparelho; dados antigos não são reconstruídos.

As consultas são paginadas e não carregam os itens de todos os pedidos. As tabelas
do painel mostram dez linhas por página. Falhas de consulta mantêm os dados
anteriores identificados pela data e horário, em vez de apresentar zeros falsos.

## Verificação e reversão

`vendedor-metricas.test.mjs` usa dados sintéticos, API simulada e DOM simulado.
Não inicia o servidor nem acessa produção.

```powershell
node --test --test-isolation=none vendedor-metricas.test.mjs
```

As versões anteriores de `vendedor.html` e `server_novo.js` estão em
`backups/painel_metricas_vendedor_20261117_095700/`. Restaurar e republicar esses
dois arquivos remove o novo painel sem alterar dados. Os novos scripts ficam sem uso.
