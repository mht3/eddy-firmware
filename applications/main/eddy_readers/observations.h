#pragma once

#include <dialogs/dialogs.h>
#include <gui/elements.h>
#include <gui/modules/text_input.h>
#include <gui/modules/submenu.h>
#include <gui/view_dispatcher.h>
#include <storage/storage.h>

// These independently packaged apps share the same private note views.
// View 0 belongs to the caller. Its custom event handler forwards events to eddy_notes_event.
enum {
    ReaderScan,
    ReaderName,
    ReaderDetail,
    ReaderSaved,
};
enum {
    BeginSave,
    CommitSave,
    BrowseNotes,
    NotesPrevious,
    NotesNext,
    NotesScan,
    NotesSelect,
};
enum {
    NotesPerPage = 8
};
#define NOTES_ROOT EXT_PATH("eddy_observations")
#define NOTE_EXT   ".note"

typedef struct EddyNotes {
    ViewDispatcher* dispatcher;
    TextInput* input;
    View* detail;
    Submenu* list;
    FuriString* names[NotesPerPage];
    size_t offset;
    size_t count;
    Storage* storage;
    DialogsApp* dialogs;
    FuriString* folder;
    char name[23];
    char value[40];
    bool browsing;
} EddyNotes;

static uint32_t back_to_scan(void* context) {
    UNUSED(context);
    return ReaderScan;
}

static uint32_t detail_back(void* context) {
    EddyNotes* notes = context;
    return notes->browsing ? ReaderSaved : ReaderScan;
}

typedef struct {
    char name[64];
    char detail[40];
} NoteModel;

static void note_draw(Canvas* canvas, void* context) {
    const NoteModel* note = context;
    canvas_set_font(canvas, FontSecondary);
    canvas_draw_str(canvas, 2, 9, "Saved observation");
    elements_text_box(canvas, 3, 12, 122, 23, AlignLeft, AlignCenter, note->name, true);
    canvas_draw_line(canvas, 3, 36, 124, 36);
    elements_text_box(canvas, 3, 39, 122, 22, AlignLeft, AlignCenter, note->detail, true);
}

static void show_detail(EddyNotes* notes, const char* name, const char* type) {
    with_view_model(
        notes->detail,
        NoteModel * model,
        {
            strlcpy(model->name, name, sizeof(model->name));
            strlcpy(model->detail, type, sizeof(model->detail));
        },
        true);
    view_dispatcher_switch_to_view(notes->dispatcher, ReaderDetail);
}

static bool ensure_folder(EddyNotes* notes) {
    if(storage_simply_mkdir(notes->storage, NOTES_ROOT) &&
       storage_simply_mkdir(notes->storage, furi_string_get_cstr(notes->folder)))
        return true;
    dialog_message_show_storage_error(notes->dialogs, "Check the\nmicroSD card");
    return false;
}

// Publish the displayed reading only after the full note has reached the card.
static void save_note(EddyNotes* notes) {
    FuriString* temp =
        furi_string_alloc_printf("%s/.pending", furi_string_get_cstr(notes->folder));
    FuriString* path = furi_string_alloc_printf(
        "%s/%s" NOTE_EXT, furi_string_get_cstr(notes->folder), notes->name);
    File* file = storage_file_alloc(notes->storage);
    const size_t size = strlen(notes->value);
    bool ok =
        storage_file_open(file, furi_string_get_cstr(temp), FSAM_WRITE, FSOM_CREATE_ALWAYS) &&
        storage_file_write(file, notes->value, size) == size && storage_file_sync(file);
    ok = storage_file_close(file) && ok;
    storage_file_free(file);
    const FS_Error result =
        ok ? storage_common_rename_safe(
                 notes->storage, furi_string_get_cstr(temp), furi_string_get_cstr(path)) :
             FSE_INTERNAL;
    if(result == FSE_OK) {
        notes->browsing = false;
        show_detail(notes, notes->name, notes->value);
    } else {
        storage_common_remove(notes->storage, furi_string_get_cstr(temp));
        dialog_message_show_storage_error(
            notes->dialogs,
            result == FSE_EXIST ? "Name in use.\nPick another." : "Save failed.\nCheck the card.");
    }
    furi_string_free(path);
    furi_string_free(temp);
}

