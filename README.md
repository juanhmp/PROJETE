# 💡 LightSentinel

> **Sistema inteligente de monitoramento da iluminação pública**  
> Projeto desenvolvido para a **PROJETE**, integrando hardware embarcado, coleta georreferenciada de luminosidade, armazenamento de dados e uma plataforma web para visualização e gerenciamento.

---

## 📌 Sobre o projeto

O **LightSentinel** foi desenvolvido com o objetivo de auxiliar no monitoramento da iluminação pública por meio da coleta automática de dados de luminosidade em diferentes pontos da cidade.

O projeto une **hardware e software em um único sistema**. Um dispositivo instalado em um caminhão realiza medições durante o percurso, associa cada leitura à sua localização geográfica e armazena os dados localmente. Quando o veículo retorna à base, as informações acumuladas são transferidas para o sistema, armazenadas em banco de dados e utilizadas para gerar um **mapa de calor da iluminação pública**.

Além da coleta automática, o LightSentinel permite que usuários consultem o mapa e registrem ocorrências relacionadas à iluminação. Administradores possuem uma área própria para acompanhar os dados e as ocorrências, enquanto o gerenciamento das contas administrativas fica separado em uma Central do Operador.

---

## 🎯 Objetivo

O LightSentinel busca tornar a identificação de regiões com possíveis problemas de iluminação mais organizada e baseada em dados. Em vez de depender exclusivamente de reclamações ou inspeções manuais, o sistema permite registrar medições reais ao longo dos trajetos realizados pelo veículo.

Com isso, o projeto procura facilitar:

- identificação de áreas com menor nível de iluminação;
- visualização geográfica das medições;
- acompanhamento de ocorrências registradas pela população;
- armazenamento de um histórico de dados;
- centralização das informações em uma plataforma web;
- apoio à análise e manutenção da iluminação pública.

---

## ⚙️ Visão geral do funcionamento

O sistema é dividido em duas partes principais: **dispositivo embarcado** e **plataforma web**.

```text
┌──────────────────────────────┐
│       CAMINHÃO / CAMPO       │
│                              │
│  TSL2591 + GPS NEO-6M        │
│            ↓                 │
│          STM32               │
│            ↓                 │
│          MicroSD             │
└──────────────┬───────────────┘
               │
        retorno à base
               │ Bluetooth
               ↓
┌──────────────────────────────┐
│            BASE              │
│                              │
│     Node.js / Express        │
│            ↓                 │
│          SQLite              │
│            ↓                 │
│  processamento/agregação     │
│            ↓                 │
│       Mapa de calor          │
└──────────────────────────────┘
```

Durante o percurso, não é necessário manter conexão permanente com o servidor. As leituras ficam armazenadas no cartão de memória e são transmitidas posteriormente em lote.

---

# 🔧 Hardware

## Componentes principais

### 🧠 STM32

O **STM32** é o microcontrolador principal do dispositivo. Ele coordena a aquisição das informações dos sensores, organiza as medições e controla o armazenamento e a comunicação com os demais módulos.

### ☀️ TSL2591

O **TSL2591** é utilizado para medir a intensidade luminosa do ambiente. Suas leituras representam a informação principal utilizada posteriormente para construir o mapa de iluminação.

### 📍 GPS NEO-6M

O **GPS NEO-6M** fornece as coordenadas geográficas do dispositivo. Dessa maneira, cada leitura de luminosidade pode ser associada a uma latitude e longitude.

### 💾 MicroSD

O cartão **MicroSD** é responsável pelo armazenamento local das medições. Isso permite que o caminhão percorra a cidade e continue coletando informações mesmo sem comunicação direta com a base.

### 📡 Bluetooth

A comunicação **Bluetooth** é utilizada quando o caminhão retorna e se aproxima da base. Nesse momento, as medições acumuladas durante o percurso são enviadas para o sistema em um único lote.

---

## 🔄 Coleta dos dados

Cada registro coletado pelo dispositivo possui, conceitualmente, informações como:

```text
Luminosidade
Latitude
Longitude
Horário da medição
```

O processo ocorre da seguinte maneira:

```text
Sensor mede a luminosidade
          ↓
GPS fornece a localização
          ↓
STM32 reúne as informações
          ↓
Dados são gravados no MicroSD
          ↓
Caminhão continua o percurso
          ↓
Novas medições são acumuladas
```

