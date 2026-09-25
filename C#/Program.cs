using System;
using System.Globalization;
using System.IO;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

using InTheHand.Net;
using InTheHand.Net.Bluetooth;
using InTheHand.Net.Sockets;

using System.Net.Sockets;


class Program
{
    const string URL_SERVIDOR = "http://localhost:3000";


    /*
     * Endereco MAC do HC-05.
     */
    static readonly BluetoothAddress ENDERECO_HC05 =
        BluetoothAddress.Parse("002113003A1E");


    /*
     * Assinatura binaria LightSentinel.
     */
    static readonly byte[] ASSINATURA =
    {
        0xAA,
        0x55,
        0x01,
        0xFF
    };


    /*
     * Comando para iniciar a transferencia
     * do arquivo que JA estava armazenado
     * no microSD.
     */
    static readonly byte[] COMANDO_DESCARREGAR =
        Encoding.ASCII.GetBytes(
            "CMD_DESCARREGAR\n"
        );


    /*
     * STM32 envia isso depois que terminou
     * de enviar TODO o dados.txt.
     */
    const string MARCADOR_FIM =
        "END_OF_DATA";


    /*
     * Confirmacao enviada ao STM32.
     */
    static readonly byte[] ACK_RECEBIDO =
        Encoding.ASCII.GetBytes(
            "ACK_SUCCESS\n"
        );


    static readonly HttpClient cliente =
        new HttpClient
        {
            Timeout =
                TimeSpan.FromSeconds(10)
        };


    static double ultimaLatitude = 0;

    static double ultimaLongitude = 0;

    static string? ultimoTimestamp = null;

    static bool gpsValido = false;

    static int medicoesRecebidasNoLote = 0;


    public class Medicao
    {
        public double luminosidade
        {
            get;
            set;
        }


        public double lat
        {
            get;
            set;
        }


        public double lng
        {
            get;
            set;
        }


        public string? timestamp
        {
            get;
            set;
        }
    }


