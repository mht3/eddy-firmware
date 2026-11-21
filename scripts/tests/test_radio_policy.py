"""Host regression tests for factory region checks, both drivers and decoded storage.

Run with python3 scripts/tests/test_radio_policy.py. A local C compiler is required.
Only SPI register and storage callbacks are simulated. No radio is opened.
"""

import os
import re
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HAL = ROOT / "targets/f7/furi_hal/furi_hal_subghz.c"
EXT = ROOT / "applications/drivers/subghz/cc1101_ext/cc1101_ext.c"
CHIP = ROOT / "lib/drivers/cc1101.c"
BASE = ROOT / "lib/subghz/protocols/base.c"


def function(path, name):
    # Compile the production function with host substitutes for ARM-only device peripherals.
    pattern = (
        r"^(?:bool|void|uint32_t|SubGhzTx|SubGhzProtocolStatus) " + name + r"\(.*?^\}"
    )
    match = re.search(pattern, path.read_text(), re.MULTILINE | re.DOTALL)
    assert match, name
    return match.group(0)


class RadioPolicyTest(unittest.TestCase):
    def test_registered_protocols(self):
        checked = set()
        for path in (ROOT / "lib/subghz/protocols").glob("*.c"):
            text = path.read_text()
            for descriptor in re.findall(
                r"const SubGhzProtocol \w+ = \{.*?\n\};", text, re.S
            ):
                if not re.search(
                    r"\.type = SubGhzProtocolType(?:Dynamic|BinRAW)", descriptor
                ):
                    continue
                with self.subTest(protocol=path.stem):
                    self.assertNotRegex(
                        descriptor, r"SubGhzProtocolFlag_(Save|Load|Send)"
                    )
                    self.assertIn(".encoder = NULL", descriptor)
                    decoder = re.search(r"\.decoder = &(\w+)", descriptor)[1]
                    callbacks = re.search(
                        r"const SubGhzProtocolDecoder "
                        + re.escape(decoder)
                        + r" = \{.*?\n\};",
                        text,
                        re.S,
                    )[0]
                    self.assertIn(".serialize = NULL", callbacks)
                    self.assertIn(".deserialize = NULL", callbacks)
                    checked.add(path.stem)
        self.assertTrue({"keeloq", "secplus_v2", "bin_raw"}.issubset(checked))

    def test_region_carrier_and_storage(self):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            (work / "furi.h").write_text(
                "#include <stdlib.h>\n#define COUNT_OF(x) (sizeof(x) / sizeof((x)[0]))\n"
            )
            (work / "furi_hal_version.h").write_text(
                """
typedef enum {FuriHalVersionRegionUnknown, FuriHalVersionRegionEuRu, FuriHalVersionRegionUsCaAu,
    FuriHalVersionRegionJp, FuriHalVersionRegionWorld} FuriHalVersionRegion;
FuriHalVersionRegion furi_hal_version_get_hw_region(void);
"""
            )
            functions = [
                function(CHIP, "cc1101_write_preset_reg"),
                function(CHIP, "cc1101_get_tx_frequency"),
                function(HAL, "furi_hal_subghz_is_frequency_valid"),
                function(HAL, "furi_hal_subghz_check_tx"),
                function(HAL, "furi_hal_subghz_is_tx_allowed"),
                function(EXT, "subghz_device_cc1101_ext_check_tx"),
                function(HAL, "furi_hal_subghz_tx"),
                function(EXT, "subghz_device_cc1101_ext_tx"),
                function(BASE, "subghz_protocol_decoder_base_serialize"),
            ]
            (work / "test.c").write_text(MOCKS + "\n".join(functions) + CHECKS)
            subprocess.run(
                [
                    os.environ.get("CC", "cc"),
                    "-std=gnu11",
                    "-Wall",
                    "-Werror",
                    "-I",
                    str(work),
                    "-I",
                    str(ROOT / "targets/furi_hal_include"),
                    "-I",
                    str(ROOT),
                    str(work / "test.c"),
                    str(ROOT / "targets/f7/furi_hal/furi_hal_region.c"),
                    "-o",
                    str(work / "test"),
                ],
                check=True,
            )
            subprocess.run([str(work / "test")], check=True)