Quando o caminhão retorna à base:

```text
MicroSD → STM32 → Bluetooth → Base → Backend → SQLite
```

---

# 🌐 Plataforma Web

A plataforma web recebe, armazena, processa e apresenta os dados coletados pelo hardware.

O backend utiliza **Node.js com Express**, enquanto os dados persistentes são armazenados em um banco **SQLite**. As páginas do sistema são construídas em HTML, CSS e JavaScript.

### Principais tecnologias

| Tecnologia    | Utilização                             |
| ------------- | -------------------------------------- |
| Node.js       | Execução do backend                    |
| Express       | Servidor e rotas HTTP                  |
| SQLite        | Banco de dados relacional              |
| HTML          | Estrutura das páginas                  |
| CSS           | Interface visual                       |
| JavaScript    | Interatividade e comunicação com a API |
| Leaflet       | Mapa interativo                        |
| OpenStreetMap | Camada cartográfica                    |
| Leaflet.heat  | Representação do mapa de calor         |
| bcryptjs      | Proteção das senhas administrativas    |

---

# 🗺️ Mapa de calor

O mapa de calor é uma das principais funcionalidades do **LightSentinel**.

As medições recebidas do dispositivo são armazenadas individualmente no banco, mas não são apresentadas como uma longa lista de pontos para o usuário. O backend agrupa medições próximas e calcula valores representativos para pequenas regiões.

Isso permite visualizar de maneira mais clara quais áreas apresentam níveis diferentes de iluminação.

A representação utiliza uma escala visual que vai de regiões mais iluminadas até regiões que exigem maior atenção.

> **Importante:** as ocorrências registradas pelos usuários não alteram o mapa de calor. O mapa é construído exclusivamente a partir das medições realizadas pelo dispositivo.

---

# 👤 Área do Usuário

O acesso do usuário é simples e não exige criação de conta.

A partir dessa área é possível:

- 📝 registrar uma ocorrência de iluminação pública;
- 🗺️ consultar o mapa de calor;
- 💡 visualizar as condições de iluminação representadas pelo sistema.

As ocorrências servem como uma fonte complementar de informação e permanecem separadas das medições realizadas pelo hardware.

---

# 🛡️ Área Administrativa

O acesso administrativo exige autenticação.

O administrador pode acompanhar informações relacionadas à operação do LightSentinel, incluindo:

- mapa de calor;
- ocorrências registradas;
- quantidade de medições armazenadas;
- situação das ocorrências;
- recursos de teste do sistema.

As senhas são armazenadas utilizando **hash com bcrypt**, evitando o armazenamento direto da senha original no banco de dados.

---

# 🔐 Primeiro acesso do administrador

As contas administrativas são criadas pelo operador com uma **senha temporária**.

```text
Operador cria a conta
        ↓
Administrador recebe senha temporária
        ↓
Primeiro login
        ↓
Sistema exige uma nova senha
        ↓
Nova senha é protegida com bcrypt
        ↓
Próximos acessos ocorrem normalmente
```

A troca obrigatória acontece somente no primeiro acesso ou após uma redefinição de senha realizada pelo operador.

---

# 🖥️ Central do Operador

O LightSentinel possui uma área separada para gerenciamento técnico dos acessos administrativos.

A Central do Operador permite:

- criar contas administrativas;
- editar informações das contas;
- ativar ou desativar administradores;
- redefinir senhas temporárias;
- administrar os acessos sem misturar essas funções ao painel operacional.

Por segurança, a Central do Operador não aparece como uma opção comum na página inicial e possui autenticação própria.

> Credenciais, chaves privadas e segredos do operador **não devem ser publicados no GitHub**.

---

# 📋 Ocorrências

Usuários podem registrar problemas relacionados à iluminação pública informando dados sobre o local e a situação encontrada.

As ocorrências podem ser acompanhadas pelo painel administrativo e possuem estados de atendimento, como:

```text
Pendente → Em andamento → Resolvida
```

Esse módulo é independente da coleta automática realizada pelo caminhão.

---

# 🔄 Renovação automática das medições

