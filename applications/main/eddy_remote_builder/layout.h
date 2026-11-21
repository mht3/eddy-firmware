#pragma once

#include <toolbox/eddy_layout_path.h>
#include <lib/infrared/signal/infrared_signal.h>

#define EDDY_LAYOUT_SLOTS     24
#define EDDY_LAYOUT_LABEL_MAX 16
#define EDDY_LAYOUT_GLYPHS    9

typedef struct {
    char label[EDDY_LAYOUT_LABEL_MAX + 1];
    uint32_t glyph;
} EddyLayoutButton;

typedef struct {
    EddyLayoutButton buttons[EDDY_LAYOUT_SLOTS]; // An empty label denotes an unused position.
} EddyLayout;

bool eddy_layout_label_valid(const char* label);
void eddy_layout_recover(Storage* storage);
bool eddy_layout_create(Storage* storage, const char* name, FuriString* path);
bool eddy_layout_load(Storage* storage, const char* path, EddyLayout* out);
bool eddy_layout_signal(Storage* storage, const char* path, size_t slot, InfraredSignal* out);
// Pass NULL for signal to change just the label or glyph of a programmed button.
bool eddy_layout_set(
    Storage* storage,
    const char* path,
    size_t slot,
    const EddyLayoutButton* button,
    const InfraredSignal* signal);
bool eddy_layout_move(Storage* storage, const char* path, size_t from, size_t to);
bool eddy_layout_remove(Storage* storage, const char* path, size_t slot);