    static async Task Main()
    {
        Console.Title =
            "LightSentinel - Base";

        Console.WriteLine(
            "========================================"
        );

        Console.WriteLine(
            "          LIGHTSENTINEL - BASE"
        );

        Console.WriteLine(
            "========================================"
        );

        Console.WriteLine();

        Guid servicoSpp =
            BluetoothService.SerialPort;

        BluetoothEndPoint endPoint =
            new BluetoothEndPoint(
                ENDERECO_HC05,
                servicoSpp
            );

        /*
         * ================================================================
         * CICLO INFINITO DA CENTRAL
         * ================================================================
         *
         * O C# permanece aberto durante todo o funcionamento da central.
         *
         * ESTADO 1 - SEM BLUETOOTH:
         *   Fica tentando conectar ao HC-05.
         *
         * ESTADO 2 - BLUETOOTH CONECTADO:
         *   Executa o protocolo normal:
         *   assinatura -> CMD_DESCARREGAR -> recebe lote -> ACK.
         *
         * ESTADO 3 - LOTE TERMINOU:
         *   NAO desconecta e NAO inicia outro lote.
         *   O C# fica parado mantendo a conexao.
         *   O STM32 continua parado porque esta conectado a central.
         *
         * ESTADO 4 - BLUETOOTH DESCONECTOU:
         *   A desconexao e detectada pelo socket.
         *   A conexao antiga e liberada.
         *   O programa volta para o ESTADO 1.
         *
         * Quando o caminhão voltar para a central e o HC-05 conectar
         * novamente, todo o protocolo e executado novamente.
         *
         * Portanto o processo fica:
         *
         *   conecta -> descarrega -> espera -> desconecta ->
         *   procura -> conecta -> descarrega -> espera -> ...
         *
         * infinitamente, sem CTRL+C e sem "dotnet run" novamente.
         */

        while (true)
        {
            BluetoothClient? btClient = null;

            try
            {
                Console.WriteLine(
                    "Procurando LightSentinel via Bluetooth..."
                );

                btClient =
                    new BluetoothClient();

                /*
                 * Tenta conectar ao HC-05.
                 *
                 * Se ele estiver desconectado, Connect pode gerar
                 * uma excecao. Isso NAO encerra o programa: o catch
                 * trata a tentativa e o while tenta novamente.
                 */
                btClient.Connect(
                    endPoint
                );

                Stream stream =
                    btClient.GetStream();

                Console.WriteLine();

                Console.WriteLine(
                    $"LightSentinel conectado no endereco {ENDERECO_HC05}"
                );

                /*
                 * Cada conexao representa uma nova chegada do caminhão
                 * na central. Portanto, inicia um novo estado de lote.
                 */
                ultimaLatitude = 0;
                ultimaLongitude = 0;
                ultimoTimestamp = null;
                gpsValido = false;
                medicoesRecebidasNoLote = 0;

                /*
                 * ========================================================
                 * HANDSHAKE
                 * ========================================================
                 */

                Console.WriteLine(
                    "Enviando assinatura de verificacao..."
                );

                stream.Write(
                    ASSINATURA,
                    0,
                    ASSINATURA.Length
                );

                stream.Flush();

                /*
                 * Aguarda a confirmacao do STM32.
                 */
                if (
                    !EsperarAssinatura(
                        stream,
                        3000
                    )
                )
                {
                    Console.WriteLine(
                        "Assinatura do LightSentinel nao foi confirmada."
                    );

                    /*
                     * Esta tentativa de conexao nao foi concluida.
                     * O finally libera o cliente e o while tenta novamente.
                     */
                    continue;
                }

                Console.WriteLine(
                    "LightSentinel verificado com sucesso!"
                );

                /*
                 * ========================================================
                 * SOLICITA O LOTE
                 * ========================================================
                 */

                Console.WriteLine(
                    "Solicitando dados armazenados no microSD..."
                );

                stream.Write(
                    COMANDO_DESCARREGAR,
                    0,
                    COMANDO_DESCARREGAR.Length
                );

                stream.Flush();

                Console.WriteLine();

                Console.WriteLine(
                    "Recebendo dados que ja estavam armazenados..."
                );

                Console.WriteLine();

                /*
                 * Recebe SOMENTE o lote que estava armazenado.
                 *
                 * Quando encontrar END_OF_DATA, ReceberDados retorna
                 * true. Isso NAO significa que a conexao terminou.
                 * Significa apenas que o lote terminou.
                 */
                bool loteCompleto =
                    await ReceberDados(
                        stream,
                        btClient
                    );

                /*
                 * Se o lote nao terminou normalmente, a conexao
                 * provavelmente caiu durante a transferencia.
                 *
                 * O while externo vai liberar o cliente e tentar
                 * uma nova conexao.
                 */
                if (
                    !loteCompleto
                )
                {
                    Console.WriteLine();

                    Console.WriteLine(
                        "Conexao perdida durante a transferencia."
                    );

                    continue;
                }

                /*
                 * ========================================================
                 * LOTE TERMINADO, MAS CONEXAO CONTINUA
                 * ========================================================
                 *
                 * Este e o ponto mais importante:
                 *
                 * END_OF_DATA NAO encerra a conexao.
                 *
                 * O STM32 esta parado porque o caminhão esta na central.
                 * O C# permanece conectado e espera EXCLUSIVAMENTE a
                 * desconexao do Bluetooth.
                 */

                Console.WriteLine();

                Console.WriteLine(
                    "Arquivo armazenado recebido completamente."
                );

                await EnviarAck(
                    stream
                );

                Console.WriteLine(
                    "ACK enviado ao STM32."
                );

                Console.WriteLine();

                Console.WriteLine(
                    "Lote finalizado."
                );

                Console.WriteLine(
                    "Bluetooth continua conectado."
                );

                Console.WriteLine(
                    "STM32 permanece com GPS e sensor de luz pausados."
                );

                Console.WriteLine();

                /*
                 * ========================================================
                 * ESPERA A DESCONEXAO REAL
                 * ========================================================
                 *
                 * NAO usamos o fim do lote para reconectar.
                 *
                 * Ficamos aqui enquanto o HC-05 estiver conectado.
                 *
                 * A funcao abaixo usa o socket para detectar quando a
                 * conexao foi realmente encerrada.
                 */
                await AguardarDesconexao(
                    btClient
                );

                Console.WriteLine();

                Console.WriteLine(
                    "Bluetooth desconectado!"
                );

                Console.WriteLine(
                    "Liberando conexao atual..."
                );
            }
            catch (
                Exception erro
            )
            {
                Console.WriteLine();

                Console.WriteLine(
                    $"Comunicacao Bluetooth interrompida: {erro.Message}"
                );
            }
            finally
            {
                /*
                 * Fecha SOMENTE a conexao atual.
                 *
                 * O programa continua vivo porque o while(true)
                 * esta fora deste try/finally.
                 */
                if (
                    btClient != null
                )
                {
                    try
                    {
                        btClient.Close();
                    }
                    catch
                    {
                    }

                    try
                    {
                        btClient.Dispose();
                    }
                    catch
                    {
                    }
                }
            }

            /*
             * Pequena pausa antes da proxima tentativa.
             *
             * Isso evita ficar abrindo e fechando conexoes em alta
             * velocidade quando o caminhão ainda estiver longe da central.
             */
            Console.WriteLine();

            Console.WriteLine(
                "Aguardando o HC-05 ficar disponivel novamente..."
            );

            await Task.Delay(
                2000
            );

            Console.WriteLine();
        }
    }


