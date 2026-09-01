# Sistema de Iluminação Pública

Projeto em Node.js + Express + SQLite.

## Acessos

- `/` — escolha entre área pública do usuário e acesso administrativo.
- `/login-admin` — login dos administradores do sistema de iluminação.
- `/operador-login` — central exclusiva do operador. Este endereço não aparece na tela pública.

## Operador

O operador não é uma conta da tabela `usuarios`. O acesso é controlado por uma chave do próprio servidor, definida pela variável de ambiente `OPERATOR_SECRET`.

No PowerShell, antes de iniciar o servidor:

```powershell
$env:OPERATOR_SECRET="EscolhaUmaChaveForte123"
$env:SESSION_SECRET="EscolhaOutraChaveLongaESecreta123"
npm.cmd start
```

Se `OPERATOR_SECRET` não for definida, a versão de desenvolvimento usa `Operador@2026` e exibe um aviso no terminal. Não use essa chave padrão ao publicar o sistema.

Na Central do Operador é possível:

- criar contas de administradores;
- editar nome e nome de usuário;
- ativar ou desativar uma conta;
- redefinir uma senha esquecida usando uma nova senha temporária.

Toda conta criada pelo operador recebe `trocar_senha = 1`. No primeiro login, o administrador é obrigado a trocar a senha temporária. Depois da troca, o banco grava `trocar_senha = 0`, então essa exigência não aparece novamente. Se o operador redefinir a senha no futuro, o campo volta para `1` e a troca volta a ser obrigatória uma única vez.

## Recuperação de senha

A página “Esqueceu a senha?” informa o contato do responsável: `+55 35 99767-2906`. O operador redefine a senha pela Central do Operador e entrega uma senha temporária ao administrador.

## Executar

```powershell
npm.cmd install
npm.cmd start
```

Abra `http://localhost:3000`.

## Central do Operador - segurança

A Central do Operador fica em `/operador-login` e, por padrão, aceita acesso somente pela própria máquina que executa o servidor (`localhost`). A senha do operador não fica armazenada em texto puro no projeto: o servidor compara a senha informada com um hash protegido.

Proteções aplicadas à Central do Operador:
- limite de 5 tentativas de acesso a cada 15 minutos;
- sessão exclusiva do operador com duração de 30 minutos;
- cookie de sessão `HttpOnly` e `SameSite=Lax`;
- token CSRF nas operações de criação, edição, redefinição e desativação de administradores;
- bloqueio de acesso remoto por padrão;
- cabeçalhos de segurança com Helmet;
- a Central do Operador não aparece na página pública do sistema.

Se futuramente for realmente necessário acessar a Central do Operador por outro computador, é possível iniciar o servidor com `ALLOW_OPERATOR_REMOTE=true`, mas isso só deve ser feito em rede confiável e com HTTPS/proteções adicionais.
