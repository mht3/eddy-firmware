#pragma once
#include <stdint.h>

/* Run on a worker thread. Pass "off" for the desktop shutdown shortcut. */
int32_t loader_menu_power(void* argument);