    /* =====================================================================
       AGUARDAR DESCONEXAO REAL
       ===================================================================== */

    static async Task AguardarDesconexao(
        BluetoothClient btClient
    )
    {
        /*
         * BluetoothClient.Connected pode permanecer com o ultimo estado
         * conhecido da conexao. Por isso, alem dele, verificamos o socket.
         *
         * Em um socket conectado:
         *
         * Poll(..., SelectRead) == false
         *     -> nao ha dados e a conexao continua ativa.
         *
         * Poll(...) == true + Available > 0
         *     -> existem dados para ler.
         *
         * Poll(...) == true + Available == 0
         *     -> o outro lado encerrou a conexao.
         *
         * Essa verificacao permite detectar a saida do caminhão da area
         * da central sem precisar reiniciar o C#.
         */

        while (true)
        {
            try
            {
                if (
                    !btClient.Connected
                )
                {
                    return;
                }

                Socket socket =
                    btClient.Client;

                bool leituraPronta =
                    socket.Poll(
                        1000000,
                        SelectMode.SelectRead
                    );

                if (
                    leituraPronta
                    &&
                    socket.Available == 0
                )
                {
                    return;
                }
            }
            catch
            {
                /*
                 * Se nao conseguirmos consultar o socket, tratamos
                 * como uma conexao perdida e deixamos o ciclo principal
                 * criar uma nova conexao.
                 */
                return;
            }

            await Task.Delay(
                200
            );
        }
    }


    /* =====================================================================
       ESPERAR ASSINATURA
       ===================================================================== */

    static bool EsperarAssinatura(
        Stream stream,
        int timeoutMs
    )
    {
        int indice =
            0;


        DateTime limite =
            DateTime.Now.AddMilliseconds(
                timeoutMs
            );


        while (
            DateTime.Now <
            limite
        )
        {
            try
            {
                if (
                    stream.CanRead
                    &&
                    ((NetworkStream)stream).DataAvailable
                )
                {
                    int recebido =
                        stream.ReadByte();


                    if (
                        recebido ==
                        ASSINATURA[indice]
                    )
                    {
                        indice++;


                        if (
                            indice ==
                            ASSINATURA.Length
                        )
                        {
                            return true;
                        }
                    }
                    else
                    {
                        if (
                            recebido ==
                            ASSINATURA[0]
                        )
                        {
                            indice =
                                1;
                        }
                        else
                        {
                            indice =
                                0;
                        }
                    }
                }
                else
                {
                    Thread.Sleep(
                        5
                    );
                }
            }
            catch
            {
                return false;
            }
        }


        return false;
    }


    /* =====================================================================
       RECEBER DADOS ARMAZENADOS
       ===================================================================== */

