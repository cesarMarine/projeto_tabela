import XLSX from 'xlsx';

const chave = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const digitos = value => String(value ?? '').replace(/\D/g, '');
export const codigoProvisorio = value => /^S\d+$/i.test(String(value || '').trim());

export function cpfValido(d) {
  if (!/^\d{11}$/.test(d) || /^(\d)\1+$/.test(d)) return false;
  for (let n = 9; n <= 10; n++) {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    let verificador = soma * 10 % 11;
    if (verificador === 10) verificador = 0;
    if (verificador !== Number(d[n])) return false;
  }
  return true;
}

export function cnpjValido(d) {
  if (!/^\d{14}$/.test(d) || /^(\d)\1+$/.test(d)) return false;
  for (let n = 12; n <= 13; n++) {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * ((n - 1 - i) % 8 + 2);
    const resto = soma % 11;
    if ((resto < 2 ? 0 : 11 - resto) !== Number(d[n])) return false;
  }
  return true;
}

export function normalizarCnpj(valor, formatado = null) {
  if (valor === null || valor === undefined || String(valor).trim() === '') return { motivo: 'vazio' };
  if (typeof valor === 'number' && (!Number.isSafeInteger(valor) || valor < 0)) return { motivo: 'documento_invalido' };
  let texto = String(valor).trim();
  if (!/^[\d.\/\s-]+$/.test(texto)) return { motivo: 'documento_invalido' };
  if (typeof valor === 'number' && formatado && /^[\d.\/\s-]+$/.test(formatado)) {
    const exibido = digitos(formatado);
    if (Number(exibido) === valor && cnpjValido(exibido)) texto = exibido;
  }
  const original = digitos(texto);
  // Um CPF valido nunca vira CNPJ pelo simples preenchimento de zeros.
  if (cpfValido(original)) return { motivo: 'cpf' };
  if (original.length > 14) return { motivo: 'documento_invalido' };
  const cnpj = original.padStart(14, '0');
  if (!cnpjValido(cnpj)) return { motivo: 'documento_invalido' };
  return { cnpj, zerosRepostos: cnpj !== original };
}

export function prepararClientes(wb) {
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('Planilha sem aba de clientes.');
  const cabecalho = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 0, defval: '', raw: true })[0] || [];
  const colunaDocumento = cabecalho.findIndex(c => ['CPFCNPJ', 'CNPJ'].includes(chave(c)));
  if (colunaDocumento < 0 || !cabecalho.some(c => chave(c) === 'CODIGO')) throw new Error('A primeira aba precisa conter CODIGO e CPF/CNPJ ou CNPJ.');
  const linhas = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
  const aceitos = [], removidos = [], revisar = [], vistos = new Map();
  let zerosRepostos = 0;
  for (let i = 0; i < linhas.length; i++) {
    const r = linhas[i], linha = (r.__rowNum__ ?? i + 1) + 1;
    const campos = Object.fromEntries(Object.entries(r).map(([k, v]) => [chave(k), v]));
    const campo = (...nomes) => nomes.map(n => campos[n]).find(v => v !== undefined && v !== null) ?? '';
    const bruto = campo('CPFCNPJ', 'CNPJ');
    const codigo = String(campo('CODIGO')).trim();
    const celula = sheet[XLSX.utils.encode_cell({ r: linha - 1, c: colunaDocumento })];
    const documento = normalizarCnpj(bruto, celula?.w);
    const detalhe = { linha, codigo, documento_original: String(bruto), valores: cabecalho.map(c => r[c] ?? '') };
    if (documento.motivo) {
      (documento.motivo === 'documento_invalido' ? revisar : removidos).push({ ...detalhe, motivo: documento.motivo });
      continue;
    }
    if (!codigo) { revisar.push({ ...detalhe, motivo: 'codigo_vazio' }); continue; }
    if (vistos.has(documento.cnpj)) {
      removidos.push({ ...detalhe, motivo: 'repetido', linha_mantida: vistos.get(documento.cnpj).linha,
        codigo_mantido: vistos.get(documento.cnpj).item.codigo });
      continue;
    }
    const item = { codigo, cnpj: documento.cnpj,
      nome_fantasia: String(campo('NOMEFANTASIA', 'NOME')).trim(),
      razao_social: String(campo('RAZAOSOCIAL', 'RAZAO')).trim(),
      cidade: String(campo('CIDADE')).trim(), uf: String(campo('ESTADO', 'UF')).trim().toUpperCase(),
      codigo_representante: String(campo('VENDEDOR', 'REPRESENTANTE', 'CODREP', 'CODIGOREPRESENTANTE')).trim(), ativo: 1 };
    const registro = { linha, item };
    aceitos.push(registro); vistos.set(item.cnpj, registro);
    if (documento.zerosRepostos) zerosRepostos++;
  }
  const resumo = { linhas: linhas.length, aptos: aceitos.length, cpfs_removidos: removidos.filter(r => r.motivo === 'cpf').length,
    vazios_removidos: removidos.filter(r => r.motivo === 'vazio').length,
    repetidos_removidos: removidos.filter(r => r.motivo === 'repetido').length,
    revisar: revisar.length, zeros_repostos: zerosRepostos };
  return { aceitos, removidos, revisar, resumo, cabecalho };
}

