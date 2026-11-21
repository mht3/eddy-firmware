#pragma once
#include <gui/view.h>

View* loader_quick_settings_alloc(void (*open_details)(void*), void* context);
void loader_quick_settings_free(View* view);
