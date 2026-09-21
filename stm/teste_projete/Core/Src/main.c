/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : Main program body
  ******************************************************************************
  */
/* USER CODE END Header */

/* Includes ------------------------------------------------------------------*/
#include "main.h"
#include "i2c.h"
#include "spi.h"
#include "usart.h"
#include "gpio.h"

#include <stdio.h>
#include <string.h>
#include <stdlib.h>

/* Private defines -----------------------------------------------------------*/

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

/* Private variables ---------------------------------------------------------*/

char mensagem[180];

/* Variáveis do TSL2591 */
uint16_t canal0 = 0;
uint16_t canal1 = 0;
float lux = 0.0f;

/* Variáveis do GPS */
char gpsBuffer[GPS_BUFFER_SIZE];
uint8_t gpsByte;
uint16_t gpsIndex = 0;

float latitude = 0.0f;
float longitude = 0.0f;
float velocidade = 0.0f;

int gpsFix = 0;
int gpsSatellites = 0;

char gpsUTC[15] = "";
char gpsDate[15] = "";

/* Variáveis do Bluetooth */
uint8_t bluetoothByte;
uint8_t bluetoothEstado = 0;

/* Private function prototypes -----------------------------------------------*/

void SystemClock_Config(void);

HAL_StatusTypeDef TSL2591_WriteRegister(uint8_t reg, uint8_t value);
HAL_StatusTypeDef TSL2591_Init(void);
HAL_StatusTypeDef TSL2591_ReadChannels(uint16_t *ch0, uint16_t *ch1);
float TSL2591_CalculateLux(uint16_t ch0, uint16_t ch1);

float GPS_ToDecimal(float coordinate);
void GPS_Process(char *sentence);

void Bluetooth_Process(void);

/* Private user code ---------------------------------------------------------*/

/**
  * @brief  Write data to TSL2591 register
  */
HAL_StatusTypeDef TSL2591_WriteRegister(uint8_t reg, uint8_t value)
{
    uint8_t buffer[2];

    buffer[0] = TSL2591_COMMAND | reg;
    buffer[1] = value;

    return HAL_I2C_Master_Transmit(
        &hi2c1,
        TSL2591_ADDR,
        buffer,
        2,
        1000
    );
}

/**
  * @brief  Initialize TSL2591
  */
HAL_StatusTypeDef TSL2591_Init(void)
{
    HAL_StatusTypeDef status;

    /* Liga o sensor */
    status = TSL2591_WriteRegister(
        TSL2591_ENABLE,
        TSL2591_POWERON | TSL2591_ENABLE_AEN
    );

    if (status != HAL_OK)
        return status;

    /*
     * Configura:
     *
     * Tempo de integração = 100 ms
     * Ganho = baixo (1x)
     */
    status = TSL2591_WriteRegister(
        TSL2591_CONTROL,
        TSL2591_INTEGRATIONTIME_100MS |
        TSL2591_GAIN_LOW
    );

    return status;
}

/**
  * @brief  Read TSL2591 channels
  */
HAL_StatusTypeDef TSL2591_ReadChannels(
    uint16_t *ch0,
    uint16_t *ch1
)
{
    uint8_t dados[4];

    HAL_StatusTypeDef status;

    status = HAL_I2C_Mem_Read(
        &hi2c1,
        TSL2591_ADDR,
        TSL2591_COMMAND | TSL2591_C0DATAL,
        I2C_MEMADD_SIZE_8BIT,
        dados,
        4,
        1000
    );

    if (status != HAL_OK)
        return status;

    /*
     * Canal 0:
     * dados[0] = byte baixo
     * dados[1] = byte alto
     */
    *ch0 = ((uint16_t)dados[1] << 8) | dados[0];

    /*
     * Canal 1:
     * dados[2] = byte baixo
     * dados[3] = byte alto
     */
    *ch1 = ((uint16_t)dados[3] << 8) | dados[2];

    return HAL_OK;
}

/**
  * @brief  Calculate lux using TSL2591 characteristics
  */
