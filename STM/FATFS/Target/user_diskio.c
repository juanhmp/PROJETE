/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file    user_diskio.c
  * @brief   Disk IO SPI driver for FatFs
  ******************************************************************************
  */
/* USER CODE END Header */

#include "ff_gen_drv.h"
#include "spi.h"
#include "gpio.h"
#include "main.h"


/* ==========================================================================
   DEFINES
   ========================================================================== */

#define SD_SPI hspi1

#define SD_CS_LOW() \
    HAL_GPIO_WritePin(SD_CS_GPIO_Port, SD_CS_Pin, GPIO_PIN_RESET)

#define SD_CS_HIGH() \
    HAL_GPIO_WritePin(SD_CS_GPIO_Port, SD_CS_Pin, GPIO_PIN_SET)


#define CMD0                  0
#define CMD1                  1
#define CMD8                  8
#define CMD9                  9
#define CMD12                12
#define CMD16                16
#define CMD17                17
#define CMD18                18
#define CMD23                23
#define CMD24                24
#define CMD25                25
#define CMD55                55
#define CMD58                58
#define ACMD41               41

#define SD_TOKEN_START_BLOCK 0xFE


/* ==========================================================================
   VARIAVEIS
   ========================================================================== */

static volatile DSTATUS Stat = STA_NOINIT;

/*
 * 0 = desconhecido
 * 1 = SDSC
 * 2 = SDHC / SDXC
 */
static uint8_t SD_Type = 0;


/* ==========================================================================
   PROTOTIPOS
   ========================================================================== */

static uint8_t SD_SPI_TxRx(
    uint8_t data
);

static void SD_SPI_SetSlow(void);

static void SD_SPI_SetFast(void);

static uint8_t SD_SendCommand(
    uint8_t cmd,
    uint32_t arg
);

static DRESULT SD_ReadBlock(
    BYTE *buff,
    DWORD sector
);

static DRESULT SD_WriteBlock(
    const BYTE *buff,
    DWORD sector
);


/* ==========================================================================
   SPI - TRANSMITE E RECEBE 1 BYTE
   ========================================================================== */

static uint8_t SD_SPI_TxRx(
    uint8_t data
)
{
    uint8_t rxData = 0xFF;


    /*
     * Nenhuma mensagem e enviada pela UART.
     *
     * O Bluetooth fica reservado exclusivamente
     * para os dados de Lux e GPS enviados pelo main.c.
     */

    if (
        HAL_SPI_TransmitReceive(
            &SD_SPI,
            &data,
            &rxData,
            1,
            100
        ) != HAL_OK
    )
    {
        return 0xFF;
    }


    return rxData;
}


/* ==========================================================================
   SPI - VELOCIDADE LENTA PARA INICIALIZACAO
   ========================================================================== */

static void SD_SPI_SetSlow(void)
{
    __HAL_SPI_DISABLE(
        &SD_SPI
    );


    MODIFY_REG(
        SD_SPI.Instance->CR1,
        SPI_CR1_BR,
        SPI_BAUDRATEPRESCALER_256
    );


    __HAL_SPI_ENABLE(
        &SD_SPI
    );
}


/* ==========================================================================
   SPI - VELOCIDADE RAPIDA PARA OPERACAO NORMAL
   ========================================================================== */

static void SD_SPI_SetFast(void)
{
    __HAL_SPI_DISABLE(
        &SD_SPI
    );


    MODIFY_REG(
        SD_SPI.Instance->CR1,
        SPI_CR1_BR,
        SPI_BAUDRATEPRESCALER_8
    );


    __HAL_SPI_ENABLE(
        &SD_SPI
    );
}


/* ==========================================================================
   ENVIO DE COMANDO AO CARTAO SD
   ========================================================================== */

