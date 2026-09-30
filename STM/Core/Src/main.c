/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : LightSentinel
  ******************************************************************************
  */

#include "main.h"
#include "i2c.h"
#include "spi.h"
#include "usart.h"
#include "gpio.h"
#include "fatfs.h"
#include "ff.h"
#include "diskio.h"

#include <stdio.h>
#include <string.h>
#include <stdlib.h>


/* ==========================================================================
   DEFINES
   ========================================================================== */

#define TSL2591_ADDR                   (0x29 << 1)
#define TSL2591_COMMAND                0xA0
#define TSL2591_ENABLE                 0x00
#define TSL2591_POWERON                0x01
#define TSL2591_ENABLE_AEN             0x02
#define TSL2591_CONTROL                0x01
#define TSL2591_C0DATAL                0x14
#define TSL2591_INTEGRATIONTIME_100MS  0x00
#define TSL2591_GAIN_LOW               0x00

#define GPS_BUFFER_SIZE                128

#define SD_ARQUIVO                     "dados.txt"

#define BT_HEADER_1                    0xAA
#define BT_HEADER_2                    0x55
#define BT_COMMAND                     0x01
#define BT_END                         0xFF

#define BT_STATE_GPIO_PORT             GPIOB
#define BT_STATE_PIN                   GPIO_PIN_1

#define BT_COMANDO_BUFFER_SIZE         64


/* ==========================================================================
   VARIAVEIS
   ========================================================================== */

char mensagem[220];


/* Sensor de luminosidade */

uint16_t canal0 = 0;
uint16_t canal1 = 0;

float lux = 0.0f;


/* GPS */

char gpsBuffer[GPS_BUFFER_SIZE];

uint8_t gpsByte = 0;
uint16_t gpsIndex = 0;

float latitude = 0.0f;
float longitude = 0.0f;
float velocidade = 0.0f;

int gpsFix = 0;
int gpsSatellites = 0;

char gpsUTC[15] = "";
char gpsDate[15] = "";


/* Bluetooth */

uint8_t bluetoothByte = 0;

uint8_t bluetoothConectado = 0;

/*
 * Estado do protocolo:
 *
 * 0 = esperando AA
 * 1 = esperando 55
 * 2 = esperando 01
 * 3 = esperando FF
 * 4 = assinatura confirmada,
 *     esperando CMD_DESCARREGAR
 * 5 = transferencia concluida
 */
uint8_t bluetoothEstado = 0;

char btComando[BT_COMANDO_BUFFER_SIZE];

uint16_t btComandoIndex = 0;


/* SD */

FATFS SDFatFs;

FIL arquivoSD;

uint8_t sdMontado = 0;

uint8_t sdArquivoAberto = 0;


/* Controle de tempo */

uint32_t ultimoTempoLux = 0;


/* ==========================================================================
   PROTOTIPOS
   ========================================================================== */

void SystemClock_Config(void);


/* TSL2591 */

void TSL2591_Init(void);

float TSL2591_ReadLux(void);


/* GPS */

float GPS_ConverterCoordenada(
    char *valor
);

void GPS_ProcessarLinha(
    char *linha
);

void GPS_Processar(void);


/* Bluetooth */

uint8_t Bluetooth_EstaConectado(void);

void Bluetooth_ResetarProtocolo(void);

void Bluetooth_ProcessarByte(
    uint8_t byte
);

void Bluetooth_Process(void);

void Bluetooth_EnviarFimDados(void);


/* SD */

void SD_Iniciar(void);

uint8_t SD_TentarMontarNovamente(void);

void SD_GravarLinha(
    char *linha
);

void SD_FecharArquivo(void);

void SD_ReabrirArquivoParaGravar(void);

uint8_t SD_EnviarArquivoBluetooth(void);

uint8_t SD_LimparArquivo(void);


/* Driver SD */

DSTATUS USER_initialize(
    BYTE lun
);

DSTATUS USER_status(
    BYTE lun
);


/* ==========================================================================
   TSL2591 - INICIALIZACAO
   ========================================================================== */

