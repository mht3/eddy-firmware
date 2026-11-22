#pragma once

#include <applications.h>
#include <storage/storage.h>

typedef struct {
    const FlipperExternalApplication* app;
    const char* launch_target; // Registered name or validated community FAP path.
} LoaderMenuApp;

/** Caller owns the array and its community labels and icons. */
LoaderMenuApp* loader_menu_apps_load(Storage* storage, size_t* count);
