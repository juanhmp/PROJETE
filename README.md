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

| Tecnologia | Utilização |
|---|---|
| Node.js | Execução do backend |
| Express | Servidor e rotas HTTP |
| SQLite | Banco de dados relacional |
| HTML | Estrutura das páginas |
| CSS | Interface visual |
| JavaScript | Interatividade e comunicação com a API |
| Leaflet | Mapa interativo |
| OpenStreetMap | Camada cartográfica |
| Leaflet.heat | Representação do mapa de calor |
| bcryptjs | Proteção das senhas administrativas |

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

# 🧪 Modo de teste

O sistema possui um modo de teste utilizado durante o desenvolvimento.

Quando habilitado pelo administrador, é possível simular a chegada do caminhão e enviar um lote de medições fictícias. Isso permite testar o banco de dados, processamento e mapa de calor mesmo quando o dispositivo físico não está conectado.

Os dados simulados são utilizados apenas para desenvolvimento e demonstração. As coordenadas geradas não representam necessariamente ruas reais.

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

# 📁 Organização do repositório

Como o projeto reúne hardware e software, a organização prevista para o repositório é:

```text
LightSentinel/
│
├── STM/
│   └── Firmware e arquivos do STM32
│
├── Site/
│   ├── app.js
│   ├── package.json
│   └── pages/
│
├── README.md
│
└── Documentacao/
    └── Arquivos complementares do projeto
```

A estrutura pode ser ajustada conforme o desenvolvimento do firmware e da documentação avançar.

---

# 🚀 Executando o sistema web

Entre na pasta do site e instale as dependências:

```powershell
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