void TSL2591_Init(void)
{
    uint8_t data;


    data =
        TSL2591_POWERON |
        TSL2591_ENABLE_AEN;


    HAL_I2C_Mem_Write(
        &hi2c1,
        TSL2591_ADDR,
        TSL2591_COMMAND |
        TSL2591_ENABLE,
        I2C_MEMADD_SIZE_8BIT,
        &data,
        1,
        100
    );


    data =
        TSL2591_INTEGRATIONTIME_100MS |
        TSL2591_GAIN_LOW;


    HAL_I2C_Mem_Write(
        &hi2c1,
        TSL2591_ADDR,
        TSL2591_COMMAND |
        TSL2591_CONTROL,
        I2C_MEMADD_SIZE_8BIT,
        &data,
        1,
        100
    );
}


/* ==========================================================================
   TSL2591 - LEITURA
   ========================================================================== */

float TSL2591_ReadLux(void)
{
    uint8_t data[4];

    uint16_t ch0;
    uint16_t ch1;

    float ratio;
    float cpl;
    float luxValue;

    const float integrationTime =
        100.0f;

    const float gain =
        1.0f;

    const float deviceFactor =
        408.0f;


    if (
        HAL_I2C_Mem_Read(
            &hi2c1,
            TSL2591_ADDR,
            TSL2591_COMMAND |
            TSL2591_C0DATAL,
            I2C_MEMADD_SIZE_8BIT,
            data,
            4,
            100
        )
        !=
        HAL_OK
    )
    {
        return 0.0f;
    }


    ch0 =
        ((uint16_t)data[1] << 8)
        |
        data[0];


    ch1 =
        ((uint16_t)data[3] << 8)
        |
        data[2];


    canal0 =
        ch0;

    canal1 =
        ch1;


    if (
        ch0 == 0
    )
    {
        return 0.0f;
    }


    if (
        ch1 >= ch0
    )
    {
        return 0.0f;
    }


    cpl =
        (integrationTime * gain)
        /
        deviceFactor;


    ratio =
        (float)ch1
        /
        (float)ch0;


    luxValue =
        ((float)ch0 - (float)ch1)
        *
        (1.0f - ratio)
        /
        cpl;


    if (
        luxValue < 0.0f
    )
    {
        luxValue =
            0.0f;
    }


    return luxValue;
}


/* ==========================================================================
   GPS - CONVERTER COORDENADA
   ========================================================================== */

float GPS_ConverterCoordenada(
    char *valor
)
{
    float coordenada;

    int graus;


    coordenada =
        atof(
            valor
        );


    graus =
        (int)(
            coordenada
            /
            100.0f
        );


    coordenada =
        graus
        +
        (
            (
                coordenada
                -
                (graus * 100)
            )
            /
            60.0f
        );


    return coordenada;
}


/* ==========================================================================
   GPS - PROCESSAR LINHA NMEA
   ========================================================================== */

