#pragma once
#include <gui/view.h>
#include <gui/view_dispatcher.h>

typedef struct {
    Gui* gui;
    View* view;
    ViewDispatcher* dispatcher;
} EddyReader;

void eddy_reader_init(EddyReader* reader, const char* title, const char* hint);
void eddy_reader_found(EddyReader* reader, const char* type);
void eddy_reader_free(EddyReader* reader);