static uint8_t SD_SendCommand(
    uint8_t cmd,
    uint32_t arg
)
{
    uint8_t response;

    uint8_t crc = 0x01;


    /*
     * Libera o cartao antes de iniciar
     * um novo comando.
     */

    SD_CS_HIGH();


    SD_SPI_TxRx(
        0xFF
    );


    /*
     * Seleciona o cartao.
     */

    SD_CS_LOW();


    SD_SPI_TxRx(
        0xFF
    );


    /*
     * CRC obrigatorio durante inicializacao
     * para CMD0 e CMD8.
     */

    if (
        cmd == CMD0
    )
    {
        crc = 0x95;
    }

    else if (
        cmd == CMD8
    )
    {
        crc = 0x87;
    }


    /*
     * Byte do comando.
     */

    SD_SPI_TxRx(
        0x40 | cmd
    );


    /*
     * Argumento de 32 bits.
     */

    SD_SPI_TxRx(
        (uint8_t)(arg >> 24)
    );


    SD_SPI_TxRx(
        (uint8_t)(arg >> 16)
    );


    SD_SPI_TxRx(
        (uint8_t)(arg >> 8)
    );


    SD_SPI_TxRx(
        (uint8_t)arg
    );


    /*
     * CRC.
     */

    SD_SPI_TxRx(
        crc
    );


    /*
     * Aguarda resposta R1.
     */

    for (
        uint16_t i = 0;
        i < 100;
        i++
    )
    {
        response =
            SD_SPI_TxRx(
                0xFF
            );


        if (
            (response & 0x80) == 0
        )
        {
            return response;
        }
    }


    return 0xFF;
}


/* ==========================================================================
   LEITURA DE UM SETOR
   ========================================================================== */

static DRESULT SD_ReadBlock(
    BYTE *buff,
    DWORD sector
)
{
    uint8_t token = 0xFF;

    uint8_t resposta;

    uint32_t address;


    /*
     * SDHC/SDXC utiliza endereco por setor.
     *
     * SDSC utiliza endereco por byte.
     */

    if (
        SD_Type == 2
    )
    {
        address =
            sector;
    }

    else
    {
        address =
            sector * 512UL;
    }


    /*
     * CMD17 = leitura de um bloco.
     */

    resposta =
        SD_SendCommand(
            CMD17,
            address
        );


    if (
        resposta != 0x00
    )
    {
        SD_CS_HIGH();


        SD_SPI_TxRx(
            0xFF
        );


        return RES_ERROR;
    }


    /*
     * Aguarda token 0xFE indicando
     * inicio dos dados.
     */

    for (
        uint32_t timeout = 0;
        timeout < 100000;
        timeout++
    )
    {
        token =
            SD_SPI_TxRx(
                0xFF
            );


        if (
            token == SD_TOKEN_START_BLOCK
        )
        {
            break;
        }


        if (
            token != 0xFF
        )
        {
            break;
        }
    }


    if (
        token != SD_TOKEN_START_BLOCK
    )
    {
        SD_CS_HIGH();


        SD_SPI_TxRx(
            0xFF
        );


        return RES_ERROR;
    }


    /*
     * Le os 512 bytes do setor.
     */

    for (
        uint16_t i = 0;
        i < 512;
        i++
    )
    {
        buff[i] =
            SD_SPI_TxRx(
                0xFF
            );
    }


    /*
     * Descarta os dois bytes de CRC.
     */

    SD_SPI_TxRx(
        0xFF
    );


    SD_SPI_TxRx(
        0xFF
    );


    /*
     * Libera o cartao.
     */

    SD_CS_HIGH();


    SD_SPI_TxRx(
        0xFF
    );


    return RES_OK;
}


/* ==========================================================================
   GRAVACAO DE UM SETOR
   ========================================================================== */

