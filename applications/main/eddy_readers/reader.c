#include "reader.h"
#include <stdio.h>
#include <gui/elements.h>

typedef struct {
    const char* title;
    const char* hint;
    const Icon* art;
    char type[40];
} ReaderModel;

static void reader_draw(Canvas* canvas, void* context) {
    const ReaderModel* model = context;
    canvas_set_font(canvas, FontPrimary);
    canvas_draw_str(canvas, 2, 9, model->title);
    canvas_set_font(canvas, FontSecondary);
    if(model->type[0]) {
        canvas_draw_str(canvas, 3, 24, "Type detected");
        elements_text_box(canvas, 3, 26, 122, 25, AlignLeft, AlignCenter, model->type, true);
        canvas_draw_str(canvas, 3, 61, "Back to finish");
    } else {
        canvas_draw_icon(
            canvas, 1, canvas_height(canvas) - icon_get_height(model->art), model->art);
        canvas_draw_str(canvas, 64, 24, "Ready to scan");
        elements_multiline_text(canvas, 64, 39, model->hint);
    }
}

static uint32_t reader_back(void* context) {
    UNUSED(context);
    return VIEW_NONE;
}

void eddy_reader_init(EddyReader* reader, const char* title, const char* hint, const Icon* art) {
    reader->gui = furi_record_open(RECORD_GUI);
    reader->dispatcher = view_dispatcher_alloc();
    reader->view = view_alloc();
    view_allocate_model(reader->view, ViewModelTypeLocking, sizeof(ReaderModel));
    with_view_model(
        reader->view,
        ReaderModel * m,
        {
            m->title = title;
            m->hint = hint;
            m->art = art;
            m->type[0] = 0;
        },
        false);
    view_set_draw_callback(reader->view, reader_draw);
    view_set_previous_callback(reader->view, reader_back);
    view_dispatcher_add_view(reader->dispatcher, 0, reader->view);
    view_dispatcher_attach_to_gui(reader->dispatcher, reader->gui, ViewDispatcherTypeFullscreen);
    view_dispatcher_switch_to_view(reader->dispatcher, 0);
}

void eddy_reader_found(EddyReader* reader, const char* type) {
    with_view_model(
        reader->view, ReaderModel * m, { snprintf(m->type, sizeof(m->type), "%s", type); }, true);
}

void eddy_reader_free(EddyReader* reader) {
    view_dispatcher_remove_view(reader->dispatcher, 0);
    view_free(reader->view);
    view_dispatcher_free(reader->dispatcher);
    furi_record_close(RECORD_GUI);
}
