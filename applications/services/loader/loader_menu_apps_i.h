#pragma once

#include <applications.h>
#include <storage/storage.h>

/** Caller owns the array. Entries from community_start onward launch by their FAP path. */
const FlipperExternalApplication**
    loader_menu_apps_load(Storage* storage, size_t* count, size_t* community_start);