O sistema recebe somente as medições reais enviadas pela base. Enquanto os
dados chegam continuamente, eles permanecem na mesma coleta. Depois de cinco
minutos sem receber informações, a próxima medição inicia uma nova coleta e
substitui automaticamente as medições anteriores.

---

# 🗄️ Banco de dados

O LightSentinel utiliza **SQLite**, um sistema gerenciador de banco de dados relacional baseado em SQL.

Entre as informações armazenadas estão:

- contas administrativas;
- ocorrências;
- medições de luminosidade;
- coordenadas geográficas;
- lotes recebidos;
- configurações do sistema.

O arquivo do banco é criado localmente pelo backend durante a execução.

---

# 🔐 Configuração das chaves no Windows

As chaves de sessão e da Central do Operador não ficam salvas no código nem
são enviadas ao GitHub. Antes de iniciar o servidor pela primeira vez, abra o
PowerShell e execute:

```powershell
setx SESSION_SECRET "COLOQUE_AQUI_UMA_CHAVE_GRANDE_E_ALEATORIA"
setx OPERATOR_SECRET "COLOQUE_AQUI_A_SENHA_DESEJADA_PARA_O_OPERADOR"
```

Use valores escolhidos por você e não publique esses valores. Depois, feche o
PowerShell e abra-o novamente para que o Windows carregue as variáveis. A
partir desse momento, `npm start` lê as chaves diretamente das variáveis de
ambiente da conta do Windows.

Para gerar uma chave de sessão aleatória no PowerShell, use:

```powershell
$chave = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
setx SESSION_SECRET $chave
```

Somente quando o banco estiver vazio e ainda não existir uma conta
administrativa, configure também a senha temporária do primeiro administrador:

```powershell
setx INITIAL_ADMIN_PASSWORD "COLOQUE_AQUI_UMA_SENHA_TEMPORARIA"
```

Essa conta será obrigada a trocar a senha no primeiro acesso.

---

# 📁 Organização do repositório

Cada parte do LightSentinel tem sua própria pasta. O README concentra toda a documentação.

| Pasta        | O que você encontra                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| `STM/`       | Firmware do hardware. Abra esta pasta diretamente no STM32CubeIDE; o código principal fica em `Core/Src/main.c`. |
| `Bluetooth/` | Programa C# do computador que recebe as leituras por Bluetooth e envia ao site.                                  |
| `site/`      | Servidor da porta 3000, banco de dados, páginas e dependências do site.                                          |
| `simulador/` | Aplicação independente da porta 3001, caminhão, rotas e iluminação simulada.                                     |

**Dentro de `site`:** `app.js` inicia o servidor; `banco.js` acessa o banco; `pages/` contém as telas; `integracao-simulador.js` recebe as leituras da feira. A pasta `testes/` contém verificações automáticas para detectar problemas no armazenamento, mapa e rotas — não é necessário abrir esses arquivos para usar o sistema.

**Por que existem dois JSON em `site`?** `package.json` lista as bibliotecas necessárias e os comandos de execução. `package-lock.json` registra as versões exatas para que a instalação seja reproduzível em outros computadores. Ambos são usados pelo npm e devem permanecer no Git.

**Dentro de `simulador`:** `server.js` inicia a aplicação e `rotas.js` consulta as ruas. A pasta `public/` reúne a interface (`index.html`, `style.css`, `app.js`), iluminação (`iluminacao.js`), navegação (`navegacao.js`, `percurso.js`) e mapa (`areas.js`). `vendor/` contém bibliotecas externas e suas licenças.

**Projeto STM:** a pasta intermediária `teste_projete` foi removida. O nome interno do projeto e o arquivo `teste_projete.ioc` foram preservados para manter a configuração do STM32CubeIDE. Importe o projeto existente a partir de `STM/`; não use os caminhos antigos do workspace.

O banco local continua em `dados.db`, na raiz, para preservar os dados de instalações anteriores. Ele não aparece no GitHub. Os arquivos de configuração com ponto no nome na raiz orientam o Git e a formatação do código.

### Padrão de formatação

Os arquivos JavaScript, HTML, CSS e a documentação usam Prettier. O arquivo `.editorconfig` define o padrão básico para os editores.

```powershell
cd site
npm.cmd install
npm.cmd run format
npm.cmd run format:check
```