MOCKS = """
#include <assert.h>
#include <stdlib.h>
#include <furi_hal_region.h>
#include <furi_hal_version.h>
#include "lib/drivers/cc1101_regs.h"
#include "lib/subghz/devices/tx.h"

static FuriHalVersionRegion region;
FuriHalVersionRegion furi_hal_version_get_hw_region(void) { return region; }

typedef struct { uint8_t regs[256]; bool locked; unsigned tx; } FuriHalSpiBusHandle;
static FuriHalSpiBusHandle furi_hal_spi_bus_handle_subghz, external;
enum { SubGhzRegulationTxRx = 1, SubGhzDeviceCC1101ExtRegulationTxRx = 1 };
static struct { unsigned regulation; } furi_hal_subghz;
static struct { unsigned regulation; FuriHalSpiBusHandle* spi_bus_handle; bool amp_and_leds; }
    ext_state = {0, &external, false}, *subghz_device_cc1101_ext = &ext_state;
#define furi_check assert
#define furi_hal_spi_acquire(h) do { assert(!(h)->locked); (h)->locked = true; } while(0)
#define furi_hal_spi_release(h) do { assert((h)->locked); (h)->locked = false; } while(0)
#define cc1101_read_reg(h, r, out) (*(out) = (h)->regs[r])
#define cc1101_write_reg(h, r, value) (((FuriHalSpiBusHandle*)(h))->regs[r] = (value))
#define cc1101_switch_to_tx(h) do { assert((h)->locked); (h)->tx++; } while(0)
#define cc1101_wait_status_state(h, state, timeout) ((h)->locked)
#define furi_hal_gpio_write(pin, value) ((void)0)

typedef enum {SubGhzProtocolTypeStatic, SubGhzProtocolTypeDynamic, SubGhzProtocolTypeBinRAW}
    SubGhzProtocolType;
typedef enum {SubGhzProtocolStatusError, SubGhzProtocolStatusOk} SubGhzProtocolStatus;
typedef struct { unsigned writes; } FlipperFormat;
typedef struct { int unused; } SubGhzRadioPreset;
typedef struct SubGhzProtocolDecoderBase SubGhzProtocolDecoderBase;
typedef struct {
    SubGhzProtocolStatus (*serialize)(SubGhzProtocolDecoderBase*, FlipperFormat*, SubGhzRadioPreset*);
} Decoder;
typedef struct { SubGhzProtocolType type; Decoder* decoder; } Protocol;
struct SubGhzProtocolDecoderBase { Protocol* protocol; };
static SubGhzProtocolStatus store(SubGhzProtocolDecoderBase* d, FlipperFormat* f, SubGhzRadioPreset* p) {
    (void)d; (void)p; f->writes++; return SubGhzProtocolStatusOk;
}

static void program(FuriHalSpiBusHandle* chip, uint32_t hz) {
    uint32_t word = (uint64_t)hz * CC1101_FDIV / CC1101_QUARTZ;
    chip->regs[CC1101_FREQ2] = word >> 16;
    chip->regs[CC1101_FREQ1] = word >> 8;
    chip->regs[CC1101_FREQ0] = word;
}
"""

CHECKS = """
int main(void) {
    // A syntactically valid writable region with an all-band entry grants nothing.
    FuriHalRegion* file = calloc(1, sizeof(FuriHalRegion) + sizeof(FuriHalRegionBand));
    file->bands_count = 1; file->bands[0].end = 1000000000;
    furi_hal_region_set(file);
    assert(furi_hal_subghz_check_tx(433920000) == SubGhzTxBlockedRegionNotProvisioned);
    region = FuriHalVersionRegionWorld;
    assert(subghz_device_cc1101_ext_check_tx(433920000) == SubGhzTxBlockedRegionNotProvisioned);
    region = (FuriHalVersionRegion)255;
    assert(!furi_hal_region_is_provisioned());
    region = FuriHalVersionRegionEuRu;
    assert(furi_hal_subghz_check_tx(433050000) == SubGhzTxAllowed);
    assert(furi_hal_subghz_check_tx(434790000) == SubGhzTxAllowed);
    assert(furi_hal_subghz_check_tx(434790001) == SubGhzTxBlockedRegion);
    assert(subghz_device_cc1101_ext_check_tx(915000000) == SubGhzTxBlockedRegion);
    assert(furi_hal_subghz_check_tx(480000000) == SubGhzTxUnsupported);
    region = FuriHalVersionRegionUsCaAu;
    assert(subghz_device_cc1101_ext_check_tx(915000000) == SubGhzTxAllowed);
    region = FuriHalVersionRegionJp;
    assert(!furi_hal_subghz_is_tx_allowed(433920000));

    region = FuriHalVersionRegionEuRu;
    program(&external, 433920000); program(&furi_hal_spi_bus_handle_subghz, 433920000);
    assert(!subghz_device_cc1101_ext_tx() && !furi_hal_subghz_tx());
    ext_state.regulation = furi_hal_subghz.regulation = 1;
    assert(subghz_device_cc1101_ext_tx() && furi_hal_subghz_tx());
    // A stale permission cannot authorize a retuned chip.
    program(&external, 915000000); program(&furi_hal_spi_bus_handle_subghz, 915000000);
    assert(!subghz_device_cc1101_ext_tx() && !furi_hal_subghz_tx());
    assert(external.tx == 1 && furi_hal_spi_bus_handle_subghz.tx == 1);
    program(&external, 433920000); external.regs[CC1101_CHANNR] = 1;
    assert(!subghz_device_cc1101_ext_tx());
    external.regs[CC1101_CHANNR] = 0; external.regs[CC1101_FSCTRL0] = 1;
    assert(!subghz_device_cc1101_ext_tx());
    cc1101_write_preset_reg(&external, CC1101_STROBE_STX, 0xff);
    assert(external.regs[CC1101_STROBE_STX] == 0);
    cc1101_write_preset_reg(&external, CC1101_MCSM1, 0x3f);
    assert(external.regs[CC1101_MCSM1] == 0x30);
    assert(!external.locked && !furi_hal_spi_bus_handle_subghz.locked);

    Decoder methods = {store};
    Protocol protocol = {SubGhzProtocolTypeDynamic, &methods};
    SubGhzProtocolDecoderBase decoder = {&protocol};
    FlipperFormat destination = {0};
    assert(subghz_protocol_decoder_base_serialize(&decoder, &destination, NULL) == SubGhzProtocolStatusError);
    protocol.type = SubGhzProtocolTypeBinRAW;
    assert(subghz_protocol_decoder_base_serialize(&decoder, &destination, NULL) == SubGhzProtocolStatusError);
    assert(!destination.writes);
    protocol.type = SubGhzProtocolTypeStatic;
    assert(subghz_protocol_decoder_base_serialize(&decoder, &destination, NULL) == SubGhzProtocolStatusOk);
    assert(destination.writes == 1);
    return 0;
}
"""

if __name__ == "__main__":
    unittest.main()