void GPS_ProcessarLinha(
    char *linha
)
{
    char copia[
        GPS_BUFFER_SIZE
    ];

    char *token;


    if (
        linha == NULL
        ||
        strlen(linha) == 0
    )
    {
        return;
    }


    /* ======================================================================
       GGA
       ====================================================================== */

    if (
        strncmp(
            linha,
            "$GPGGA",
            6
        ) == 0
        ||
        strncmp(
            linha,
            "$GNGGA",
            6
        ) == 0
    )
    {
        int campo =
            0;

        char hora[15] =
            "";

        char lat[20] =
            "";

        char lon[20] =
            "";

        char latDir =
            'N';

        char lonDir =
            'E';

        int fix =
            0;

        int sats =
            0;


        strncpy(
            copia,
            linha,
            GPS_BUFFER_SIZE - 1
        );


        copia[
            GPS_BUFFER_SIZE - 1
        ] = '\0';


        token =
            strtok(
                copia,
                ","
            );


        while (
            token != NULL
        )
        {
            switch (
                campo
            )
            {
                case 1:

                    strcpy(
                        hora,
                        token
                    );

                    break;


                case 2:

                    strcpy(
                        lat,
                        token
                    );

                    break;


                case 3:

                    latDir =
                        token[0];

                    break;


                case 4:

                    strcpy(
                        lon,
                        token
                    );

                    break;


                case 5:

                    lonDir =
                        token[0];

                    break;


                case 6:

                    fix =
                        atoi(
                            token
                        );

                    break;


                case 7:

                    sats =
                        atoi(
                            token
                        );

                    break;


                default:

                    break;
            }


            token =
                strtok(
                    NULL,
                    ","
                );


            campo++;
        }


        if (
            fix > 0
        )
        {
            latitude =
                GPS_ConverterCoordenada(
                    lat
                );


            longitude =
                GPS_ConverterCoordenada(
                    lon
                );


            if (
                latDir == 'S'
            )
            {
                latitude =
                    -latitude;
            }


            if (
                lonDir == 'W'
            )
            {
                longitude =
                    -longitude;
            }


            gpsSatellites =
                sats;


            if (
                strlen(hora) >= 6
            )
            {
                sprintf(
                    gpsUTC,
                    "%c%c:%c%c:%c%c",
                    hora[0],
                    hora[1],
                    hora[2],
                    hora[3],
                    hora[4],
                    hora[5]
                );
            }


            gpsFix =
                1;
        }


        return;
    }


    /* ======================================================================
       RMC
       ====================================================================== */

    if (
        strncmp(
            linha,
            "$GPRMC",
            6
        ) == 0
        ||
        strncmp(
            linha,
            "$GNRMC",
            6
        ) == 0
    )
    {
        int campo =
            0;

        char hora[15] =
            "";

        char data[15] =
            "";

        char status =
            'V';

        char lat[20] =
            "";

        char lon[20] =
            "";

        char latDir =
            'N';

        char lonDir =
            'E';

        float velocidadeKnots =
            0.0f;


        strncpy(
            copia,
            linha,
            GPS_BUFFER_SIZE - 1
        );


        copia[
            GPS_BUFFER_SIZE - 1
        ] = '\0';


        token =
            strtok(
                copia,
                ","
            );


        while (
            token != NULL
        )
        {
            switch (
                campo
            )
            {
                case 1:

                    strcpy(
                        hora,
                        token
                    );

                    break;


                case 2:

                    status =
                        token[0];

                    break;


                case 3:

                    strcpy(
                        lat,
                        token
                    );

                    break;


                case 4:

                    latDir =
                        token[0];

                    break;


                case 5:

                    strcpy(
                        lon,
                        token
                    );

                    break;


                case 6:

                    lonDir =
                        token[0];

                    break;


                case 7:

                    velocidadeKnots =
                        atof(
                            token
                        );

                    break;


                case 9:

                    strcpy(
                        data,
                        token
                    );

                    break;


                default:

                    break;
            }


            token =
                strtok(
                    NULL,
                    ","
                );


            campo++;
        }


        if (
            status == 'A'
        )
        {
            latitude =
                GPS_ConverterCoordenada(
                    lat
                );


            longitude =
                GPS_ConverterCoordenada(
                    lon
                );


            if (
                latDir == 'S'
            )
            {
                latitude =
                    -latitude;
            }


            if (
                lonDir == 'W'
            )
            {
                longitude =
                    -longitude;
            }


            velocidade =
                velocidadeKnots
                *
                1.852f;


            if (
                strlen(hora) >= 6
            )
            {
                sprintf(
                    gpsUTC,
                    "%c%c:%c%c:%c%c",
                    hora[0],
                    hora[1],
                    hora[2],
                    hora[3],
                    hora[4],
                    hora[5]
                );
            }


            if (
                strlen(data) >= 6
            )
            {
                sprintf(
                    gpsDate,
                    "%c%c/%c%c/20%c%c",
                    data[0],
                    data[1],
                    data[2],
                    data[3],
                    data[4],
                    data[5]
                );
            }


            gpsFix =
                1;
        }


        return;
    }
}


/* ==========================================================================
   GPS - RECEPCAO
   ========================================================================== */