static void select_note(void* context, uint32_t event) {
    EddyNotes* notes = context;
    view_dispatcher_send_custom_event(notes->dispatcher, event);
}

static void browse_notes(EddyNotes* notes) {
    if(!ensure_folder(notes)) {
        notes->count = 0;
        view_dispatcher_switch_to_view(notes->dispatcher, ReaderScan);
        return;
    }
    File* dir = storage_file_alloc(notes->storage);
    bool ok = storage_dir_open(dir, furi_string_get_cstr(notes->folder));
    notes->count = 0;
    bool more = false;
    if(ok) {
        FileInfo info;
        char entry[256];
        size_t skipped = 0;
        while(storage_dir_read(dir, &info, entry, sizeof(entry))) {
            size_t len = strlen(entry);
            if(file_info_is_dir(&info) || entry[0] == '.' || len <= sizeof(NOTE_EXT) - 1 ||
               strcmp(entry + len - (sizeof(NOTE_EXT) - 1), NOTE_EXT) != 0)
                continue;
            if(skipped++ < notes->offset) continue;
            if(notes->count == NotesPerPage) {
                more = true;
                break;
            }
            entry[len - (sizeof(NOTE_EXT) - 1)] = 0;
            furi_string_set_str(notes->names[notes->count++], entry);
        }
        FS_Error error = storage_file_get_error(dir);
        ok = error == FSE_OK || error == FSE_NOT_EXIST;
    }
    storage_file_free(dir);
    if(!ok) {
        notes->count = 0;
        dialog_message_show_storage_error(notes->dialogs, "Cannot read\nsaved readings.");
        view_dispatcher_switch_to_view(notes->dispatcher, ReaderScan);
        return;
    }
    submenu_reset(notes->list);
    submenu_set_header(notes->list, notes->count ? "Saved readings" : "No readings yet");
    if(notes->offset)
        submenu_add_item(notes->list, "Previous page", NotesPrevious, select_note, notes);
    for(size_t i = 0; i < notes->count; ++i)
        submenu_add_item(
            notes->list,
            furi_string_get_cstr(notes->names[i]),
            NotesSelect + i,
            select_note,
            notes);
    if(more) submenu_add_item(notes->list, "Next page", NotesNext, select_note, notes);
    if(!notes->count) submenu_add_item(notes->list, "Back to scan", NotesScan, select_note, notes);
    view_dispatcher_switch_to_view(notes->dispatcher, ReaderSaved);
}

static void open_note(EddyNotes* notes, size_t index) {
    const char* name = furi_string_get_cstr(notes->names[index]);
    FuriString* path =
        furi_string_alloc_printf("%s/%s" NOTE_EXT, furi_string_get_cstr(notes->folder), name);
    File* file = storage_file_alloc(notes->storage);
    char type[sizeof(notes->value)];
    bool ok = storage_file_open(file, furi_string_get_cstr(path), FSAM_READ, FSOM_OPEN_EXISTING);
    uint64_t size = ok ? storage_file_size(file) : 0;
    ok = size > 0 && size < sizeof(type) && storage_file_read(file, type, size) == size;
    storage_file_free(file);
    furi_string_free(path);
    if(ok) {
        type[size] = 0;
        for(size_t i = 0; i < size; ++i)
            if((unsigned char)type[i] < 32 || (unsigned char)type[i] > 126) ok = false;
    }
    if(ok) {
        notes->browsing = true;
        show_detail(notes, name, type);
    } else {
        notes->count = 0;
        dialog_message_show_storage_error(notes->dialogs, "Cannot read\nobservation");
        view_dispatcher_switch_to_view(notes->dispatcher, ReaderScan);
    }
}

static bool validate_name(const char* text, FuriString* error, void* context) {
    UNUSED(context);
    const size_t len = strlen(text);
    bool valid = len && text[0] != '.' && text[0] != ' ' && text[len - 1] != ' ' &&
                 text[len - 1] != '.';
    for(size_t i = 0; valid && i < len; ++i)
        valid = (unsigned char)text[i] >= 32 && (unsigned char)text[i] < 127 &&
                !strchr("<>:\"/\\|?*", text[i]);
    if(!valid) furi_string_set(error, "Choose a file-safe name");
    return valid;
}