static DRESULT SD_WriteBlock(
    const BYTE *buff,
    DWORD sector
)
{
    uint8_t response;

    uint8_t pronto = 0;

    uint32_t address;


    /*
     * SDHC/SDXC utiliza endereco por setor.
     *
     * SDSC utiliza endereco por byte.
     */

    if (
        SD_Type == 2
    )
    {
        address =
            sector;
    }

    else
    {
        address =
            sector * 512UL;
    }


    /*
     * CMD24 = grava um bloco.
     */

    if (
        SD_SendCommand(
            CMD24,
            address
        ) != 0x00
    )
    {
        SD_CS_HIGH();


        SD_SPI_TxRx(
            0xFF
        );


        return RES_ERROR;
    }


    /*
     * Byte extra antes do token.
     */

    SD_SPI_TxRx(
        0xFF
    );


    /*
     * Token de inicio do bloco.
     */

    SD_SPI_TxRx(
        SD_TOKEN_START_BLOCK
    );


    /*
     * Envia os 512 bytes.
     */

    for (
        uint16_t i = 0;
        i < 512;
        i++
    )
    {
        SD_SPI_TxRx(
            buff[i]
        );
    }


    /*
     * CRC dummy.
     */

    SD_SPI_TxRx(
        0xFF
    );


    SD_SPI_TxRx(
        0xFF
    );


    /*
     * Resposta da gravacao.
     */

    response =
        SD_SPI_TxRx(
            0xFF
        );


    /*
     * 0x05 nos 5 bits inferiores
     * significa DATA ACCEPTED.
     */

    if (
        (response & 0x1F) != 0x05
    )
    {
        SD_CS_HIGH();


        SD_SPI_TxRx(
            0xFF
        );


        return RES_ERROR;
    }


    /*
     * Aguarda o cartao terminar
     * a gravacao interna.
     */

    for (
        uint32_t timeout = 0;
        timeout < 500000;
        timeout++
    )
    {
        response =
            SD_SPI_TxRx(
                0xFF
            );


        if (
            response == 0xFF
        )
        {
            pronto = 1;

            break;
        }
    }


    /*
     * Libera o cartao.
     */

    SD_CS_HIGH();


    SD_SPI_TxRx(
        0xFF
    );


    if (
        !pronto
    )
    {
        return RES_ERROR;
    }


    return RES_OK;
}


/* USER CODE BEGIN 1 */

/* USER CODE END 1 */


/* ==========================================================================
   FATFS - INICIALIZACAO
   ========================================================================== */