void GPS_Processar(void)
{
    /*
     * Bluetooth conectado:
     *
     * NAO le mais nenhum byte do GPS.
     */

    if (
        bluetoothConectado
    )
    {
        return;
    }


    if (
        HAL_UART_Receive(
            &huart2,
            &gpsByte,
            1,
            0
        )
        ==
        HAL_OK
    )
    {
        if (
            gpsByte == '\n'
        )
        {
            gpsBuffer[
                gpsIndex
            ] = '\0';


            GPS_ProcessarLinha(
                gpsBuffer
            );


            if (
                gpsFix
            )
            {
                sprintf(
                    mensagem,
                    "GPS | Data: %s | UTC: %s | Lat: %.6f | Lon: %.6f | Vel: %.2f km/h | Sat: %d\r\n",
                    gpsDate,
                    gpsUTC,
                    latitude,
                    longitude,
                    velocidade,
                    gpsSatellites
                );


                SD_GravarLinha(
                    mensagem
                );


                gpsFix =
                    0;
            }


            gpsIndex =
                0;
        }

        else if (
            gpsByte != '\r'
        )
        {
            if (
                gpsIndex
                <
                GPS_BUFFER_SIZE - 1
            )
            {
                gpsBuffer[
                    gpsIndex++
                ] =
                    gpsByte;
            }
            else
            {
                gpsIndex =
                    0;
            }
        }
    }
}


/* ==========================================================================
   BLUETOOTH - STATE
   ========================================================================== */

uint8_t Bluetooth_EstaConectado(void)
{
    if (
        HAL_GPIO_ReadPin(
            BT_STATE_GPIO_PORT,
            BT_STATE_PIN
        )
        ==
        GPIO_PIN_SET
    )
    {
        return 1;
    }


    return 0;
}


/* ==========================================================================
   BLUETOOTH - RESETAR PROTOCOLO
   ========================================================================== */

void Bluetooth_ResetarProtocolo(void)
{
    bluetoothEstado =
        0;


    btComandoIndex =
        0;


    memset(
        btComando,
        0,
        sizeof(btComando)
    );
}


/* ==========================================================================
   BLUETOOTH - MARCADOR DE FIM
   ========================================================================== */

void Bluetooth_EnviarFimDados(void)
{
    const char fim[] =
        "END_OF_DATA\r\n";


    HAL_UART_Transmit(
        &huart1,
        (uint8_t *)fim,
        strlen(fim),
        2000
    );
}


/* ==========================================================================
   BLUETOOTH - PROCESSAR BYTE RECEBIDO
   ========================================================================== */