    static async Task<bool> ReceberDados(
        Stream stream,
        BluetoothClient btClient
    )
    {
        byte[] buffer =
            new byte[1024];


        StringBuilder construtorLinha =
            new StringBuilder();


        while (
            btClient.Connected
        )
        {
            try
            {
                if (
                    stream.CanRead
                    &&
                    ((NetworkStream)stream).DataAvailable
                )
                {
                    int bytesLidos =
                        stream.Read(
                            buffer,
                            0,
                            buffer.Length
                        );


                    if (
                        bytesLidos == 0
                    )
                    {
                        return false;
                    }


                    string textoLido =
                        Encoding.ASCII.GetString(
                            buffer,
                            0,
                            bytesLidos
                        );


                    foreach (
                        char c in textoLido
                    )
                    {
                        if (
                            c == '\n'
                            ||
                            c == '\r'
                        )
                        {
                            string linha =
                                construtorLinha
                                    .ToString()
                                    .Trim();


                            construtorLinha.Clear();


                            if (
                                string.IsNullOrWhiteSpace(
                                    linha
                                )
                            )
                            {
                                continue;
                            }


                            Console.WriteLine(
                                $"STM -> {linha}"
                            );


                            /*
                             * Final do arquivo.
                             */
                            if (
                                linha.Equals(
                                    MARCADOR_FIM,
                                    StringComparison.OrdinalIgnoreCase
                                )
                            )
                            {
                                Console.WriteLine();

                                Console.WriteLine(
                                    $"Fim do arquivo -> {medicoesRecebidasNoLote} medicao(oes) enviada(s) ao servidor."
                                );


                                return true;
                            }


                            /*
                             * Linha GPS que JA estava
                             * armazenada no arquivo.
                             */
                            if (
                                linha.StartsWith(
                                    "GPS |"
                                )
                            )
                            {
                                ProcessarGPS(
                                    linha
                                );


                                continue;
                            }


                            /*
                             * Linha Lux que JA estava
                             * armazenada no arquivo.
                             */
                            if (
                                linha.StartsWith(
                                    "Lux:"
                                )
                            )
                            {
                                await ProcessarLux(
                                    linha
                                );


                                continue;
                            }
                        }
                        else
                        {
                            construtorLinha.Append(
                                c
                            );
                        }
                    }
                }
                else
                {
                    await Task.Delay(
                        5
                    );
                }
            }
            catch (
                IOException
            )
            {
                Console.WriteLine(
                    "Conexao Bluetooth interrompida."
                );


                return false;
            }
            catch (
                Exception erro
            )
            {
                Console.WriteLine(
                    $"Erro durante recepcao: {erro.Message}"
                );


                return false;
            }
        }


        return false;
    }


    /* =====================================================================
       ENVIAR ACK
       ===================================================================== */

    static async Task EnviarAck(
        Stream stream
    )
    {
        try
        {
            stream.Write(
                ACK_RECEBIDO,
                0,
                ACK_RECEBIDO.Length
            );


            stream.Flush();
        }
        catch (
            Exception erro
        )
        {
            Console.WriteLine(
                $"Falha ao enviar ACK: {erro.Message}"
            );
        }


        await Task.CompletedTask;
    }


    /* =====================================================================
       PROCESSAR GPS
       ===================================================================== */

    static void ProcessarGPS(
        string linha
    )
    {
        try
        {
            Match latMatch =
                Regex.Match(
                    linha,
                    @"Lat:\s*(-?\d+[.,]\d+)"
                );


            Match lonMatch =
                Regex.Match(
                    linha,
                    @"Lon:\s*(-?\d+[.,]\d+)"
                );


            Match dataMatch =
                Regex.Match(
                    linha,
                    @"Data:\s*(\d{2})/(\d{2})/(\d{4})"
                );


            Match horaMatch =
                Regex.Match(
                    linha,
                    @"UTC:\s*(\d{2}):(\d{2}):(\d{2})"
                );


            if (
                !latMatch.Success
                ||
                !lonMatch.Success
            )
            {
                Console.WriteLine(
                    "GPS recebido sem coordenadas validas."
                );


                return;
            }


            string latTexto =
                latMatch
                    .Groups[1]
                    .Value
                    .Replace(',', '.');


            string lonTexto =
                lonMatch
                    .Groups[1]
                    .Value
                    .Replace(',', '.');


            bool latOk =
                double.TryParse(
                    latTexto,
                    NumberStyles.Float,
                    CultureInfo.InvariantCulture,
                    out double lat
                );


            bool lonOk =
                double.TryParse(
                    lonTexto,
                    NumberStyles.Float,
                    CultureInfo.InvariantCulture,
                    out double lon
                );


            if (
                !latOk
                ||
                !lonOk
            )
            {
                Console.WriteLine(
                    "Erro ao converter coordenadas."
                );


                return;
            }


            ultimaLatitude =
                lat;


            ultimaLongitude =
                lon;


            if (
                dataMatch.Success
                &&
                horaMatch.Success
            )
            {
                int dia =
                    int.Parse(
                        dataMatch.Groups[1].Value
                    );


                int mes =
                    int.Parse(
                        dataMatch.Groups[2].Value
                    );


                int ano =
                    int.Parse(
                        dataMatch.Groups[3].Value
                    );


                int hora =
                    int.Parse(
                        horaMatch.Groups[1].Value
                    );


                int minuto =
                    int.Parse(
                        horaMatch.Groups[2].Value
                    );


                int segundo =
                    int.Parse(
                        horaMatch.Groups[3].Value
                    );


                DateTime utc =
                    new DateTime(
                        ano,
                        mes,
                        dia,
                        hora,
                        minuto,
                        segundo,
                        DateTimeKind.Utc
                    );


                ultimoTimestamp =
                    utc.ToString(
                        "yyyy-MM-ddTHH:mm:ssZ"
                    );
            }
            else
            {
                ultimoTimestamp =
                    DateTime.UtcNow.ToString(
                        "yyyy-MM-ddTHH:mm:ssZ"
                    );
            }


            gpsValido =
                true;


            Console.WriteLine(
                $"GPS atualizado -> " +
                $"{ultimaLatitude:F6}, " +
                $"{ultimaLongitude:F6}"
            );
        }
        catch (
            Exception erro
        )
        {
            Console.WriteLine(
                $"Erro ao processar GPS: {erro.Message}"
            );
        }
    }