static void name_submitted(void* context);

static bool eddy_notes_event(EddyNotes* notes, uint32_t event) {
    if(event == BrowseNotes || event == NotesPrevious || event == NotesNext) {
        if(event == BrowseNotes)
            notes->offset = 0;
        else if(event == NotesNext)
            notes->offset += NotesPerPage;
        else if(notes->offset >= NotesPerPage)
            notes->offset -= NotesPerPage;
        browse_notes(notes);
    } else if(event >= NotesSelect && event - NotesSelect < notes->count) {
        open_note(notes, event - NotesSelect);
    } else if(event == NotesScan) {
        view_dispatcher_switch_to_view(notes->dispatcher, ReaderScan);
    } else if(event == BeginSave) {
        if(!ensure_folder(notes)) return true;
        FuriString* name = furi_string_alloc();
        storage_get_next_filename(
            notes->storage,
            furi_string_get_cstr(notes->folder),
            "Observation",
            NOTE_EXT,
            name,
            sizeof(notes->name) - 1);
        strlcpy(notes->name, furi_string_get_cstr(name), sizeof(notes->name));
        furi_string_free(name);
        text_input_set_result_callback(
            notes->input, name_submitted, notes, notes->name, sizeof(notes->name), true);
        view_dispatcher_switch_to_view(notes->dispatcher, ReaderName);
    } else if(event == CommitSave) {
        save_note(notes);
    } else {
        return false;
    }
    return true;
}

static void name_submitted(void* context) {
    EddyNotes* notes = context;
    view_dispatcher_send_custom_event(notes->dispatcher, CommitSave);
}

static EddyNotes* eddy_notes_alloc(ViewDispatcher* dispatcher, const char* category) {
    EddyNotes* notes = malloc(sizeof(EddyNotes));
    notes->dispatcher = dispatcher;
    notes->storage = furi_record_open(RECORD_STORAGE);
    notes->dialogs = furi_record_open(RECORD_DIALOGS);
    notes->folder = furi_string_alloc_printf(NOTES_ROOT "/%s", category);
    notes->input = text_input_alloc();
    notes->detail = view_alloc();
    notes->list = submenu_alloc();
    for(size_t i = 0; i < NotesPerPage; ++i)
        notes->names[i] = furi_string_alloc();
    view_set_previous_callback(submenu_get_view(notes->list), back_to_scan);
    view_dispatcher_add_view(dispatcher, ReaderSaved, submenu_get_view(notes->list));
    text_input_set_header_text(notes->input, "Name observation");
    text_input_set_validator(notes->input, validate_name, NULL);
    view_set_previous_callback(text_input_get_view(notes->input), back_to_scan);
    view_set_context(notes->detail, notes);
    view_allocate_model(notes->detail, ViewModelTypeLocking, sizeof(NoteModel));
    view_set_draw_callback(notes->detail, note_draw);
    view_set_previous_callback(notes->detail, detail_back);
    view_dispatcher_add_view(dispatcher, ReaderName, text_input_get_view(notes->input));
    view_dispatcher_add_view(dispatcher, ReaderDetail, notes->detail);
    return notes;
}

static void eddy_notes_save(EddyNotes* notes, const char* detail) {
    strlcpy(notes->value, detail, sizeof(notes->value));
    view_dispatcher_send_custom_event(notes->dispatcher, BeginSave);
}

static void eddy_notes_browse(EddyNotes* notes) {
    view_dispatcher_send_custom_event(notes->dispatcher, BrowseNotes);
}

static void eddy_notes_free(EddyNotes* notes) {
    view_dispatcher_remove_view(notes->dispatcher, ReaderSaved);
    submenu_free(notes->list);
    for(size_t i = 0; i < NotesPerPage; ++i)
        furi_string_free(notes->names[i]);
    view_dispatcher_remove_view(notes->dispatcher, ReaderName);
    view_dispatcher_remove_view(notes->dispatcher, ReaderDetail);
    text_input_free(notes->input);
    view_free(notes->detail);
    furi_string_free(notes->folder);
    furi_record_close(RECORD_STORAGE);
    furi_record_close(RECORD_DIALOGS);
    free(notes);
}