void Bluetooth_ProcessarByte(
    uint8_t byte
)
{
    /* ======================================================================
       ESTADOS 0..3:
       ESPERANDO AA 55 01 FF
       ====================================================================== */

    if (
        bluetoothEstado <= 3
    )
    {
        switch (
            bluetoothEstado
        )
        {
            /* AA */

            case 0:

                if (
                    byte ==
                    BT_HEADER_1
                )
                {
                    bluetoothEstado =
                        1;
                }

                break;


            /* 55 */

            case 1:

                if (
                    byte ==
                    BT_HEADER_2
                )
                {
                    bluetoothEstado =
                        2;
                }
                else if (
                    byte ==
                    BT_HEADER_1
                )
                {
                    bluetoothEstado =
                        1;
                }
                else
                {
                    bluetoothEstado =
                        0;
                }

                break;


            /* 01 */

            case 2:

                if (
                    byte ==
                    BT_COMMAND
                )
                {
                    bluetoothEstado =
                        3;
                }
                else
                {
                    bluetoothEstado =
                        0;
                }

                break;


            /* FF */

            case 3:

                if (
                    byte ==
                    BT_END
                )
                {
                    uint8_t resposta[4] =
                    {
                        BT_HEADER_1,
                        BT_HEADER_2,
                        BT_COMMAND,
                        BT_END
                    };


                    /*
                     * Responde EXATAMENTE:
                     *
                     * AA 55 01 FF
                     *
                     * Isso e o que o C#
                     * esta esperando.
                     */

                    HAL_UART_Transmit(
                        &huart1,
                        resposta,
                        sizeof(resposta),
                        1000
                    );


                    /*
                     * Agora espera:
                     *
                     * CMD_DESCARREGAR\n
                     */

                    bluetoothEstado =
                        4;


                    btComandoIndex =
                        0;


                    memset(
                        btComando,
                        0,
                        sizeof(btComando)
                    );
                }
                else
                {
                    bluetoothEstado =
                        0;
                }

                break;


            default:

                bluetoothEstado =
                    0;

                break;
        }


        return;
    }


    /* ======================================================================
       ESTADO 4:
       ESPERANDO CMD_DESCARREGAR
       ====================================================================== */

    if (
        bluetoothEstado == 4
    )
    {
        /*
         * Ignora CR.
         */

        if (
            byte == '\r'
        )
        {
            return;
        }


        /*
         * Terminou comando.
         */

        if (
            byte == '\n'
        )
        {
            btComando[
                btComandoIndex
            ] = '\0';


            /*
             * O C# enviou:
             *
             * CMD_DESCARREGAR
             */

            if (
                strcmp(
                    btComando,
                    "CMD_DESCARREGAR"
                )
                ==
                0
            )
            {
                uint8_t envioOK;


                /*
                 * O arquivo ja esta fechado
                 * desde que o Bluetooth
                 * conectou.
                 *
                 * Portanto ele contem SOMENTE
                 * informacoes coletadas antes
                 * da conexao.
                 */

                if (
                    !sdMontado
                )
                {
                    SD_TentarMontarNovamente();
                }


                envioOK =
                    0;


                if (
                    sdMontado
                )
                {
                    envioOK =
                        SD_EnviarArquivoBluetooth();
                }


                if (
                    envioOK
                )
                {
                    /*
                     * PRIMEIRO:
                     *
                     * envia END_OF_DATA para
                     * informar ao C# que o
                     * arquivo terminou.
                     */

                    Bluetooth_EnviarFimDados();


                    /*
                     * DEPOIS:
                     *
                     * apaga todo o conteudo
                     * do dados.txt.
                     *
                     * Nao espera ACK_SUCCESS,
                     * conforme solicitado.
                     */

                    SD_LimparArquivo();


                    /*
                     * Transferencia concluida.
                     *
                     * Continua conectado e
                     * continua SEM coletar.
                     */

                    bluetoothEstado =
                        5;
                }
            }


            btComandoIndex =
                0;


            memset(
                btComando,
                0,
                sizeof(btComando)
            );


            return;
        }


        /*
         * Guarda caractere do comando.
         */

        if (
            btComandoIndex
            <
            BT_COMANDO_BUFFER_SIZE - 1
        )
        {
            btComando[
                btComandoIndex++
            ] =
                (char)byte;
        }
        else
        {
            /*
             * Comando grande demais:
             * descarta e espera novamente.
             */

            btComandoIndex =
                0;


            memset(
                btComando,
                0,
                sizeof(btComando)
            );
        }


        return;
    }


    /* ======================================================================
       ESTADO 5:
       TRANSFERENCIA JA CONCLUIDA
       ====================================================================== */

    if (
        bluetoothEstado == 5
    )
    {
        /*
         * Nao faz nova transferencia.
         *
         * Pode chegar ACK_SUCCESS do C#,
         * mas nao precisamos dele para
         * apagar porque o arquivo ja foi
         * limpo conforme solicitado.
         *
         * O STM32 continua parado ate
         * o Bluetooth desconectar.
         */

        return;
    }
}


/* ==========================================================================
   BLUETOOTH - PROCESSAMENTO
   ========================================================================== */

void Bluetooth_Process(void)
{
    uint8_t estadoAtual;


    estadoAtual =
        Bluetooth_EstaConectado();


    /* ======================================================================
       ACABOU DE CONECTAR
       ====================================================================== */

    if (
        estadoAtual == 1
        &&
        bluetoothConectado == 0
    )
    {
        /*
         * PRIMEIRA ACAO:
         *
         * bloqueia GPS, Lux e gravacao.
         */

        bluetoothConectado =
            1;


        Bluetooth_ResetarProtocolo();


        /*
         * Congela o lote atual.
         */

        SD_FecharArquivo();


        /*
         * NAO envia o arquivo aqui.
         *
         * Primeiro espera o C# mandar
         * AA 55 01 FF.
         */

        return;
    }


    /* ======================================================================
       DESCONECTOU
       ====================================================================== */

    if (
        estadoAtual == 0
        &&
        bluetoothConectado == 1
    )
    {
        bluetoothConectado =
            0;


        Bluetooth_ResetarProtocolo();


        if (
            !sdMontado
        )
        {
            SD_TentarMontarNovamente();
        }


        /*
         * Depois de uma transferencia
         * completa, dados.txt esta vazio.
         *
         * Abre para iniciar o proximo lote.
         */

        if (
            sdMontado
        )
        {
            SD_ReabrirArquivoParaGravar();
        }


        /*
         * Comeca a contar o proximo
         * intervalo de Lux daqui.
         */

        ultimoTempoLux =
            HAL_GetTick();


        return;
    }


    /*
     * Se nao estiver conectado,
     * nao processa USART1.
     */

    if (
        !bluetoothConectado
    )
    {
        return;
    }


    /*
     * Enquanto houver bytes recebidos
     * do computador, processa todos.
     */

    while (
        HAL_UART_Receive(
            &huart1,
            &bluetoothByte,
            1,
            0
        )
        ==
        HAL_OK
    )
    {
        Bluetooth_ProcessarByte(
            bluetoothByte
        );
    }
}