DSTATUS USER_initialize(
    BYTE lun
)
{
    uint8_t response;

    uint8_t ocr[4];

    uint8_t initialized = 0;


    (void)lun;


    /*
     * Comeca como nao inicializado.
     */

    Stat =
        STA_NOINIT;


    SD_Type =
        0;


    /*
     * Inicializacao deve ocorrer
     * com SPI lento.
     */

    SD_SPI_SetSlow();


    /*
     * CS alto.
     */

    SD_CS_HIGH();


    /*
     * Gera clocks iniciais.
     */

    SD_SPI_TxRx(
        0xFF
    );


    SD_SPI_TxRx(
        0xFF
    );


    /*
     * Pelo menos 80 clocks com CS alto.
     */

    for (
        uint8_t i = 0;
        i < 10;
        i++
    )
    {
        SD_SPI_TxRx(
            0xFF
        );
    }


    /*
     * ================================================================
     * CMD0
     * ================================================================
     *
     * Coloca o cartao em IDLE.
     */

    response =
        0xFF;


    for (
        uint8_t tentativa = 0;
        tentativa < 10;
        tentativa++
    )
    {
        response =
            SD_SendCommand(
                CMD0,
                0
            );


        if (
            response == 0x01
        )
        {
            break;
        }


        SD_CS_HIGH();


        SD_SPI_TxRx(
            0xFF
        );


        HAL_Delay(
            20
        );
    }


    if (
        response != 0x01
    )
    {
        SD_CS_HIGH();


        SD_SPI_TxRx(
            0xFF
        );


        return Stat;
    }


    SD_CS_HIGH();


    SD_SPI_TxRx(
        0xFF
    );


    /*
     * ================================================================
     * CMD8
     * ================================================================
     *
     * Detecta SD versao 2.
     */

    response =
        SD_SendCommand(
            CMD8,
            0x000001AA
        );


    /*
     * ================================================================
     * SD V2
     * ================================================================
     */

    if (
        response == 0x01
    )
    {
        /*
         * Recebe R7.
         */

        ocr[0] =
            SD_SPI_TxRx(
                0xFF
            );


        ocr[1] =
            SD_SPI_TxRx(
                0xFF
            );


        ocr[2] =
            SD_SPI_TxRx(
                0xFF
            );


        ocr[3] =
            SD_SPI_TxRx(
                0xFF
            );


        SD_CS_HIGH();


        SD_SPI_TxRx(
            0xFF
        );


        /*
         * Verifica padrao 0x1AA.
         */

        if (
            ocr[2] != 0x01 ||
            ocr[3] != 0xAA
        )
        {
            return Stat;
        }


        /*
         * ============================================================
         * ACMD41
         * ============================================================
         */

        initialized =
            0;


        for (
            uint32_t timeout = 0;
            timeout < 2000;
            timeout++
        )
        {
            /*
             * CMD55 informa que o proximo
             * comando sera um ACMD.
             */

            response =
                SD_SendCommand(
                    CMD55,
                    0
                );


            SD_CS_HIGH();


            SD_SPI_TxRx(
                0xFF
            );


            /*
             * HCS = bit 30.
             */

            response =
                SD_SendCommand(
                    ACMD41,
                    0x40000000
                );


            SD_CS_HIGH();


            SD_SPI_TxRx(
                0xFF
            );


            if (
                response == 0x00
            )
            {
                initialized =
                    1;


                break;
            }


            HAL_Delay(
                1
            );
        }


        if (
            !initialized
        )
        {
            return Stat;
        }


        /*
         * ============================================================
         * CMD58
         * ============================================================
         *
         * Le OCR e identifica SDHC/SDXC.
         */

        response =
            SD_SendCommand(
                CMD58,
                0
            );


        if (
            response != 0x00
        )
        {
            SD_CS_HIGH();


            SD_SPI_TxRx(
                0xFF
            );


            return Stat;
        }


        ocr[0] =
            SD_SPI_TxRx(
                0xFF
            );


        ocr[1] =
            SD_SPI_TxRx(
                0xFF
            );


        ocr[2] =
            SD_SPI_TxRx(
                0xFF
            );


        ocr[3] =
            SD_SPI_TxRx(
                0xFF
            );


        SD_CS_HIGH();


        SD_SPI_TxRx(
            0xFF
        );


        /*
         * CCS = bit 30 do OCR.
         */

        if (
            ocr[0] & 0x40
        )
        {
            /*
             * SDHC ou SDXC.
             */

            SD_Type =
                2;
        }

        else
        {
            /*
             * SDSC.
             */

            SD_Type =
                1;
        }
    }


    /*
     * ================================================================
     * SD V1 / MMC
     * ================================================================
     */

    else
    {
        SD_CS_HIGH();


        SD_SPI_TxRx(
            0xFF
        );


        initialized =
            0;


        /*
         * Primeiro tenta ACMD41.
         */

        for (
            uint32_t timeout = 0;
            timeout < 2000;
            timeout++
        )
        {
            response =
                SD_SendCommand(
                    CMD55,
                    0
                );


            SD_CS_HIGH();


            SD_SPI_TxRx(
                0xFF
            );


            response =
                SD_SendCommand(
                    ACMD41,
                    0
                );


            SD_CS_HIGH();


            SD_SPI_TxRx(
                0xFF
            );


            if (
                response == 0x00
            )
            {
                initialized =
                    1;


                SD_Type =
                    1;


                break;
            }


            HAL_Delay(
                1
            );
        }


        /*
         * Se ACMD41 falhar,
         * tenta CMD1 para MMC.
         */

        if (
            !initialized
        )
        {
            for (
                uint32_t timeout = 0;
                timeout < 2000;
                timeout++
            )
            {
                response =
                    SD_SendCommand(
                        CMD1,
                        0
                    );


                SD_CS_HIGH();


                SD_SPI_TxRx(
                    0xFF
                );


                if (
                    response == 0x00
                )
                {
                    initialized =
                        1;


                    SD_Type =
                        1;


                    break;
                }


                HAL_Delay(
                    1
                );
            }
        }


        if (
            !initialized
        )
        {
            return Stat;
        }
    }


    /*
     * ================================================================
     * CMD16 PARA SDSC
     * ================================================================
     *
     * Define bloco de 512 bytes.
     */

    if (
        SD_Type == 1
    )
    {
        response =
            SD_SendCommand(
                CMD16,
                512
            );


        SD_CS_HIGH();


        SD_SPI_TxRx(
            0xFF
        );


        if (
            response != 0x00
        )
        {
            return Stat;
        }
    }


    /*
     * Inicializacao concluida.
     */

    Stat &=
        ~STA_NOINIT;


    /*
     * Agora pode usar SPI rapido.
     */

    SD_SPI_SetFast();


    return Stat;
}