float TSL2591_CalculateLux(
    uint16_t ch0,
    uint16_t ch1
)
{
    /*
     * TSL2591:
     *
     * Tempo de integração = 100 ms
     * Ganho = 1x
     *
     * DF = 408
     *
     * CPL = (ATIME x AGAIN) / DF
     *
     * ATIME = 100 ms
     * AGAIN = 1
     */
    const float integrationTime = 100.0f;
    const float gain = 1.0f;
    const float deviceFactor = 408.0f;

    float cpl;
    float ratio;
    float luxValue;

    /*
     * Evita divisão por zero
     */
    if (ch0 == 0)
        return 0.0f;

    /*
     * Se o infravermelho for maior que o canal 0,
     * o resultado não é confiável.
     */
    if (ch1 >= ch0)
        return 0.0f;

    /*
     * Counts Per Lux
     */
    cpl = (integrationTime * gain) / deviceFactor;

    /*
     * Relação entre infravermelho e luz total
     */
    ratio = (float)ch1 / (float)ch0;

    /*
     * Cálculo compensado de Lux
     *
     * A diferença CH0 - CH1 remove
     * grande parte da componente infravermelha.
     *
     * O termo (1 - ratio) melhora a
     * compensação em diferentes condições
     * de iluminação.
     */
    luxValue =
        ((float)ch0 - (float)ch1) *
        (1.0f - ratio) /
        cpl;

    /*
     * Evita resultado negativo
     */
    if (luxValue < 0.0f)
        luxValue = 0.0f;

    return luxValue;
}

/**
  * @brief  Convert NMEA coordinate to decimal degrees
  *
  * Example:
  * 2215.1234 -> 22.252056
  */
float GPS_ToDecimal(float coordinate)
{
    int degrees;
    float minutes;
    float decimal;

    degrees = (int)(coordinate / 100.0f);

    minutes =
        coordinate -
        ((float)degrees * 100.0f);

    decimal =
        degrees +
        (minutes / 60.0f);

    return decimal;
}

/**
  * @brief  Process GPS NMEA sentence
  */
void GPS_Process(char *sentence)
{
    char copy[GPS_BUFFER_SIZE];

    char *token;
    char *fields[20];

    int fieldCount = 0;

    float nmeaLatitude;
    float nmeaLongitude;

    /*
     * ============================================================
     * GGA
     * ============================================================
     *
     * Obtém:
     * - Horário UTC
     * - Latitude
     * - Longitude
     * - Qualidade do GPS
     * - Número de satélites
     */

    if (strncmp(sentence, "$GPGGA", 6) == 0 ||
        strncmp(sentence, "$GNGGA", 6) == 0)
    {
        strncpy(
            copy,
            sentence,
            GPS_BUFFER_SIZE - 1
        );

        copy[GPS_BUFFER_SIZE - 1] = '\0';

        token = strtok(copy, ",");

        while (
            token != NULL &&
            fieldCount < 20
        )
        {
            fields[fieldCount] = token;

            fieldCount++;

            token = strtok(NULL, ",");
        }

        if (fieldCount < 8)
            return;

        /*
         * Campo 1 = UTC
         */
        if (strlen(fields[1]) > 0)
        {
            strncpy(
                gpsUTC,
                fields[1],
                sizeof(gpsUTC) - 1
            );

            gpsUTC[sizeof(gpsUTC) - 1] = '\0';
        }

        /*
         * Verifica latitude e longitude
         */
        if (strlen(fields[2]) == 0 ||
            strlen(fields[4]) == 0)
        {
            gpsFix = 0;

            return;
        }

        /*
         * Campo 6 = qualidade do GPS
         */
        gpsFix = atoi(fields[6]);

        /*
         * Campo 7 = satélites
         */
        gpsSatellites = atoi(fields[7]);

        /*
         * Sem posição válida
         */
        if (gpsFix == 0)
            return;

        /*
         * Latitude
         */
        nmeaLatitude = atof(fields[2]);

        latitude = GPS_ToDecimal(
            nmeaLatitude
        );

        /*
         * Sul = negativo
         */
        if (fields[3][0] == 'S')
            latitude = -latitude;

        /*
         * Longitude
         */
        nmeaLongitude = atof(fields[4]);

        longitude = GPS_ToDecimal(
            nmeaLongitude
        );

        /*
         * Oeste = negativo
         */
        if (fields[5][0] == 'W')
            longitude = -longitude;
    }

    /*
     * ============================================================
     * RMC
     * ============================================================
     *
     * Obtém:
     * - Horário UTC
     * - Velocidade
     * - Data
     */

    if (strncmp(sentence, "$GPRMC", 6) == 0 ||
        strncmp(sentence, "$GNRMC", 6) == 0)
    {
        fieldCount = 0;

        token = strtok(sentence, ",");

        while (
            token != NULL &&
            fieldCount < 20
        )
        {
            fields[fieldCount] = token;

            fieldCount++;

            token = strtok(NULL, ",");
        }

        if (fieldCount < 10)
            return;

        /*
         * Campo 1 = UTC
         */
        if (strlen(fields[1]) > 0)
        {
            strncpy(
                gpsUTC,
                fields[1],
                sizeof(gpsUTC) - 1
            );

            gpsUTC[sizeof(gpsUTC) - 1] = '\0';
        }

        /*
         * Campo 2 = status
         *
         * A = válido
         * V = inválido
         */
        if (fields[2][0] != 'A')
            return;

        /*
         * Campo 7 = velocidade em nós
         *
         * Conversão:
         *
         * 1 nó = 1,852 km/h
         */
        if (strlen(fields[7]) > 0)
        {
            velocidade =
                atof(fields[7]) * 1.852f;
        }

        /*
         * Campo 9 = data
         *
         * Formato:
         * DDMMYY
         */
        if (strlen(fields[9]) >= 6)
        {
            int dia;
            int mes;
            int ano;

            dia =
                (fields[9][0] - '0') * 10 +
                (fields[9][1] - '0');

            mes =
                (fields[9][2] - '0') * 10 +
                (fields[9][3] - '0');

            ano =
                (fields[9][4] - '0') * 10 +
                (fields[9][5] - '0');

            ano = 2000 + ano;

            sprintf(
                gpsDate,
                "%02d/%02d/%04d",
                dia,
                mes,
                ano
            );
        }
    }
}


