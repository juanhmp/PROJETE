using System;
using System.Globalization;
using System.IO.Ports;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    const int BAUD_RATE = 9600;
    const string URL_SERVIDOR = "http://localhost:3000";

    // Assinatura hexadecimal do LightSentinel
    static readonly byte[] ASSINATURA = {
        0xAA, 0x55, 0x01, 0xFF
    };

    // CORREÇÃO: HttpClient único, reaproveitado por todo o programa.
    // Criar um HttpClient novo a cada medição (o código original fazia
    // "using HttpClient cliente = new HttpClient()" dentro de EnviarMedicao)
    // esgota as portas TCP disponíveis depois de rodar por um tempo,
    // já que o STM32 manda uma medição de Lux por segundo.
    static readonly HttpClient cliente = new HttpClient
    {
        Timeout = TimeSpan.FromSeconds(10)
    };

    static double ultimaLatitude = 0;
    static double ultimaLongitude = 0;
    static string? ultimoTimestamp = null;
    static bool gpsValido = false;

    public class Medicao
    {
        public double luminosidade { get; set; }
        public double lat { get; set; }
        public double lng { get; set; }
        public string? timestamp { get; set; }
    }

    static async Task Main()
    {
        Console.Title = "LightSentinel - Base";

        Console.WriteLine("========================================");
        Console.WriteLine("          LIGHTSENTINEL - BASE");
        Console.WriteLine("========================================");
        Console.WriteLine();

        while (true)
        {
            SerialPort? porta = ProcurarLightSentinel();

            if (porta == null)
            {
                Console.WriteLine();
                Console.WriteLine("LightSentinel não encontrado.");
                Console.WriteLine("Tentando novamente em 5 segundos...");
                Console.WriteLine();

                Thread.Sleep(5000);
              //  continue;
            }
            else
            {

            Console.WriteLine();
            Console.WriteLine($"LightSentinel encontrado em {porta.PortName}");
            Console.WriteLine($"Velocidade: {BAUD_RATE} baud");
            Console.WriteLine();
            Console.WriteLine("Recebendo dados...");
            Console.WriteLine();

            try
            {
                await ReceberDados(porta);
            }
            catch (Exception erro)
            {
                Console.WriteLine();
                Console.WriteLine(
                    $"Comunicação interrompida: {erro.Message}"
                );
            }
            
            try
            {
                if (porta.IsOpen)
                    porta.Close();
            }
            catch
            {
            }

            porta.Dispose();
            }

            gpsValido = false;

            Console.WriteLine();
            Console.WriteLine(
                "Procurando o LightSentinel novamente..."
            );

            Console.WriteLine();

            Thread.Sleep(3000);
        }
    }

    static SerialPort? ProcurarLightSentinel()
    {
        string[] portas = SerialPort.GetPortNames();

        if (portas.Length == 0)
        {
            Console.WriteLine("Nenhuma porta COM encontrada.");
            return null;
        }

        Console.WriteLine("Procurando LightSentinel...");
        Console.WriteLine();

        // Mantém a detecção automática das portas.
        // Apenas dá prioridade à COM7, que no computador atual
        // aparece como "HC-05 SPP Dev".
        string[] portasOrdenadas = new string[portas.Length];
        int indicePortas = 0;

        // Primeiro testa a COM7, se ela existir.
        foreach (string nome in portas)
        {
            Console.WriteLine("Porta="+nome);
            if (nome.Equals("COM7", StringComparison.OrdinalIgnoreCase))
            {
                portasOrdenadas[indicePortas] = nome;
                indicePortas++;
                break;
            }
        }

        // Depois testa todas as outras portas automaticamente.
        foreach (string nome in portas)
        {
            if (!nome.Equals("COM7", StringComparison.OrdinalIgnoreCase))
            {
                portasOrdenadas[indicePortas] = nome;
                indicePortas++;
            }
        }

        foreach (string nome in portasOrdenadas)
        {
            Console.Write($"{nome} -> ");

            SerialPort? porta = null;

            try
            {
                porta = new SerialPort(
                    nome,
                    BAUD_RATE,
                    Parity.None,
                    8,
                    StopBits.One
                );

                porta.ReadTimeout = 1500;
                porta.WriteTimeout = 1500;
                porta.NewLine = "\n";

                porta.Close();
                Thread.Sleep(300);
                porta.Open();

                Thread.Sleep(300);

                porta.DiscardInBuffer();
                porta.DiscardOutBuffer();

                /*
                 * Envia:
                 * AA 55 01 FF
                 *
                 * O STM deverá responder:
                 * AA 55 01 FF
                 */

                porta.Write(
                    ASSINATURA,
                    0,
                    ASSINATURA.Length
                );

                if (EsperarAssinatura(porta, 1500))
                {
                    Console.WriteLine(
                        "LightSentinel encontrado!"
                    );

                    /*
                     * Limpa qualquer byte restante
                     * antes de começar a ler texto.
                     */
                    Thread.Sleep(100);

                    porta.DiscardInBuffer();

                    return porta;
                }

                Console.WriteLine("não corresponde.");

                porta.Close();
                porta.Dispose();
            }
            catch (UnauthorizedAccessException)
            {
                Console.WriteLine("porta ocupada.");

                try
                {
                    if (porta != null && porta.IsOpen)
                        porta.Close();
                }
                catch
                {
                    Console.WriteLine ("erro catch");
                }

                porta?.Dispose();
            }
            catch (Exception)
            {
                Console.WriteLine("sem resposta.");

                try
                {
                    if (porta != null && porta.IsOpen)
                        porta.Close();
                }
                catch
                {
                }

                porta?.Dispose();
            }
        }

        return null;
    }

    static bool EsperarAssinatura(
        SerialPort porta,
        int timeoutMs
    )
    {
        int indice = 0;

        DateTime limite =
            DateTime.Now.AddMilliseconds(timeoutMs);

        while (DateTime.Now < limite)
        {
            if (porta.BytesToRead > 0)
            {
                int recebido = porta.ReadByte();

                if (recebido == ASSINATURA[indice])
                {
                    indice++;

                    if (indice == ASSINATURA.Length)
                        return true;
                }
                else
                {
                    if (recebido == ASSINATURA[0])
                        indice = 1;
                    else
                        indice = 0;
                }
            }
            else
            {
                Thread.Sleep(10);
            }
        }

        return false;
    }

    static async Task ReceberDados(SerialPort porta)
    {
        while (porta.IsOpen)
        {
            string linha;

            try
            {
                linha = porta.ReadLine().Trim();
            }
            catch (TimeoutException)
            {
                continue;
            }

            if (string.IsNullOrWhiteSpace(linha))
                continue;

            Console.WriteLine($"STM -> {linha}");

            if (linha.StartsWith("GPS |"))
            {
                ProcessarGPS(linha);
            }
            else if (linha.StartsWith("Lux:"))
            {
                await ProcessarLux(linha);
            }
        }
    }

    static void ProcessarGPS(string linha)
    {
        try
        {
            Match latMatch = Regex.Match(
                linha,
                @"Lat:\s*(-?\d+[.,]\d+)"
            );

            Match lonMatch = Regex.Match(
                linha,
                @"Lon:\s*(-?\d+[.,]\d+)"
            );

            Match dataMatch = Regex.Match(
                linha,
                @"Data:\s*(\d{2})/(\d{2})/(\d{4})"
            );

            Match horaMatch = Regex.Match(
                linha,
                @"UTC:\s*(\d{2}):(\d{2}):(\d{2})"
            );

            if (!latMatch.Success ||
                !lonMatch.Success)
            {
                Console.WriteLine(
                    "GPS recebido sem coordenadas válidas."
                );

                return;
            }

            string latTexto =
                latMatch.Groups[1].Value.Replace(',', '.');

            string lonTexto =
                lonMatch.Groups[1].Value.Replace(',', '.');

            bool latOk = double.TryParse(
                latTexto,
                NumberStyles.Float,
                CultureInfo.InvariantCulture,
                out double lat
            );

            bool lonOk = double.TryParse(
                lonTexto,
                NumberStyles.Float,
                CultureInfo.InvariantCulture,
                out double lon
            );

            if (!latOk || !lonOk)
            {
                Console.WriteLine(
                    "Erro ao converter coordenadas."
                );

                return;
            }

            ultimaLatitude = lat;
            ultimaLongitude = lon;

            if (dataMatch.Success &&
                horaMatch.Success)
            {
                int dia = int.Parse(
                    dataMatch.Groups[1].Value
                );

                int mes = int.Parse(
                    dataMatch.Groups[2].Value
                );

                int ano = int.Parse(
                    dataMatch.Groups[3].Value
                );

                int hora = int.Parse(
                    horaMatch.Groups[1].Value
                );

                int minuto = int.Parse(
                    horaMatch.Groups[2].Value
                );

                int segundo = int.Parse(
                    horaMatch.Groups[3].Value
                );

                DateTime utc = new DateTime(
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

            gpsValido = true;

            Console.WriteLine(
                $"GPS atualizado -> " +
                $"{ultimaLatitude:F6}, " +
                $"{ultimaLongitude:F6}"
            );
        }
        catch (Exception erro)
        {
            Console.WriteLine(
                $"Erro ao processar GPS: {erro.Message}"
            );
        }
    }

    static async Task ProcessarLux(string linha)
    {
        try
        {
            Match match = Regex.Match(
                linha,
                @"Lux:\s*(-?\d+[.,]?\d*)"
            );

            if (!match.Success)
            {
                Console.WriteLine(
                    "Não foi possível interpretar o Lux."
                );

                return;
            }

            string texto =
                match.Groups[1].Value.Replace(',', '.');

            if (!double.TryParse(
                    texto,
                    NumberStyles.Float,
                    CultureInfo.InvariantCulture,
                    out double lux
                ))
            {
                Console.WriteLine(
                    "Erro ao converter o Lux."
                );

                return;
            }

            if (!gpsValido)
            {
                Console.WriteLine(
                    "Lux recebido, mas ainda não existe GPS válido."
                );

                return;
            }

            double luminosidade =
                LuxParaPercentual(lux);

            Medicao medicao = new Medicao
            {
                luminosidade =
                    Math.Round(luminosidade, 2),

                lat = ultimaLatitude,

                lng = ultimaLongitude,

                timestamp = ultimoTimestamp
            };

            Console.WriteLine(
                $"Medição -> Lux: {lux:F2} | " +
                $"Escala: {luminosidade:F2}"
            );

            await EnviarMedicao(medicao);
        }
        catch (Exception erro)
        {
            Console.WriteLine(
                $"Erro ao processar Lux: {erro.Message}"
            );
        }
    }

    static double LuxParaPercentual(double lux)
    {
        const double LUX_MAXIMO = 1000.0;

        if (lux <= 0)
            return 0;

        if (lux >= LUX_MAXIMO)
            return 100;

        return (lux / LUX_MAXIMO) * 100.0;
    }

    static async Task EnviarMedicao(
        Medicao medicao
    )
    {
        // CORREÇÃO: reaproveita o HttpClient estático em vez de criar
        // (e descartar) um novo a cada chamada.
        try
        {
            HttpResponseMessage resposta =
                await cliente.PostAsJsonAsync(
                    $"{URL_SERVIDOR}/api/medicoes",
                    medicao
                );

            if (resposta.IsSuccessStatusCode)
            {
                Console.WriteLine(
                    "Servidor -> medição registrada."
                );
            }
            else
            {
                string mensagem =
                    await resposta.Content.ReadAsStringAsync();

                Console.WriteLine(
                    $"Servidor -> ERRO " +
                    $"{(int)resposta.StatusCode}: " +
                    $"{mensagem}"
                );
            }
        }
        catch (Exception erro)
        {
            Console.WriteLine(
                $"Erro ao acessar servidor: " +
                $"{erro.Message}"
            );
        }
    }
}