    /* =====================================================================
       PROCESSAR LUX
       ===================================================================== */

    static async Task ProcessarLux(
        string linha
    )
    {
        try
        {
            Match match =
                Regex.Match(
                    linha,
                    @"Lux:\s*(-?\d+[.,]?\d*)"
                );


            if (
                !match.Success
            )
            {
                Console.WriteLine(
                    "Nao foi possivel interpretar o Lux."
                );


                return;
            }


            string texto =
                match
                    .Groups[1]
                    .Value
                    .Replace(',', '.');


            if (
                !double.TryParse(
                    texto,
                    NumberStyles.Float,
                    CultureInfo.InvariantCulture,
                    out double lux
                )
            )
            {
                Console.WriteLine(
                    "Erro ao converter o Lux."
                );


                return;
            }


            if (
                !gpsValido
            )
            {
                Console.WriteLine(
                    "Lux armazenado encontrado antes do primeiro GPS valido."
                );


                return;
            }


            double luminosidade =
                LuxParaPercentual(
                    lux
                );


            Medicao medicao =
                new Medicao
                {
                    luminosidade =
                        Math.Round(
                            luminosidade,
                            2
                        ),

                    lat =
                        ultimaLatitude,

                    lng =
                        ultimaLongitude,

                    timestamp =
                        ultimoTimestamp
                };


            Console.WriteLine(
                $"Medicao armazenada -> Lux: {lux:F2} | " +
                $"Escala: {luminosidade:F2}"
            );


            await EnviarMedicao(
                medicao
            );
        }
        catch (
            Exception erro
        )
        {
            Console.WriteLine(
                $"Erro ao processar Lux: {erro.Message}"
            );
        }
    }


    /* =====================================================================
       CONVERTER LUX
       ===================================================================== */

    static double LuxParaPercentual(
        double lux
    )
    {
        const double LUX_MAXIMO =
            1000.0;


        if (
            lux <= 0
        )
        {
            return 0;
        }


        if (
            lux >= LUX_MAXIMO
        )
        {
            return 100;
        }


        return (
            lux /
            LUX_MAXIMO
        ) * 100.0;
    }


    /* =====================================================================
       ENVIAR PARA SITE
       ===================================================================== */

    static async Task EnviarMedicao(
        Medicao medicao
    )
    {
        try
        {
            HttpResponseMessage resposta =
                await cliente.PostAsJsonAsync(
                    $"{URL_SERVIDOR}/api/medicoes",
                    medicao
                );


            if (
                resposta.IsSuccessStatusCode
            )
            {
                medicoesRecebidasNoLote++;


                Console.WriteLine(
                    "Servidor -> medicao registrada."
                );
            }
            else
            {
                string mensagem =
                    await resposta.Content
                        .ReadAsStringAsync();


                Console.WriteLine(
                    $"Servidor -> ERRO " +
                    $"{(int)resposta.StatusCode}: " +
                    $"{mensagem}"
                );
            }
        }
        catch (
            Exception erro
        )
        {
            Console.WriteLine(
                $"Erro ao acessar servidor: {erro.Message}"
            );
        }
    }
}