/* ============================================================
   BLUETOOTH / HANDSHAKE DO COMPUTADOR
   ============================================================

   O computador envia:

   AA 55 01 FF

   O STM32 responde:

   AA 55 01 FF

   O celular não precisa enviar esse pacote.
   Ele continua recebendo as mensagens normalmente.
   ============================================================ */

void Bluetooth_Process(void)
{
    /*
     * Tenta receber apenas 1 byte.
     *
     * Timeout = 0:
     * se não houver byte, continua imediatamente.
     *
     * Isso evita que o Bluetooth atrapalhe
     * o GPS e o TSL2591.
     */
    if (HAL_UART_Receive(
            &huart1,
            &bluetoothByte,
            1,
            0
        ) != HAL_OK)
    {
        return;
    }

    /*
     * ============================================================
     * Estado 0
     * ============================================================
     *
     * Esperando o primeiro byte:
     *
     * AA
     */
    if (bluetoothEstado == 0)
    {
        if (bluetoothByte == 0xAA)
        {
            bluetoothEstado = 1;
        }

        return;
    }

    /*
     * ============================================================
     * Estado 1
     * ============================================================
     *
     * Já recebeu:
     *
     * AA
     *
     * Agora espera:
     *
     * 55
     */
    if (bluetoothEstado == 1)
    {
        if (bluetoothByte == 0x55)
        {
            bluetoothEstado = 2;
        }
        else if (bluetoothByte == 0xAA)
        {
            bluetoothEstado = 1;
        }
        else
        {
            bluetoothEstado = 0;
        }

        return;
    }

    /*
     * ============================================================
     * Estado 2
     * ============================================================
     *
     * Já recebeu:
     *
     * AA 55
     *
     * Agora espera:
     *
     * 01
     */
    if (bluetoothEstado == 2)
    {
        if (bluetoothByte == 0x01)
        {
            bluetoothEstado = 3;
        }
        else if (bluetoothByte == 0xAA)
        {
            bluetoothEstado = 1;
        }
        else
        {
            bluetoothEstado = 0;
        }

        return;
    }

    /*
     * ============================================================
     * Estado 3
     * ============================================================
     *
     * Já recebeu:
     *
     * AA 55 01
     *
     * Agora espera:
     *
     * FF
     */
    if (bluetoothEstado == 3)
    {
        if (bluetoothByte == 0xFF)
        {
            /*
             * Handshake completo!
             *
             * Responde exatamente:
             *
             * AA 55 01 FF
             */

            uint8_t resposta[4] =
            {
                0xAA,
                0x55,
                0x01,
                0xFF
            };

            HAL_UART_Transmit(
                &huart1,
                resposta,
                4,
                1000
            );
        }

        /*
         * Volta a procurar um novo pacote.
         */
        bluetoothEstado = 0;

        return;
    }

    /*
     * Segurança:
     * se alguma coisa inesperada acontecer,
     * reinicia o estado.
     */
    bluetoothEstado = 0;
}


