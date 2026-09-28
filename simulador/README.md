# Simulador LightSentinel para a feira

Aplicação independente que representa GPS → sensor de lux → microSD → envio completo. O botão **Descarregar** substitui a conexão Bluetooth. Não usa STM32, HC-05 nem C#.

## Iniciar no computador (Windows)

Use Node.js 18 ou superior e as dependências já instaladas do projeto.

Na pasta principal do PROJETE, mantenha dois terminais abertos:

**Terminal 1 — site e banco existentes**

```powershell
node app.js
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

Nesta atualização, `pages/mapa.html` recebe apenas a troca do azul para `#0000ff` (mapa e legenda). O mapa simulado usa o mesmo azul.

A única adição em `app.js` carrega `simulador/integracao.js` antes do 404. A única adição em `pages/usuario.html` é o novo cartão. `banco.js`, firmware, C#, mapa real, autenticação, ocorrências e rotas de medições reais permanecem sem alterações.

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
node --test tests/*.test.js
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