/* ==========================================================================
   SD - INICIAR
   ========================================================================== */

void SD_Iniciar(void)
{
    FRESULT resultado;


    sdMontado =
        0;


    sdArquivoAberto =
        0;


    resultado =
        f_mount(
            &SDFatFs,
            USERPath,
            1
        );


    if (
        resultado != FR_OK
    )
    {
        return;
    }


    sdMontado =
        1;


    /*
     * Mantendo o comportamento atual:
     *
     * ao iniciar o STM32, cria/zera
     * dados.txt.
     */

    resultado =
        f_open(
            &arquivoSD,
            SD_ARQUIVO,
            FA_CREATE_ALWAYS |
            FA_WRITE
        );


    if (
        resultado != FR_OK
    )
    {
        sdArquivoAberto =
            0;

        return;
    }


    sdArquivoAberto =
        1;
}


/* ==========================================================================
   SD - TENTAR MONTAR NOVAMENTE
   ========================================================================== */

uint8_t SD_TentarMontarNovamente(void)
{
    FRESULT resultado;

    DSTATUS estadoFisico;


    estadoFisico =
        USER_initialize(
            0
        );


    if (
        estadoFisico
        &
        STA_NOINIT
    )
    {
        sdMontado =
            0;

        return 0;
    }


    resultado =
        f_mount(
            &SDFatFs,
            USERPath,
            1
        );


    if (
        resultado != FR_OK
    )
    {
        sdMontado =
            0;

        return 0;
    }


    sdMontado =
        1;


    return 1;
}


/* ==========================================================================
   SD - GRAVAR
   ========================================================================== */

void SD_GravarLinha(
    char *linha
)
{
    FRESULT resultado;

    UINT bytesEscritos;

    UINT tamanho;


    /*
     * Bluetooth conectado:
     *
     * PROIBIDO gravar.
     */

    if (
        bluetoothConectado
    )
    {
        return;
    }


    if (
        !sdMontado
    )
    {
        return;
    }


    if (
        !sdArquivoAberto
    )
    {
        return;
    }


    tamanho =
        strlen(
            linha
        );


    resultado =
        f_write(
            &arquivoSD,
            linha,
            tamanho,
            &bytesEscritos
        );


    if (
        resultado != FR_OK
    )
    {
        return;
    }


    if (
        bytesEscritos
        !=
        tamanho
    )
    {
        return;
    }


    /*
     * Garante que a leitura ficou
     * fisicamente salva.
     */

    f_sync(
        &arquivoSD
    );
}


/* ==========================================================================
   SD - FECHAR
   ========================================================================== */

void SD_FecharArquivo(void)
{
    if (
        !sdArquivoAberto
    )
    {
        return;
    }


    /*
     * Grava tudo que ainda estiver
     * pendente.
     */

    f_sync(
        &arquivoSD
    );


    f_close(
        &arquivoSD
    );


    sdArquivoAberto =
        0;
}


/* ==========================================================================
   SD - REABRIR PARA GRAVAR
   ========================================================================== */

