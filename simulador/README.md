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

1. Toque no mapa para posicionar o caminhão ou arraste seu ícone. A área de demonstração usa os mesmos limites retangulares do mapa atual de Santa Rita (não é uma delimitação oficial do município).
2. Digite os **lux** ou use os controles rápidos. O campo aceita 0 a 88000 lux; o controle deslizante cobre 0 a 100.
3. Toque em **Registrar leitura**. Para leituras repetidas, toque em **Iniciar coleta a cada 1 segundo** e mova o caminhão pelo mapa. A posição fica estática até você movê-la; não há deslocamento automático nem GPS real.
4. A prévia e o contador mostram o que está no microSD virtual. A coleta automática pode repetir a mesma posição, como um veículo parado. O limite é 5000 leituras por lote.
5. Toque em **Descarregar**. A coleta para e todas as leituras são enviadas juntas.
6. Somente após o servidor confirmar o lote inteiro, o microSD virtual é esvaziado. O mapa simulado do site atualiza em até 3 segundos e mostra somente o último lote.
7. Inicie outra coleta quando quiser. Ela não recomeça automaticamente após o envio.

Se a rede ou o servidor falhar, as leituras e a identificação do lote permanecem salvas. Use **Descarregar novamente**; a API reconhece o mesmo lote sem duplicá-lo. A coleta fica pausada até resolver o envio. Reenviar um lote antigo já confirmado não substitui o mapa de um lote mais recente.

## Onde ficam os dados

- **Antes de descarregar:** `localStorage` do navegador do tablet, chave `lightsentinel.microsd.v1`. Fechar/reabrir ou recarregar preserva as leituras. Mantenha o mesmo navegador e endereço IP/porta; limpar os dados do navegador apaga o microSD virtual. Não use modo privado na apresentação.
- **Depois de descarregar:** tabela exclusiva `simulacao_lotes` no `dados.db` existente. Cada linha guarda um lote completo em JSON, seu hash e a data de recebimento. Uma única escrita SQL torna o recebimento atômico.
- Os lotes antigos ficam guardados para reconhecer reenvios. O mapa usa o último lote novo e agrupa as leituras em células de aproximadamente 200 metros, como o mapa atual.
- Lux originais são preservados. A escala colorida entre 0 e 100 lux é ilustrativa, limitada apenas para desenhar o calor; não representa uma classificação normativa. Sobreposição de áreas influencia a cor. Toque na área no mapa publicado para consultar o valor médio exato.

## Integração preservada

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
node --test tests/simulador.test.js
```

Os testes usam um banco temporário e verificam validação, recebimento integral, idempotência, concorrência, persistência e isolamento das medições reais.