Dentro de `site`, para iniciar o simulador e rodar os testes:

```powershell
npm.cmd run simulador
npm.cmd test
```

`node_modules`, `Bluetooth/bin`, `Bluetooth/obj` e os diretórios `Debug`/`Release` do STM32 são gerados localmente e ficam fora do versionamento. Após atualizar uma instalação antiga, execute `npm.cmd --prefix site install` na raiz para restaurar as dependências do site. No C#, restaure os pacotes e compile pelo Visual Studio; no STM32CubeIDE, use Build Project para recriar os arquivos de compilação.

---

# 🚀 Executando o sistema web

Na raiz do repositório, entre na pasta do site e instale as dependências:

```powershell
cd site
npm.cmd install
```

Depois execute:

```powershell
npm.cmd start
```

O endereço local padrão é:

```text
http://localhost:3000
```

---

# 🚚 Simulador para a feira

Aplicação independente que representa GPS → sensor de lux → microSD → envio completo. O botão **Descarregar** substitui a conexão Bluetooth. Não usa STM32, HC-05 nem C#.

## Iniciar no computador (Windows)

Use Node.js 18 ou superior e as dependências já instaladas do projeto.

Na pasta principal do PROJETE, execute `npm.cmd --prefix site install` uma vez e mantenha dois terminais abertos:

**Terminal 1 — site e banco existentes**

```powershell
node site/app.js
```

**Terminal 2 — aplicação do simulador**

```powershell
node simulador/server.js
```

O simulador não exige instalação de dependências próprias. Você também pode copiar a pasta `simulador` para outro lugar e executar `node server.js`; o site atualizado precisa continuar ativo para receber os lotes.

## Acessar pelo tablet

1. Conecte computador e tablet à mesma rede Wi-Fi.
2. O terminal do simulador imprime os endereços IPv4 disponíveis. Use o endereço do adaptador Wi-Fi (consulte `ipconfig` se aparecer mais de um).
3. Exemplo: computador `192.168.1.20` → abra **http://192.168.1.20:3001** no tablet.
4. No site principal, abra **http://192.168.1.20:3000/usuario** → **Mapa de Calor Simulado**. O endereço direto é `/mapa-simulado`.
5. Permita o Node.js no Firewall do Windows para a rede privada, nas portas 3000 e 3001. Redes de convidados com isolamento entre aparelhos precisam ser substituídas por uma rede que permita essa comunicação.

`localhost` no tablet aponta para o próprio tablet: use o IP do computador. A aplicação envia os dados ao servidor através de sua própria porta; não precisa configurar Bluetooth, CORS ou o IP dentro do JavaScript.

As bibliotecas do mapa acompanham a aplicação. **O mapa de ruas do OpenStreetMap exige internet** na rede da feira; apenas estar conectado ao Wi-Fi local não garante o carregamento das ruas.

## Demonstrar o hardware

1. Em **Definir iluminação**, toque na rua desejada. O ponto é associado à rua mais próxima.
2. Escolha os lux e clique em **Salvar iluminação**. Repita para outros pontos. Isso configura o cenário, sem criar leituras ou enviar dados ao site.
3. Para editar um ponto existente, toque no marcador. É possível alterar os lux e salvar, ou remover o ponto selecionado.
4. Clique em **Dirigir caminhão** e toque em uma ou mais ruas ou marcadores de iluminação para adicionar paradas. Confira a ordem na lista e clique em **Iniciar rota**. O caminhão percorre todas as paradas pelas ruas.
5. Ao passar a até **20 metros** de um ponto, registra automaticamente seus lux, o GPS atual do caminhão e as coordenadas exatas do ponto de referência no microSD virtual. Se dois pontos estiverem próximos, usa o mais próximo. Registra uma vez por passagem; voltar ao ponto depois de sair da área permite outra leitura. Onde não houver ponto configurado, não inventa uma medição.
6. Os botões de registro manual e coleta a cada segundo continuam disponíveis para leituras adicionais, quando o caminhão estiver próximo de um ponto configurado. O limite é 5000 leituras por lote.
7. **Descarregar** pausa o caminhão e a coleta, envia o lote inteiro e só limpa o microSD após a confirmação. Os pontos de iluminação permanecem configurados para repetir a demonstração.
8. O mapa simulado da porta 3000 mostra o último lote recebido, com atualização a cada 3 segundos. O cenário configurado permanece apenas no simulador.