void SD_ReabrirArquivoParaGravar(void)
{
    FRESULT resultado;


    if (
        !sdMontado
    )
    {
        return;
    }


    /*
     * FA_OPEN_ALWAYS:
     *
     * abre se existir;
     * cria se nao existir.
     */

    resultado =
        f_open(
            &arquivoSD,
            SD_ARQUIVO,
            FA_OPEN_ALWAYS |
            FA_WRITE
        );


    if (
        resultado != FR_OK
    )
    {
        sdArquivoAberto =
            0;

        return;
    }


    /*
     * Vai para o final.
     *
     * Depois de uma descarga completa
     * o tamanho sera 0.
     */

    resultado =
        f_lseek(
            &arquivoSD,
            f_size(
                &arquivoSD
            )
        );


    if (
        resultado != FR_OK
    )
    {
        f_close(
            &arquivoSD
        );


        sdArquivoAberto =
            0;

        return;
    }


    sdArquivoAberto =
        1;
}


/* ==========================================================================
   SD - ENVIAR ARQUIVO
   ========================================================================== */

uint8_t SD_EnviarArquivoBluetooth(void)
{
    FIL arquivoLeitura;

    FRESULT resultado;

    UINT bytesLidos;

    uint8_t buffer[128];


    if (
        !sdMontado
    )
    {
        return 0;
    }


    /*
     * Abre somente para leitura.
     */

    resultado =
        f_open(
            &arquivoLeitura,
            SD_ARQUIVO,
            FA_READ
        );


    if (
        resultado != FR_OK
    )
    {
        return 0;
    }


    while (1)
    {
        bytesLidos =
            0;


        resultado =
            f_read(
                &arquivoLeitura,
                buffer,
                sizeof(buffer),
                &bytesLidos
            );


        /*
         * Erro no SD:
         * nao considera transferencia
         * concluida.
         */

        if (
            resultado != FR_OK
        )
        {
            f_close(
                &arquivoLeitura
            );


            return 0;
        }


        /*
         * EOF:
         *
         * todo o arquivo foi percorrido.
         */

        if (
            bytesLidos == 0
        )
        {
            break;
        }


        /*
         * Envia exatamente os bytes
         * que estavam no dados.txt.
         */

        if (
            HAL_UART_Transmit(
                &huart1,
                buffer,
                bytesLidos,
                5000
            )
            !=
            HAL_OK
        )
        {
            f_close(
                &arquivoLeitura
            );


            return 0;
        }
    }


    f_close(
        &arquivoLeitura
    );


    /*
     * Chegou ao final sem erro.
     */

    return 1;
}


/* ==========================================================================
   SD - LIMPAR ARQUIVO
   ========================================================================== */

uint8_t SD_LimparArquivo(void)
{
    FIL arquivoLimpeza;

    FRESULT resultado;


    if (
        !sdMontado
    )
    {
        return 0;
    }


    /*
     * FA_CREATE_ALWAYS:
     *
     * dados.txt continua existindo,
     * mas todo o conteudo e apagado.
     */

    resultado =
        f_open(
            &arquivoLimpeza,
            SD_ARQUIVO,
            FA_CREATE_ALWAYS |
            FA_WRITE
        );


    if (
        resultado != FR_OK
    )
    {
        return 0;
    }


    resultado =
        f_sync(
            &arquivoLimpeza
        );


    if (
        resultado != FR_OK
    )
    {
        f_close(
            &arquivoLimpeza
        );


        return 0;
    }


    resultado =
        f_close(
            &arquivoLimpeza
        );


    if (
        resultado != FR_OK
    )
    {
        return 0;
    }


    return 1;
}


/* ==========================================================================
   MAIN
   ========================================================================== */

