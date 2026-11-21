#include <furi_hal_region.h>
#include <furi_hal_version.h>
#include <furi.h>

const FuriHalRegion furi_hal_region_eu_ru = {
    .country_code = "EU",
    .bands_count = 2,
    .bands = {
        {
            .start = 433050000,
            .end = 434790000,
            .power_limit = 12,
            .duty_cycle = 50,
        },
        {
            .start = 868150000,
            .end = 868550000,
            .power_limit = 12,
            .duty_cycle = 50,
        }}};

const FuriHalRegion furi_hal_region_us_ca_au = {
    .country_code = "US",
    .bands_count = 3,
    .bands = {
        {
            .start = 304100000,
            .end = 321950000,
            .power_limit = 12,
            .duty_cycle = 50,
        },
        {
            .start = 433050000,
            .end = 434790000,
            .power_limit = 12,
            .duty_cycle = 50,
        },
        {
            .start = 915000000,
            .end = 928000000,
            .power_limit = 12,
            .duty_cycle = 50,
        }}};

const FuriHalRegion furi_hal_region_jp = {
    .country_code = "JP",
    .bands_count = 2,
    .bands = {
        {
            .start = 312000000,
            .end = 315250000,
            .power_limit = 12,
            .duty_cycle = 50,
        },
        {
            .start = 920500000,
            .end = 923500000,
            .power_limit = 12,
            .duty_cycle = 50,
        }}};

static const FuriHalRegion* const furi_hal_static_regions[] = {
    [FuriHalVersionRegionUnknown] = NULL,
    [FuriHalVersionRegionEuRu] = &furi_hal_region_eu_ru,
    [FuriHalVersionRegionUsCaAu] = &furi_hal_region_us_ca_au,
    [FuriHalVersionRegionJp] = &furi_hal_region_jp,
};

void furi_hal_region_init(void) {
    // Factory region tables are immutable and require no initialization.
}

const FuriHalRegion* furi_hal_region_get(void) {
    unsigned int region = furi_hal_version_get_hw_region();
    return region < COUNT_OF(furi_hal_static_regions) ? furi_hal_static_regions[region] : NULL;
}

void furi_hal_region_set(FuriHalRegion* region) {
    // Older SDK callers transfer ownership. Writable data cannot authorize radio transmission.
    free(region);
}

bool furi_hal_region_is_provisioned(void) {
    return furi_hal_region_get() != NULL;
}

const char* furi_hal_region_get_name(void) {
    const FuriHalRegion* region = furi_hal_region_get();

    if(region) {
        return region->country_code;
    } else {
        return "--";
    }
}

bool furi_hal_region_is_frequency_allowed(uint32_t frequency) {
    return furi_hal_region_get_band(frequency) != NULL;
}

const FuriHalRegionBand* furi_hal_region_get_band(uint32_t frequency) {
    const FuriHalRegion* region = furi_hal_region_get();

    if(!region) {
        return NULL;
    }

    for(size_t i = 0; i < region->bands_count; i++) {
        if(region->bands[i].start <= frequency && region->bands[i].end >= frequency) {
            return &region->bands[i];
        }
    }

    return NULL;
}
