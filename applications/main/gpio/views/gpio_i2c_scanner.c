#include <gui/elements.h>
#include "gpio_i2c_scanner.h"
#include "../gpio_items.h"

#include <string.h>

struct GpioI2CScanner {
    View* view;
    GpioI2CScannerOkCallback callback;
    void* context;
};

enum {
    AddressesPerPage = 8
};

typedef struct {
    bool scanned;
    uint8_t page;
    uint8_t items;
    uint8_t responding_address[AVAILABLE_NONRESVERED_I2C_ADDRESSES];
} GpioI2CScannerModel;

static bool gpio_i2c_scanner_process_ok(GpioI2CScanner* gpio_i2c_scanner, InputEvent* event);

static void gpio_i2c_scanner_draw_callback(Canvas* canvas, void* _model) {
    GpioI2CScannerModel* model = _model;

    char label[20];
    canvas_set_font(canvas, FontPrimary);
    canvas_draw_str(canvas, 2, 9, "I2C scanner");
    canvas_set_font(canvas, FontSecondary);
    canvas_draw_str(canvas, 2, 21, "SDA 15   SCL 16");
    if(model->scanned) {
        snprintf(label, sizeof(label), "%u found", model->items);
        canvas_draw_str_aligned(canvas, 126, 21, AlignRight, AlignBottom, label);
    }
    if(!model->items) {
        canvas_draw_str(
            canvas, 2, 40, model->scanned ? "No devices found." : "Connect an I2C device.");
    } else {
        size_t first = model->page * AddressesPerPage;
        for(size_t i = 0; i < AddressesPerPage && first + i < model->items; ++i) {
            snprintf(label, sizeof(label), "0x%02X", model->responding_address[first + i]);
            canvas_draw_str(canvas, 3 + 32 * (i % 4), 34 + 12 * (i / 4), label);
        }
    }
    elements_button_center(canvas, "Scan");
    if(model->items > AddressesPerPage) {
        snprintf(
            label,
            sizeof(label),
            "%u/%u",
            model->page + 1,
            (model->items + AddressesPerPage - 1) / AddressesPerPage);
        canvas_draw_str(canvas, 2, 62, label);
        canvas_draw_str(canvas, 101, 62, "<  >");
    }
}

static bool gpio_i2c_scanner_input_callback(InputEvent* event, void* context) {
    furi_assert(context);
    GpioI2CScanner* gpio_i2c_scanner = context;
    bool consumed = false;

    if((event->key == InputKeyLeft || event->key == InputKeyRight) &&
       event->type == InputTypeShort) {
        with_view_model(
            gpio_i2c_scanner->view,
            GpioI2CScannerModel * model,
            {
                uint8_t pages = (model->items + AddressesPerPage - 1) / AddressesPerPage;
                if(pages > 1) {
                    model->page =
                        (model->page + (event->key == InputKeyRight ? 1 : pages - 1)) % pages;
                    consumed = true;
                }
            },
            true);
    } else if(event->key == InputKeyOk) {
        consumed = gpio_i2c_scanner_process_ok(gpio_i2c_scanner, event);
    }

    return consumed;
}

static bool gpio_i2c_scanner_process_ok(GpioI2CScanner* gpio_i2c_scanner, InputEvent* event) {
    bool consumed = false;
    gpio_i2c_scanner->callback(event->type, gpio_i2c_scanner->context);

    return consumed;
}

GpioI2CScanner* gpio_i2c_scanner_alloc() {
    GpioI2CScanner* gpio_i2c_scanner = malloc(sizeof(GpioI2CScanner));

    gpio_i2c_scanner->view = view_alloc();
    view_allocate_model(gpio_i2c_scanner->view, ViewModelTypeLocking, sizeof(GpioI2CScannerModel));
    view_set_context(gpio_i2c_scanner->view, gpio_i2c_scanner);
    view_set_draw_callback(gpio_i2c_scanner->view, gpio_i2c_scanner_draw_callback);
    view_set_input_callback(gpio_i2c_scanner->view, gpio_i2c_scanner_input_callback);

    return gpio_i2c_scanner;
}

void gpio_i2c_scanner_free(GpioI2CScanner* gpio_i2c_scanner) {
    furi_assert(gpio_i2c_scanner);
    view_free(gpio_i2c_scanner->view);
    free(gpio_i2c_scanner);
}

View* gpio_i2c_scanner_get_view(GpioI2CScanner* gpio_i2c_scanner) {
    furi_assert(gpio_i2c_scanner);
    return gpio_i2c_scanner->view;
}

void gpio_i2c_scanner_set_ok_callback(
    GpioI2CScanner* gpio_i2c_scanner,
    GpioI2CScannerOkCallback callback,
    void* context) {
    furi_assert(gpio_i2c_scanner);
    furi_assert(callback);
    with_view_model(
        gpio_i2c_scanner->view,
        GpioI2CScannerModel * model,
        {
            UNUSED(model);
            gpio_i2c_scanner->callback = callback;
            gpio_i2c_scanner->context = context;
        },
        false);
}

void gpio_i2c_scanner_update_state(GpioI2CScanner* instance, I2CScannerState* st) {
    furi_assert(instance);
    furi_assert(st);

    with_view_model(
        instance->view,
        GpioI2CScannerModel * model,
        {
            model->items = st->items;
            model->page = 0;
            model->scanned = true;

            for(int i = 0; i < model->items; i++) {
                model->responding_address[i] = st->responding_address[i];
            }
        },
        true);
}
