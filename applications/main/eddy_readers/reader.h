#pragma once
#include <gui/view.h>
#include <gui/view_dispatcher.h>

typedef struct {
    void (*rescan)(void* context);
    void* rescan_context;
    Gui* gui;
    View* view;
    ViewDispatcher* dispatcher;
    struct EddyNotes* notes;
} EddyReader;

void eddy_reader_init(
    EddyReader* reader,
    const char* title,
    const char* hint,
    const Icon* art,
    void (*rescan)(void*),
    void* context);
void eddy_reader_clear(EddyReader* reader);
void eddy_reader_found(EddyReader* reader, const char* type);
void eddy_reader_free(EddyReader* reader);
