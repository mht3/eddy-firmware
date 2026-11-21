#include <gui/elements.h>
#include "gpio_i2c_sfp.h"
#include "../gpio_items.h"

#include <string.h>

struct GpioI2CSfp {
    View* view;
    GpioI2CSfpOkCallback callback;
    void* context;
};

typedef struct {
    I2CSfpState module;
    bool scanned;
    bool details;
} GpioI2CSfpModel;

static bool gpio_i2c_sfp_process_ok(GpioI2CSfp* gpio_i2c_sfp, InputEvent* event);

static void gpio_i2c_sfp_draw_callback(Canvas* canvas, void* _model) {
    GpioI2CSfpModel* model = _model;

    const I2CSfpState* module = &model->module;
    char label[64];
    canvas_set_font(canvas, FontPrimary);
    canvas_draw_str(canvas, 2, 9, model->details ? "SFP details" : "SFP module");
    canvas_set_font(canvas, FontSecondary);
    if(!module->valid) {
        canvas_draw_str(
            canvas,
            2,
            27,
            model->scanned ? "No module data. Check pins." : "Connect an SFP module.");
        canvas_draw_str(canvas, 2, 42, "Pin 15: SDA   Pin 16: SCL");
    } else if(!model->details) {
        snprintf(label, sizeof(label), "Vendor: %.16s", module->vendor);
        elements_text_box(canvas, 2, 11, 124, 12, AlignLeft, AlignCenter, label, true);
        snprintf(label, sizeof(label), "PN: %.16s", module->pn);
        elements_text_box(canvas, 2, 24, 124, 12, AlignLeft, AlignCenter, label, true);
        snprintf(label, sizeof(label), "SN: %.16s", module->sn);
        elements_text_box(canvas, 2, 37, 124, 12, AlignLeft, AlignCenter, label, true);
    } else {
        snprintf(label, sizeof(label), "Rev %.4s   %.20s", module->rev, module->connector);
        elements_text_box(canvas, 2, 12, 124, 13, AlignLeft, AlignCenter, label, true);
        snprintf(label, sizeof(label), "%u nm", module->wavelength);
        canvas_draw_str(canvas, 2, 35, label);
        snprintf(
            label, sizeof(label), "SM %u km   OM3 %u m", module->sm_reach, module->mm_reach_om3);
        canvas_draw_str(canvas, 2, 48, label);
    }
    elements_button_center(canvas, "Read");
    if(module->valid) {
        if(model->details)
            elements_button_left(canvas, "Info");
        else
            elements_button_right(canvas, "More");
    }
}

static bool gpio_i2c_sfp_input_callback(InputEvent* event, void* context) {
    furi_assert(context);
    GpioI2CSfp* gpio_i2c_sfp = context;
    bool consumed = false;

    if(event->type == InputTypeShort &&
       (event->key == InputKeyLeft || event->key == InputKeyRight)) {
        with_view_model(
            gpio_i2c_sfp->view,
            GpioI2CSfpModel * model,
            {
                if(model->module.valid) {
                    model->details = event->key == InputKeyRight;
                    consumed = true;
                }
            },
            true);
    } else if(event->key == InputKeyOk) {
        consumed = gpio_i2c_sfp_process_ok(gpio_i2c_sfp, event);
    }

    return consumed;
}

static bool gpio_i2c_sfp_process_ok(GpioI2CSfp* gpio_i2c_sfp, InputEvent* event) {
    bool consumed = false;
    gpio_i2c_sfp->callback(event->type, gpio_i2c_sfp->context);

    return consumed;
}

GpioI2CSfp* gpio_i2c_sfp_alloc() {
    GpioI2CSfp* gpio_i2c_sfp = malloc(sizeof(GpioI2CSfp));

    gpio_i2c_sfp->view = view_alloc();
    view_allocate_model(gpio_i2c_sfp->view, ViewModelTypeLocking, sizeof(GpioI2CSfpModel));
    view_set_context(gpio_i2c_sfp->view, gpio_i2c_sfp);
    view_set_draw_callback(gpio_i2c_sfp->view, gpio_i2c_sfp_draw_callback);
    view_set_input_callback(gpio_i2c_sfp->view, gpio_i2c_sfp_input_callback);

    return gpio_i2c_sfp;
}

void gpio_i2c_sfp_free(GpioI2CSfp* gpio_i2c_sfp) {
    furi_assert(gpio_i2c_sfp);
    view_free(gpio_i2c_sfp->view);
    free(gpio_i2c_sfp);
}

View* gpio_i2c_sfp_get_view(GpioI2CSfp* gpio_i2c_sfp) {
    furi_assert(gpio_i2c_sfp);
    return gpio_i2c_sfp->view;
}

void gpio_i2c_sfp_set_ok_callback(
    GpioI2CSfp* gpio_i2c_sfp,
    GpioI2CSfpOkCallback callback,
    void* context) {
    furi_assert(gpio_i2c_sfp);
    furi_assert(callback);
    with_view_model(
        gpio_i2c_sfp->view,
        GpioI2CSfpModel * model,
        {
            UNUSED(model);
            gpio_i2c_sfp->callback = callback;
            gpio_i2c_sfp->context = context;
        },
        false);
}

void gpio_i2c_sfp_update_state(GpioI2CSfp* instance, I2CSfpState* st) {
    furi_assert(instance);
    furi_assert(st);

    with_view_model(
        instance->view,
        GpioI2CSfpModel * model,
        {
            model->module = *st;
            model->scanned = true;
            model->details = false;
        },
        true);
}