/* ==========================================================================
   FATFS - STATUS
   ========================================================================== */

DSTATUS USER_status(
    BYTE lun
)
{
    (void)lun;


    return Stat;
}


/* ==========================================================================
   FATFS - LEITURA
   ========================================================================== */

DRESULT USER_read(
    BYTE lun,
    BYTE *buff,
    DWORD sector,
    UINT count
)
{
    (void)lun;


    /*
     * Cartao ainda nao inicializado.
     */

    if (
        Stat & STA_NOINIT
    )
    {
        return RES_NOTRDY;
    }


    /*
     * Parametros invalidos.
     */

    if (
        buff == NULL ||
        count == 0
    )
    {
        return RES_PARERR;
    }


    /*
     * Le todos os setores solicitados.
     */

    while (
        count--
    )
    {
        if (
            SD_ReadBlock(
                buff,
                sector
            ) != RES_OK
        )
        {
            return RES_ERROR;
        }


        buff +=
            512;


        sector++;
    }


    return RES_OK;
}


/* ==========================================================================
   FATFS - GRAVACAO
   ========================================================================== */

#if _USE_WRITE == 1

DRESULT USER_write(
    BYTE lun,
    const BYTE *buff,
    DWORD sector,
    UINT count
)
{
    (void)lun;


    /*
     * Cartao nao inicializado.
     */

    if (
        Stat & STA_NOINIT
    )
    {
        return RES_NOTRDY;
    }


    /*
     * Parametros invalidos.
     */

    if (
        buff == NULL ||
        count == 0
    )
    {
        return RES_PARERR;
    }


    /*
     * Grava todos os setores solicitados.
     */

    while (
        count--
    )
    {
        if (
            SD_WriteBlock(
                buff,
                sector
            ) != RES_OK
        )
        {
            return RES_ERROR;
        }


        buff +=
            512;


        sector++;
    }


    return RES_OK;
}

#endif /* _USE_WRITE == 1 */


/* ==========================================================================
   FATFS - IOCTL
   ========================================================================== */

#if _USE_IOCTL == 1

