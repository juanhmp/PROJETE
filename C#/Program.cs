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

    // Endereço MAC do HC-05 (00:21:13:00:3a:1e)
    static readonly BluetoothAddress ENDERECO_HC05 = BluetoothAddress.Parse("002113003A1E");

    // Assinatura hexadecimal do LightSentinel
    static readonly byte[] ASSINATURA = {
        0xAA, 0x55, 0x01, 0xFF
    };

    // HttpClient único, reaproveitado por todo o programa
    static readonly HttpClient cliente = new HttpClient
    {
        Timeout = TimeSpan.FromSeconds(5)
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

        Guid servicoSpp = BluetoothService.SerialPort;
        BluetoothEndPoint endPoint = new BluetoothEndPoint(ENDERECO_HC05, servicoSpp);

        while (true)
        {
            BluetoothClient btClient = new BluetoothClient();

            Console.WriteLine("Procurando LightSentinel via Bluetooth (32feet.NET)...");

            try
            {
                btClient.Connect(endPoint);
                Stream stream = btClient.GetStream();

                Console.WriteLine();
                Console.WriteLine($"LightSentinel encontrado no endereço {ENDERECO_HC05}");
                Console.WriteLine("Enviando assinatura de verificação...");

                // Envia a assinatura
                stream.Write(ASSINATURA, 0, ASSINATURA.Length);
                stream.Flush();

                if (EsperarAssinatura(stream, 1500))
                {
                    Console.WriteLine("LightSentinel verificado com sucesso!");
                    Console.WriteLine("Recebendo dados...");
                    Console.WriteLine();

                    await ReceberDados(stream, btClient);
                }
                else
                {
                    Console.WriteLine("Assinatura não corresponde.");
                }
            }
            catch (Exception erro)
            {
                Console.WriteLine();
                Console.WriteLine($"Comunicação interrompida: {erro.Message}");
            }
            finally
            {
                btClient.Close();
                btClient.Dispose();
            }

            gpsValido = false;

            Console.WriteLine();
            Console.WriteLine("Procurando o LightSentinel novamente em 2 segundos...");
            Console.WriteLine();

            Thread.Sleep(2000);
        }
    }

    static bool EsperarAssinatura(Stream stream, int timeoutMs)
    {
        int indice = 0;
        DateTime limite = DateTime.Now.AddMilliseconds(timeoutMs);

        while (DateTime.Now < limite)
        {
            try
            {
                if (stream.CanRead && ((NetworkStream)stream).DataAvailable)
                {
                    int recebido = stream.ReadByte();

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
                    Thread.Sleep(5);
                }
            }
            catch
            {
                return false;
            }
        }

        return false;
    }

    static async Task ReceberDados(Stream stream, BluetoothClient btClient)
    {
        byte[] buffer = new byte[1024];
        StringBuilder construtorLinha = new StringBuilder();

        while (btClient.Connected)
        {
            try
            {
                if (stream.CanRead && ((NetworkStream)stream).DataAvailable)
                {
                    int bytesLidos = stream.Read(buffer, 0, buffer.Length);
                    if (bytesLidos == 0) break;

                    string textoLido = Encoding.ASCII.GetString(buffer, 0, bytesLidos);

                    foreach (char c in textoLido)
                    {
                        if (c == '\n' || c == '\r')
                        {
                            string linha = construtorLinha.ToString().Trim();
                            construtorLinha.Clear();

                            if (!string.IsNullOrWhiteSpace(linha))
                            {
                                Console.WriteLine($"STM -> {linha}");

                                if (linha.StartsWith("GPS |"))
                                {
                                    ProcessarGPS(linha);
                                }
                                else if (linha.StartsWith("Lux:"))
                                {
                                    ProcessarLux(linha);
                                }
                            }
                        }
                        else
                        {
                            construtorLinha.Append(c);
                        }
                    }
                }
                else
                {
                    await Task.Delay(5);
                }
            }
            catch (IOException)
            {
                Console.WriteLine("Aviso: Conexão interrompida.");
                break;
            }
            catch (Exception)
            {
                break;
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

            if (!latMatch.Success || !lonMatch.Success)
            {
                Console.WriteLine("GPS recebido sem coordenadas válidas.");
                return;
            }

            string latTexto = latMatch.Groups[1].Value.Replace(',', '.');
            string lonTexto = lonMatch.Groups[1].Value.Replace(',', '.');

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
                Console.WriteLine("Erro ao converter coordenadas.");
                return;
            }

            ultimaLatitude = lat;
            ultimaLongitude = lon;

            if (dataMatch.Success && horaMatch.Success)
            {
                int dia = int.Parse(dataMatch.Groups[1].Value);
                int mes = int.Parse(dataMatch.Groups[2].Value);
                int ano = int.Parse(dataMatch.Groups[3].Value);

                int hora = int.Parse(horaMatch.Groups[1].Value);
                int minuto = int.Parse(horaMatch.Groups[2].Value);
                int segundo = int.Parse(horaMatch.Groups[3].Value);

                DateTime utc = new DateTime(
                    ano,
                    mes,
                    dia,
                    hora,
                    minuto,
                    segundo,
                    DateTimeKind.Utc
                );

                ultimoTimestamp = utc.ToString("yyyy-MM-ddTHH:mm:ssZ");
            }
            else
            {
                ultimoTimestamp = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ");
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
            Console.WriteLine($"Erro ao processar GPS: {erro.Message}");
        }
    }

    static void ProcessarLux(string linha)
    {
        try
        {
            Match match = Regex.Match(
                linha,
                @"Lux:\s*(-?\d+[.,]?\d*)"
            );

            if (!match.Success)
            {
                Console.WriteLine("Não foi possível interpretar o Lux.");
                return;
            }

            string texto = match.Groups[1].Value.Replace(',', '.');

            if (!double.TryParse(
                    texto,
                    NumberStyles.Float,
                    CultureInfo.InvariantCulture,
                    out double lux
                ))
            {
                Console.WriteLine("Erro ao converter o Lux.");
                return;
            }

            if (!gpsValido)
            {
                Console.WriteLine("Lux recebido, mas ainda não existe GPS válido.");
                return;
            }

            double luminosidade = LuxParaPercentual(lux);

            Medicao medicao = new Medicao
            {
                luminosidade = Math.Round(luminosidade, 2),
                lat = ultimaLatitude,
                lng = ultimaLongitude,
                timestamp = ultimoTimestamp
            };

            Console.WriteLine(
                $"Medição -> Lux: {lux:F2} | " +
                $"Escala: {luminosidade:F2}"
            );
        }
        catch (Exception erro)
        {
            Console.WriteLine($"Erro ao processar Lux: {erro.Message}");
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

    static async Task EnviarMedicao(Medicao medicao)
    {
        try
        {
            HttpResponseMessage resposta =
                await cliente.PostAsJsonAsync(
                    $"{URL_SERVIDOR}/api/medicoes",
                    medicao
                );

            if (resposta.IsSuccessStatusCode)
            {
                Console.WriteLine("Servidor -> medição registrada.");
            }
            else
            {
                string mensagem = await resposta.Content.ReadAsStringAsync();

                Console.WriteLine(
                    $"Servidor -> ERRO " +
                    $"{(int)resposta.StatusCode}: " +
                    $"{mensagem}"
                );
            }
        }
        catch (Exception erro)
        {
            Console.WriteLine($"Erro ao acessar servidor: {erro.Message}");
        }
    }
}