Se o envio falhar, as leituras permanecem guardadas. Use **Descarregar novamente**; o mesmo lote não será duplicado. A coleta fica pausada até concluir o envio.

## Onde ficam os dados

- **Pontos de iluminação:** `localStorage`, chave `lightsentinel.iluminacao.v1`, até 500 pontos por navegador. Persistem após recarregar e descarregar; limpar o armazenamento do navegador os remove.
- **Antes de descarregar:** `localStorage` do navegador do tablet, chave `lightsentinel.microsd.v1`. Fechar/reabrir ou recarregar preserva as leituras. Mantenha o mesmo navegador e endereço IP/porta; limpar os dados do navegador apaga o microSD virtual. Não use modo privado na apresentação.
- **Depois de descarregar:** tabela exclusiva `simulacao_lotes` no `dados.db` existente. Cada linha guarda um lote completo em JSON, seu hash e a data de recebimento. Uma única escrita SQL torna o recebimento atômico.
- Os lotes antigos ficam guardados para reconhecer reenvios. O mapa usa o último lote novo e mantém as coordenadas exatas de cada ponto de referência. Somente leituras do mesmo ponto são agrupadas; o GPS do caminhão fica preservado separadamente em `lat`/`lng`.
- Lux originais são preservados. A escala colorida entre 0 e 100 lux é ilustrativa, limitada apenas para desenhar o calor; não representa uma classificação normativa. Sobreposição de áreas influencia a cor. Toque na área no mapa publicado para consultar o valor médio exato.

## Integração preservada

Nesta atualização, `site/pages/mapa.html` recebe apenas a troca do azul para `#0000ff` (mapa e legenda). O mapa simulado usa o mesmo azul.

A única adição em `site/app.js` carrega `site/integracao-simulador.js` antes do 404. A única adição em `site/pages/usuario.html` é o novo cartão. `banco.js`, firmware, C#, mapa real, autenticação, ocorrências e rotas de medições reais permanecem sem alterações.

Rotas novas:

- `POST /api/simulacao/descarregar`: `{ loteId, medicoes: [{ lat, lng, lux, timestamp }] }`
- `GET /api/simulacao/mapa`: último lote agregado.
- `GET /mapa-simulado`: visualização pública, como o mapa real.
- `/simulacao-assets/*`: arquivos da interface.

A API de simulação é aberta para a demonstração na rede local, como o recebimento de medições existente. Todos os dispositivos compartilham o mapa do último lote descarregado; cada navegador tem seu próprio microSD virtual.

Configuração opcional do simulador (PowerShell):

```powershell
$env:SIMULADOR_PORT = "3001"
$env:LIGHTSENTINEL_URL = "http://127.0.0.1:3000"
node simulador/server.js
```

Para servidor principal em outra máquina, use seu IP em `LIGHTSENTINEL_URL`. O atalho visual “Ver mapa publicado” pressupõe que os dois servidores estejam no mesmo computador; em máquinas separadas, abra o endereço do site diretamente.

## Testes

```powershell
npm.cmd --prefix site test
```

Os testes usam um banco temporário e verificam validação, recebimento integral, idempotência, concorrência, persistência e isolamento das medições reais.

## Navegação pelas ruas

- O caminhão é associado a uma rua ao abrir o simulador. A coleta só é liberada após confirmar essa posição.
- Cada toque em uma rua adiciona uma parada à lista. Ao clicar em Iniciar rota, o caminhão percorre todas as paradas na ordem escolhida, fazendo as curvas pelas ruas. Cliques longe de vias e rotas fora dos limites da demonstração são rejeitados.
- **Pausar trajeto / Continuar trajeto** controla o deslocamento. **Seguir caminhão** acompanha o veículo; arrastar o mapa libera a câmera.
- Ritmos **1×, 3× e 6×** aceleram o tempo de viagem, com base em 30 km/h. O ritmo inicial é 3×.
- Trocar de aba pausa o movimento e a coleta. Descarregar também pausa ambos. O trajeto não é recuperado após recarregar, mas a posição e as leituras permanecem guardadas.
- O serviço público OSRM calcula rotas usando ruas do OpenStreetMap. Requer internet e está sujeito a indisponibilidade. Se falhar, o caminhão fica parado e as leituras são preservadas; não há substituição por um trajeto em linha reta.
- As ruas e sentidos dependem da cartografia disponível. É uma demonstração de carro, sem considerar restrições específicas de caminhões.
- Para uma instância OSRM própria, configure `OSRM_URL` no computador do simulador. A configuração padrão é `https://router.project-osrm.org`.
- Referência da API: https://project-osrm.org/docs/v5.24.0/api/