/* Main ----------------------------------------------------------------------*/

int main(void)
{
    /* USER CODE BEGIN 1 */

    uint32_t ultimoSensor = 0;

    /* USER CODE END 1 */

    /* MCU Configuration--------------------------------------------------------*/

    HAL_Init();

    SystemClock_Config();

    /* Initialize all configured peripherals */

    MX_GPIO_Init();
    MX_I2C1_Init();
    MX_SPI1_Init();
    MX_USART1_UART_Init();
    MX_USART2_UART_Init();

    /* USER CODE BEGIN 2 */

    /*
     * Inicializa o TSL2591
     */
    if (TSL2591_Init() == HAL_OK)
    {
        sprintf(
            mensagem,
            "TSL2591 OK\r\n"
        );

        HAL_UART_Transmit(
            &huart1,
            (uint8_t *)mensagem,
            strlen(mensagem),
            1000
        );
    }
    else
    {
        sprintf(
            mensagem,
            "ERRO: TSL2591!\r\n"
        );

        HAL_UART_Transmit(
            &huart1,
            (uint8_t *)mensagem,
            strlen(mensagem),
            1000
        );
    }

    /*
     * Mensagem inicial
     */
    sprintf(
        mensagem,
        "Sistema iniciado!\r\n"
    );

    HAL_UART_Transmit(
        &huart1,
        (uint8_t *)mensagem,
        strlen(mensagem),
        1000
    );

    sprintf(
        mensagem,
        "NEO-M8N aguardando sinal...\r\n"
    );

    HAL_UART_Transmit(
        &huart1,
        (uint8_t *)mensagem,
        strlen(mensagem),
        1000
    );

    /* USER CODE END 2 */

    /* Infinite loop */

    while (1)
    {
        /* USER CODE BEGIN WHILE */

        /*
         * ============================================================
         * BLUETOOTH
         * ============================================================
         *
         * USART1 = Bluetooth
         *
         * Verifica se o computador enviou:
         *
         * AA 55 01 FF
         *
         * Se enviou, responde:
         *
         * AA 55 01 FF
         */
        Bluetooth_Process();


        /*
         * ============================================================
         * GPS
         * ============================================================
         *
         * USART2 = GPS
         * USART1 = Bluetooth
         */

        if (HAL_UART_Receive(
                &huart2,
                &gpsByte,
                1,
                10
            ) == HAL_OK)
        {
            /*
             * Começo de uma mensagem NMEA
             */
            if (gpsByte == '$')
            {
                gpsIndex = 0;

                gpsBuffer[gpsIndex] =
                    gpsByte;

                gpsIndex++;
            }

            else if (gpsIndex > 0)
            {
                /*
                 * Continua armazenando
                 */
                if (gpsIndex <
                    GPS_BUFFER_SIZE - 1)
                {
                    gpsBuffer[gpsIndex] =
                        gpsByte;

                    gpsIndex++;
                }
                else
                {
                    /*
                     * Buffer cheio
                     */
                    gpsIndex = 0;
                }

                /*
                 * Fim da mensagem
                 */
                if (gpsByte == '\n')
                {
                    gpsBuffer[gpsIndex] =
                        '\0';

                    /*
                     * Processa GPS
                     */
                    GPS_Process(
                        gpsBuffer
                    );

                    /*
                     * Se existe posição válida
                     */
                    if (gpsFix > 0)
                    {
                        if (strlen(gpsUTC) >= 6)
                        {
                            sprintf(
                                mensagem,

                                "GPS | Data: %s | UTC: %c%c:%c%c:%c%c | Lat: %.6f | Lon: %.6f | Vel: %.2f km/h | Sat: %d\r\n",

                                gpsDate,

                                gpsUTC[0],
                                gpsUTC[1],
                                gpsUTC[2],
                                gpsUTC[3],
                                gpsUTC[4],
                                gpsUTC[5],

                                latitude,
                                longitude,

                                velocidade,

                                gpsSatellites
                            );
                        }
                        else
                        {
                            sprintf(
                                mensagem,

                                "GPS | Data: %s | UTC: --:--:-- | Lat: %.6f | Lon: %.6f | Vel: %.2f km/h | Sat: %d\r\n",

                                gpsDate,

                                latitude,
                                longitude,

                                velocidade,

                                gpsSatellites
                            );
                        }

                        /*
                         * Envia para Bluetooth
                         */
                        HAL_UART_Transmit(
                            &huart1,
                            (uint8_t *)mensagem,
                            strlen(mensagem),
                            1000
                        );

                        gpsFix = 0;
                    }

                    /*
                     * Próxima mensagem
                     */
                    gpsIndex = 0;
                }
            }
        }


        /*
         * ============================================================
         * TSL2591
         * ============================================================
         *
         * Leitura aproximadamente a cada 1 segundo.
         */

        if ((HAL_GetTick() -
             ultimoSensor) >= 1000)
        {
            ultimoSensor =
                HAL_GetTick();

            /*
             * Lê os canais
             */
            if (TSL2591_ReadChannels(
                    &canal0,
                    &canal1
                ) == HAL_OK)
            {
                /*
                 * Calcula Lux
                 */
                lux =
                    TSL2591_CalculateLux(
                        canal0,
                        canal1
                    );

                /*
                 * Envia Lux
                 */
                sprintf(
                    mensagem,
                    "Lux: %.2f\r\n",
                    lux
                );

                HAL_UART_Transmit(
                    &huart1,
                    (uint8_t *)mensagem,
                    strlen(mensagem),
                    1000
                );
            }
            else
            {
                sprintf(
                    mensagem,
                    "ERRO: TSL2591 leitura!\r\n"
                );

                HAL_UART_Transmit(
                    &huart1,
                    (uint8_t *)mensagem,
                    strlen(mensagem),
                    1000
                );
            }
        }

        /* USER CODE END WHILE */

        /* USER CODE BEGIN 3 */

    }

    /* USER CODE END 3 */
}