DRESULT USER_ioctl(
    BYTE lun,
    BYTE cmd,
    void *buff
)
{
    DRESULT result =
        RES_OK;


    (void)lun;


    /*
     * Cartao nao inicializado.
     */

    if (
        Stat & STA_NOINIT
    )
    {
        return RES_NOTRDY;
    }


    switch (
        cmd
    )
    {
        /* ==============================================================
           SINCRONIZACAO
           ============================================================== */

        case CTRL_SYNC:
        {
            uint8_t pronto =
                0;


            SD_CS_LOW();


            /*
             * Espera o cartao deixar
             * o estado BUSY.
             */

            for (
                uint32_t timeout = 0;
                timeout < 500000;
                timeout++
            )
            {
                if (
                    SD_SPI_TxRx(
                        0xFF
                    ) == 0xFF
                )
                {
                    pronto =
                        1;


                    break;
                }
            }


            SD_CS_HIGH();


            SD_SPI_TxRx(
                0xFF
            );


            if (
                !pronto
            )
            {
                return RES_ERROR;
            }


            result =
                RES_OK;


            break;
        }


        /* ==============================================================
           QUANTIDADE TOTAL DE SETORES
           ============================================================== */

        case GET_SECTOR_COUNT:
        {
            uint8_t csd[16];

            uint8_t token =
                0xFF;

            uint8_t csdVersion;

            uint32_t sectorCount =
                0;


            /*
             * CMD9 = leitura do CSD.
             */

            if (
                SD_SendCommand(
                    CMD9,
                    0
                ) != 0x00
            )
            {
                SD_CS_HIGH();


                SD_SPI_TxRx(
                    0xFF
                );


                return RES_ERROR;
            }


            /*
             * Aguarda token de dados.
             */

            for (
                uint32_t timeout = 0;
                timeout < 100000;
                timeout++
            )
            {
                token =
                    SD_SPI_TxRx(
                        0xFF
                    );


                if (
                    token == SD_TOKEN_START_BLOCK
                )
                {
                    break;
                }
            }


            if (
                token != SD_TOKEN_START_BLOCK
            )
            {
                SD_CS_HIGH();


                SD_SPI_TxRx(
                    0xFF
                );


                return RES_ERROR;
            }


            /*
             * Le CSD.
             */

            for (
                uint8_t i = 0;
                i < 16;
                i++
            )
            {
                csd[i] =
                    SD_SPI_TxRx(
                        0xFF
                    );
            }


            /*
             * Descarta CRC.
             */

            SD_SPI_TxRx(
                0xFF
            );


            SD_SPI_TxRx(
                0xFF
            );


            SD_CS_HIGH();


            SD_SPI_TxRx(
                0xFF
            );


            /*
             * Identifica versao do CSD.
             */

            csdVersion =
                (csd[0] >> 6) &
                0x03;


            /*
             * ==========================================================
             * CSD V2 - SDHC/SDXC
             * ==========================================================
             */

            if (
                csdVersion == 1
            )
            {
                uint32_t cSize;


                cSize =
                    ((uint32_t)(csd[7] & 0x3F) << 16) |
                    ((uint32_t)csd[8] << 8) |
                    csd[9];


                sectorCount =
                    (cSize + 1UL) *
                    1024UL;
            }


            /*
             * ==========================================================
             * CSD V1 - SDSC
             * ==========================================================
             */

            else
            {
                uint32_t cSize;

                uint8_t cSizeMult;

                uint8_t readBlLen;

                uint32_t blockLength;

                uint32_t mult;

                uint32_t blockCount;

                uint32_t capacity;


                cSize =
                    ((uint32_t)(csd[6] & 0x03) << 10) |
                    ((uint32_t)csd[7] << 2) |
                    ((uint32_t)(csd[8] >> 6) & 0x03);


                cSizeMult =
                    ((csd[9] & 0x03) << 1) |
                    ((csd[10] >> 7) & 0x01);


                readBlLen =
                    csd[5] &
                    0x0F;


                blockLength =
                    1UL <<
                    readBlLen;


                mult =
                    1UL <<
                    (cSizeMult + 2);


                blockCount =
                    (cSize + 1UL) *
                    mult;


                capacity =
                    blockCount *
                    blockLength;


                sectorCount =
                    capacity /
                    512UL;
            }


            /*
             * Evita valor zero invalido.
             */

            if (
                sectorCount == 0
            )
            {
                sectorCount =
                    1;
            }


            *(DWORD *)buff =
                sectorCount;


            result =
                RES_OK;


            break;
        }


        /* ==============================================================
           TAMANHO DO SETOR
           ============================================================== */

        case GET_SECTOR_SIZE:
        {
            *(WORD *)buff =
                512;


            result =
                RES_OK;


            break;
        }


        /* ==============================================================
           TAMANHO DO BLOCO DE APAGAMENTO
           ============================================================== */

        case GET_BLOCK_SIZE:
        {
            *(DWORD *)buff =
                1;


            result =
                RES_OK;


            break;
        }


        /* ==============================================================
           TRIM
           ============================================================== */

        case CTRL_TRIM:
        {
            result =
                RES_OK;


            break;
        }


        /* ==============================================================
           COMANDO DESCONHECIDO
           ============================================================== */

        default:
        {
            result =
                RES_PARERR;


            break;
        }
    }


    return result;
}

#endif /* _USE_IOCTL */


/* ==========================================================================
   ESTRUTURA DO DRIVER FATFS
   ========================================================================== */

Diskio_drvTypeDef USER_Driver =
{
    USER_initialize,
    USER_status,
    USER_read,
    USER_write,
    USER_ioctl
};