// Atualiza somente codigo provisorio e UF vazia. Nunca usa upsert para sobrescrever o cadastro.
export async function importarClientesProtegidos(supabase, preparados) {
  const resultado = { ...preparados.resumo, criados: 0, codigos_atualizados: 0, ufs_preenchidas: 0,
    clientes_atualizados: 0, preservados: 0, erros: 0, erros_exemplo: [] };
  const ufs = new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));
  const falha = (registro, error) => {
    resultado.erros++;
    if (resultado.erros_exemplo.length < 5) resultado.erros_exemplo.push({ linha: registro.linha, codigo_erro: error?.code || 'IMPORTACAO',
      mensagem: 'Operacao nao concluida; revisar esta linha. Alteracoes anteriores da carga podem ter sido confirmadas.' });
  };
  const consultar = async documentos => {
    const rows = [];
    for (let start = 0; ; start += 200) {
      const { data, error } = await supabase.from('clientes').select('cnpj,codigo,uf').in('cnpj', documentos)
        .order('cnpj').order('codigo').range(start, start + 199);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < 200) return rows;
    }
  };
  const atualizarExistente = async (registro, existentes) => {
    if (existentes.length !== 1) { falha(registro, { code: 'CNPJ_DUPLICADO_NO_BANCO' }); return; }
    const existente = existentes[0];
    let alterado = false, falhou = false;
    try {
      if (codigoProvisorio(existente.codigo)) {
        const { data, error } = await supabase.from('clientes').update({ codigo: registro.item.codigo })
          .eq('cnpj', registro.item.cnpj).eq('codigo', existente.codigo).select('codigo');
        if (error) throw error;
        if (data?.length > 1) throw { code: 'CNPJ_DUPLICADO_NO_BANCO' };
        if (data?.length === 1) { resultado.codigos_atualizados++; alterado = true; }
      }
      const novaUf = String(registro.item.uf || '').trim().toUpperCase();
      if (!String(existente.uf ?? '').trim() && ufs.has(novaUf)) {
        let query = supabase.from('clientes').update({ uf: novaUf }).eq('cnpj', registro.item.cnpj);
        // Compara com o valor lido: nao sobrescreve uma UF preenchida por outra requisicao.
        query = existente.uf == null ? query.is('uf', null) : query.eq('uf', existente.uf);
        const { data, error } = await query.select('uf');
        if (error) throw error;
        if (data?.length > 1) throw { code: 'CNPJ_DUPLICADO_NO_BANCO' };
        if (data?.length === 1) { resultado.ufs_preenchidas++; alterado = true; }
      }
    } catch (error) { falha(registro, error); falhou = true; }
    if (alterado) resultado.clientes_atualizados++;
    else if (!falhou) resultado.preservados++;
  };
  for (let offset = 0; offset < preparados.aceitos.length; offset += 200) {
    const lote = preparados.aceitos.slice(offset, offset + 200);
    let atuais;
    try { atuais = await consultar(lote.map(r => r.item.cnpj)); }
    catch (error) { lote.forEach(r => falha(r, error)); continue; }
    const porDocumento = new Map();
    for (const atual of atuais) {
      if (!porDocumento.has(atual.cnpj)) porDocumento.set(atual.cnpj, []);
      porDocumento.get(atual.cnpj).push(atual);
    }
    const novos = [];
    for (const registro of lote) {
      if (porDocumento.has(registro.item.cnpj)) {
        try { await atualizarExistente(registro, porDocumento.get(registro.item.cnpj)); }
        catch (error) { falha(registro, error); }
      } else novos.push(registro);
    }
    if (!novos.length) continue;
    let inserted;
    try { inserted = await supabase.from('clientes').insert(novos.map(r => r.item)); }
    catch (error) { novos.forEach(r => falha(r, error)); continue; }
    if (!inserted.error) { resultado.criados += novos.length; continue; }
    if (inserted.error.code !== '23505') { novos.forEach(r => falha(r, inserted.error)); continue; }
    // A concurrent seller registration or code conflict must never overwrite a customer.
    for (const registro of novos) {
      try {
        const existentes = await consultar([registro.item.cnpj]);
        if (existentes.length) { await atualizarExistente(registro, existentes); continue; }
        const { error } = await supabase.from('clientes').insert([registro.item]);
        if (error) falha(registro, error); else resultado.criados++;
      } catch (error) { falha(registro, error); }
    }
  }
  return { ok: true, parcial: resultado.erros > 0, ...resultado,
    inseridos: resultado.criados + resultado.clientes_atualizados };
}