/**
  * @brief System Clock Configuration
  * @retval None
  */
void SystemClock_Config(void)
{
    RCC_OscInitTypeDef RCC_OscInitStruct = {0};
    RCC_ClkInitTypeDef RCC_ClkInitStruct = {0};

    /** Initializes the RCC Oscillators according to the specified parameters
    * in the RCC_OscInitTypeDef structure.
    */

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

    if (HAL_RCC_OscConfig(
            &RCC_OscInitStruct
        ) != HAL_OK)
    {
        Error_Handler();
    }

    /** Initializes the CPU, AHB and APB buses clocks
    */

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

    if (HAL_RCC_ClockConfig(
            &RCC_ClkInitStruct,
            FLASH_LATENCY_2
        ) != HAL_OK)
    {
        Error_Handler();
    }
}


/**
  * @brief  This function is executed in case of error occurrence.
  * @retval None
  */
void Error_Handler(void)
{
    __disable_irq();

    while (1)
    {
    }
}

#ifdef USE_FULL_ASSERT

/**
  * @brief  Reports the name of the source file and the source line number
  *         where the assert_param error has occurred.
  */
void assert_failed(
    uint8_t *file,
    uint32_t line
)
{
    /* USER CODE BEGIN 6 */

    /* User can add your own implementation */

    /* USER CODE END 6 */
}

#endif /* USE_FULL_ASSERT */
