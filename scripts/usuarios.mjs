#!/usr/bin/env node
// Contingência por linha de comando — a operação normal é pela tela de administração.
//   npm run usuarios -- listar
//   npm run usuarios -- criar-admin <login> "<Nome>"
//       com GERMANI_SENHA_INICIAL no ambiente (workflow "Criar administrador"), usa essa senha e não a mostra
//   npm run usuarios -- criar-financeiro <login> "<Nome>"   analista do console de crédito
//   npm run usuarios -- senha <login>                       gera senha provisória
//   npm run usuarios -- tipo <login> representante|vendedor
//   npm run usuarios -- desativar <login> | ativar <login>
import { abrir } from '../lib/db.mjs';
import { executor } from '../lib/cli.mjs';
import { criarUsuarioSistema, definirAtivo, definirTipoAtuacao, listarUsuarios, redefinirSenha } from '../shared/usuarios.mjs';

const [comando, login, nome] = process.argv.slice(2);
const db = await abrir();
const quem = executor();

async function idDe(l) {
  const r = await db.execute({ sql: 'SELECT id FROM usuarios WHERE login = ?', args: [l] });
  if (!r.rows.length) throw new Error(`usuário não encontrado: ${l}`);
  return Number(r.rows[0].id);
}

switch (comando) {
  case 'listar':
    console.table((await listarUsuarios(db)).map((u) => ({ login: u.login, perfil: u.perfil, tipo: u.tipo_atuacao, nome: u.nome, supervisor: u.supervisor_nome, ativo: u.ativo, senha: u.situacao_senha })));
    break;
  case 'criar-admin':
  case 'criar-financeiro': {
    // Secret colado com espaço ou quebra de linha no fim: considera só o texto
    const senhaInicial = process.env.GERMANI_SENHA_INICIAL?.trim() || null;
    // workflow rodado de novo para o mesmo login: redefine a senha em vez de falhar
    const existe = senhaInicial && (await db.execute({ sql: 'SELECT id FROM usuarios WHERE login = ?', args: [String(login ?? '').trim()] })).rows[0];
    if (existe) {
      await redefinirSenha(db, { usuarioId: Number(existe.id), executadoPor: quem, senha: senhaInicial });
      await definirAtivo(db, { usuarioId: Number(existe.id), ativo: true, executadoPor: quem });
      console.log(`Usuário ${login} já existia: senha redefinida com a do Secret ADMIN_SENHA_INICIAL e acesso ativo.`);
      break;
    }
    const r = await criarUsuarioSistema(db, { perfil: comando === 'criar-admin' ? 'administrador' : 'financeiro', login, nome, executadoPor: quem, senha: senhaInicial });
    // senha vinda do ambiente nunca é impressa (o log do Actions de repositório público é público)
    console.log(senhaInicial ? `Usuário criado. Login: ${r.login}  Senha: a do Secret ADMIN_SENHA_INICIAL`
      : `Usuário criado. Login: ${r.login}  Senha provisória: ${r.senha}`);
    break;
  }
  case 'senha': {
    const r = await redefinirSenha(db, { usuarioId: await idDe(login), executadoPor: quem });
    console.log(`Login: ${r.login}  senha provisória: ${r.senha}`);
    break;
  }
  case 'tipo':
    await definirTipoAtuacao(db, { usuarioId: await idDe(login), tipo: nome, executadoPor: quem });
    console.log(`${login}: ${nome}`);
    break;
  case 'desativar':
  case 'ativar':
    await definirAtivo(db, { usuarioId: await idDe(login), ativo: comando === 'ativar', executadoPor: quem });
    console.log(`${login}: ${comando === 'ativar' ? 'ativado' : 'desativado'}`);
    break;
  default:
    console.error('comandos: listar | criar-admin <login> "<Nome>" | criar-financeiro <login> "<Nome>" | senha <login> | tipo <login> representante|vendedor | desativar <login> | ativar <login>');
    process.exitCode = 1;
}
db.close();