## Posição das manchas de calor

A prévia e o mapa simulado publicado usam `referencia.lat` e `referencia.lng`, sem arredondamento para uma grade. A referência só entra no mapa depois que o caminhão a coleta; configurar pontos não publica leituras. O halo do calor se estende ao redor dessa posição. Pontos próximos podem ter halos sobrepostos.

Lotes antigos sem `referencia` mantêm o GPS original, agora sem arredondamento. Para alinhar também esses dados aos pontos configurados, faça um novo percurso e descarregue um novo lote. As leituras antigas e os envios pendentes não são reescritos, preservando a identificação e o reenvio de lotes.

## Rotas com uma ou várias paradas

Em **Dirigir caminhão**, clique nos pontos por onde deseja passar. Cada clique acrescenta uma parada numerada ao mapa e à lista **Monte sua rota**, com limite de 20. Para visitar apenas um ponto, adicione somente uma parada.

- **↑ / ↓** alteram a ordem das paradas.
- **×** remove uma parada.
- **Limpar rota** apaga o planejamento e interrompe o trajeto atual, preservando os pontos de iluminação e as leituras já coletadas.
- **Iniciar rota** calcula o caminho pelas ruas na ordem exata da lista e inicia o movimento. Não há reorganização automática das paradas.
- **Pausar trajeto / Continuar trajeto** mantém o percurso em andamento.

Adicionar, remover ou reordenar paradas interrompe o trajeto anterior; clique em Iniciar rota para recalcular a partir da posição atual. O caminhão passa pelos pontos sem aguardar manualmente em cada um e coleta os lux das referências próximas. A lista é temporária e precisa ser refeita se recarregar a página. Não cria leituras antes de o caminhão passar pelos pontos.

---

# 🔒 Segurança

O projeto utiliza diferentes medidas para proteger as áreas restritas, incluindo:

- senhas administrativas protegidas por hash;
- sessões autenticadas no servidor;
- limitação de tentativas de login;
- separação entre usuário, administrador e operador;
- troca obrigatória de senha temporária no primeiro acesso;
- proteção adicional da Central do Operador;
- consultas SQL parametrizadas;
- separação entre credenciais e funcionalidades públicas.

Arquivos contendo credenciais, banco local, variáveis de ambiente ou outros segredos não devem ser enviados para repositórios públicos.

---

# 🔮 Possíveis evoluções

O projeto pode futuramente receber recursos como:

- histórico de diferentes percursos do caminhão;
- comparação da iluminação entre períodos;
- filtros por região ou data;
- relatórios de áreas críticas;
- identificação automática de mudanças significativas de luminosidade;
- integração com outros sistemas de manutenção urbana.

---

# 👥 Equipe do projeto

O **LightSentinel** é desenvolvido pelo **Grupo 3403** para a **PROJETE**, sob orientação do professor **José Andery**.

### Integrantes

- **Juan Henrique de Mendonça Pereira**
- **Arthur Yuzo Sáber Shida**
- **Mariana Ferreira da Silva**
- **Pedro Brasil Carli Azevedo**

### Orientador

- **José Andery**

---

# 🏫 PROJETE

O **LightSentinel** é um projeto desenvolvido para a **PROJETE**, integrando conhecimentos de sistemas embarcados, desenvolvimento web, banco de dados, comunicação entre dispositivos e análise de informações georreferenciadas.

O projeto demonstra a integração entre o mundo físico e o digital: os dados são coletados em campo pelo hardware, transportados para a base, processados pelo software e transformados em informações visuais para auxiliar no acompanhamento da iluminação pública.

---

## 💡 LightSentinel — PROJETE

**Monitoramento inteligente da iluminação pública através da integração entre hardware, dados e software.**