int main(void)
{
    uint8_t estadoBluetoothInicial;


    /* HAL */

    HAL_Init();


    /* Clock */

    SystemClock_Config();


    /* Perifericos */

    MX_GPIO_Init();

    MX_I2C1_Init();

    MX_SPI1_Init();

    MX_USART1_UART_Init();

    MX_USART2_UART_Init();

    MX_FATFS_Init();


    /* ======================================================================
       SENSOR
       ====================================================================== */

    TSL2591_Init();


    HAL_Delay(
        100
    );


    /* ======================================================================
       SD
       ====================================================================== */

    SD_Iniciar();


    /* ======================================================================
       ESTADO INICIAL DO BLUETOOTH
       ====================================================================== */

    estadoBluetoothInicial =
        Bluetooth_EstaConectado();


    if (
        estadoBluetoothInicial
    )
    {
        /*
         * Se ja estiver conectado
         * quando ligar:
         *
         * para coleta imediatamente.
         */

        bluetoothConectado =
            1;


        Bluetooth_ResetarProtocolo();


        /*
         * Congela o arquivo.
         */

        SD_FecharArquivo();


        /*
         * NAO envia nada ainda.
         *
         * Espera AA 55 01 FF do C#.
         */
    }
    else
    {
        bluetoothConectado =
            0;


        Bluetooth_ResetarProtocolo();
    }


    /* ======================================================================
       LOOP PRINCIPAL
       ====================================================================== */

    while (1)
    {
        /*
         * PRIMEIRO:
         *
         * verifica Bluetooth.
         */

        Bluetooth_Process();


        /*
         * ================================================================
         * SO COLETA COM BLUETOOTH DESCONECTADO
         * ================================================================
         */

        if (
            !bluetoothConectado
        )
        {
            /*
             * GPS.
             */

            GPS_Processar();


            /*
             * Lux a cada segundo.
             */

            if (
                HAL_GetTick()
                -
                ultimoTempoLux
                >=
                1000
            )
            {
                ultimoTempoLux =
                    HAL_GetTick();


                lux =
                    TSL2591_ReadLux();


                sprintf(
                    mensagem,
                    "Lux: %.2f\r\n",
                    lux
                );


                SD_GravarLinha(
                    mensagem
                );
            }
        }


        /*
         * NAO colocar HAL_Delay(1).
         *
         * Isso anteriormente fazia o
         * polling do GPS perder bytes.
         */
    }
}


/* ==========================================================================
   SYSTEM CLOCK
   ========================================================================== */

void SystemClock_Config(void)
{
    RCC_OscInitTypeDef RCC_OscInitStruct =
        {0};


    RCC_ClkInitTypeDef RCC_ClkInitStruct =
        {0};


    RCC_OscInitStruct.OscillatorType =
        RCC_OSCILLATORTYPE_HSE;


    RCC_OscInitStruct.HSEState =
        RCC_HSE_ON;


    RCC_OscInitStruct.HSEPredivValue =
        RCC_HSE_PREDIV_DIV1;


    RCC_OscInitStruct.HSIState =
        RCC_HSI_ON;


    RCC_OscInitStruct.PLL.PLLState =
        RCC_PLL_ON;


    RCC_OscInitStruct.PLL.PLLSource =
        RCC_PLLSOURCE_HSE;


    RCC_OscInitStruct.PLL.PLLMUL =
        RCC_PLL_MUL9;


    if (
        HAL_RCC_OscConfig(
            &RCC_OscInitStruct
        )
        !=
        HAL_OK
    )
    {
        Error_Handler();
    }


    RCC_ClkInitStruct.ClockType =
        RCC_CLOCKTYPE_HCLK |
        RCC_CLOCKTYPE_SYSCLK |
        RCC_CLOCKTYPE_PCLK1 |
        RCC_CLOCKTYPE_PCLK2;


    RCC_ClkInitStruct.SYSCLKSource =
        RCC_SYSCLKSOURCE_PLLCLK;


    RCC_ClkInitStruct.AHBCLKDivider =
        RCC_SYSCLK_DIV1;


    RCC_ClkInitStruct.APB1CLKDivider =
        RCC_HCLK_DIV2;


    RCC_ClkInitStruct.APB2CLKDivider =
        RCC_HCLK_DIV1;


    if (
        HAL_RCC_ClockConfig(
            &RCC_ClkInitStruct,
            FLASH_LATENCY_2
        )
        !=
        HAL_OK
    )
    {
        Error_Handler();
    }
}


/* ==========================================================================
   ERROR HANDLER
   ========================================================================== */

void Error_Handler(void)
{
    __disable_irq();


    while (1)
    {
    }
}


#ifdef USE_FULL_ASSERT

void assert_failed(
    uint8_t *file,
    uint32_t line
)
{
    (void)file;

    (void)line;
}

#endif
