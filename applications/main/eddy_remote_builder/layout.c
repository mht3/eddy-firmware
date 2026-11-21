#include "layout.h"

#define LAYOUT_TYPE    "Eddy IR layout"
#define LAYOUT_VERSION 1U

static const char* const signal_keys[EDDY_LAYOUT_SLOTS] = {"0", "1", "2", "3", "4", "5"};

bool eddy_layout_label_valid(const char* label) {
    size_t length = label ? strnlen(label, EDDY_LAYOUT_LABEL_MAX + 1) : 0;
    if(!length || length > EDDY_LAYOUT_LABEL_MAX || label[0] == ' ' || label[length - 1] == ' ')
        return false;
    for(size_t i = 0; i < length; ++i) {
        if((unsigned char)label[i] < 32) return false;
    }
    return true;
}

void eddy_layout_recover(Storage* storage) {
    File* dir = storage_file_alloc(storage);
    if(storage_dir_open(dir, EDDY_LAYOUT_DIR)) {
        FileInfo info;
        char name[EDDY_LAYOUT_NAME_MAX + sizeof(EDDY_LAYOUT_EXT ".ready") + 1];
        while(storage_dir_read(dir, &info, name, sizeof(name))) {
            char* suffix = strrchr(name, '.');
            if(file_info_is_dir(&info) || !suffix || strcmp(suffix, ".ready")) continue;
            *suffix = '\0';
            FuriString* path = furi_string_alloc_printf("%s/%s", EDDY_LAYOUT_DIR, name);
            const char* file = furi_string_get_cstr(path);
            if(eddy_layout_path_valid(file)) eddy_layout_restore_file(storage, file);
            furi_string_free(path);
        }
    }
    storage_file_free(dir);
}

static bool read_metadata(FlipperFormat* file, EddyLayout* layout) {
    FuriString* text = furi_string_alloc();
    uint32_t version, count;
    bool ok = flipper_format_read_header(file, text, &version) && version == LAYOUT_VERSION &&
              furi_string_equal(text, LAYOUT_TYPE) &&
              flipper_format_read_uint32(file, "Buttons", &count, 1) && count <= EDDY_LAYOUT_SLOTS;
    *layout = (EddyLayout){0};
    for(uint32_t i = 0; ok && i < count; ++i) {
        uint32_t slot, glyph;
        ok = flipper_format_read_uint32(file, "Slot", &slot, 1) && slot < EDDY_LAYOUT_SLOTS &&
             !layout->buttons[slot].label[0] &&
             flipper_format_read_uint32(file, "Glyph", &glyph, 1) && glyph < EDDY_LAYOUT_GLYPHS &&
             flipper_format_read_string(file, "Label", text) &&
             eddy_layout_label_valid(furi_string_get_cstr(text)) &&
             furi_string_size(text) == strlen(furi_string_get_cstr(text));
        if(ok) {
            layout->buttons[slot].glyph = glyph;
            strlcpy(
                layout->buttons[slot].label,
                furi_string_get_cstr(text),
                sizeof(layout->buttons[slot].label));
        }
    }
    furi_string_free(text);
    return ok;
}

static bool write_metadata(FlipperFormat* file, const EddyLayout* layout) {
    uint32_t count = 0;
    for(size_t i = 0; i < EDDY_LAYOUT_SLOTS; ++i)
        if(layout->buttons[i].label[0]) ++count;
    if(!flipper_format_write_header_cstr(file, LAYOUT_TYPE, LAYOUT_VERSION) ||
       !flipper_format_write_uint32(file, "Buttons", &count, 1))
        return false;
    for(uint32_t slot = 0; slot < EDDY_LAYOUT_SLOTS; ++slot) {
        const EddyLayoutButton* button = &layout->buttons[slot];
        if(!button->label[0]) continue;
        if(!flipper_format_write_uint32(file, "Slot", &slot, 1) ||
           !flipper_format_write_uint32(file, "Glyph", &button->glyph, 1) ||
           !flipper_format_write_string_cstr(file, "Label", button->label))
            return false;
    }
    return true;
}

static FlipperFormat* open_layout(Storage* storage, const char* path, EddyLayout* layout) {
    if(!eddy_layout_path_valid(path) || !eddy_layout_restore_file(storage, path)) return NULL;
    FlipperFormat* file = flipper_format_buffered_file_alloc(storage);
    flipper_format_set_strict_mode(file, true);
    if(flipper_format_buffered_file_open_existing(file, path) && read_metadata(file, layout)) {
        flipper_format_set_strict_mode(file, false);
        return file;
    }
    flipper_format_free(file);
    return NULL;
}

bool eddy_layout_load(Storage* storage, const char* path, EddyLayout* out) {
    FlipperFormat* file = open_layout(storage, path, out);
    if(!file) return false;
    flipper_format_free(file);
    return true;
}

static bool read_signal(FlipperFormat* file, size_t slot, InfraredSignal* out) {
    return flipper_format_rewind(file) &&
           infrared_signal_search_by_name_and_read(out, file, signal_keys[slot]) ==
               InfraredErrorCodeNone &&
           infrared_signal_is_valid(out);
}

bool eddy_layout_signal(Storage* storage, const char* path, size_t slot, InfraredSignal* out) {
    if(slot >= EDDY_LAYOUT_SLOTS) return false;
    EddyLayout layout;
    FlipperFormat* file = open_layout(storage, path, &layout);
    if(!file) return false;
    bool ok = layout.buttons[slot].label[0] && read_signal(file, slot, out);
    flipper_format_free(file);
    return ok;
}

static bool write_signals(
    FlipperFormat* dest,
    FlipperFormat* old,
    const EddyLayout* layout,
    const size_t sources[EDDY_LAYOUT_SLOTS],
    const InfraredSignal* replacement) {
    for(size_t i = 0; i < EDDY_LAYOUT_SLOTS; ++i) {
        if(!layout->buttons[i].label[0]) continue;
        InfraredSignal* saved = NULL;
        const InfraredSignal* signal = replacement;
        if(sources[i] < EDDY_LAYOUT_SLOTS) {
            saved = infrared_signal_alloc();
            signal = read_signal(old, sources[i], saved) ? saved : NULL;
        }
        bool ok = signal &&
                  infrared_signal_save(signal, dest, signal_keys[i]) == InfraredErrorCodeNone;
        if(saved) infrared_signal_free(saved);
        if(!ok) return false;
    }
    return true;
}

// The last committed snapshot stays available until .part closes successfully.
// .ready is both the commit marker and recovery source during the FAT rename gap.
static bool save_layout(
    Storage* storage,
    const char* path,
    FlipperFormat* old,
    const EddyLayout* layout,
    const size_t sources[EDDY_LAYOUT_SLOTS],
    const InfraredSignal* replacement) {
    FuriString* part = furi_string_alloc_printf("%s.part", path);
    FuriString* ready = furi_string_alloc_printf("%s.ready", path);
    FlipperFormat* dest = flipper_format_buffered_file_alloc(storage);
    bool opened = flipper_format_buffered_file_open_always(dest, furi_string_get_cstr(part));
    bool ok = opened && write_metadata(dest, layout) &&
              write_signals(dest, old, layout, sources, replacement);
    if(opened && !flipper_format_buffered_file_close(dest)) ok = false;
    flipper_format_free(dest);
    bool existing = old != NULL;
    if(old) flipper_format_free(old); // FAT requires both filenames closed for replacement.
    if(ok)
        ok = storage_common_rename(
                 storage, furi_string_get_cstr(part), furi_string_get_cstr(ready)) == FSE_OK;
    if(ok) {
        FS_Error result =
            existing ? storage_common_rename(storage, furi_string_get_cstr(ready), path) :
                       storage_common_rename_safe(storage, furi_string_get_cstr(ready), path);
        ok = result == FSE_OK;
    }
    if(!ok) storage_common_remove(storage, furi_string_get_cstr(part));
    furi_string_free(part);
    furi_string_free(ready);
    return ok;
}

bool eddy_layout_create(Storage* storage, const char* name, FuriString* path) {
    if(!eddy_layout_name_valid(name) || !storage_simply_mkdir(storage, EXT_PATH("infrared")) ||
       !storage_simply_mkdir(storage, EDDY_LAYOUT_DIR))
        return false;
    FuriString* target =
        furi_string_alloc_printf("%s/%s%s", EDDY_LAYOUT_DIR, name, EDDY_LAYOUT_EXT);
    const char* file = furi_string_get_cstr(target);
    EddyLayout empty = {0};
    bool ok = !eddy_layout_restore_file(storage, file) &&
              storage_common_stat(storage, file, NULL) == FSE_NOT_EXIST &&
              save_layout(storage, file, NULL, &empty, NULL, NULL);
    if(ok) furi_string_set(path, target);
    furi_string_free(target);
    return ok;
}

static bool change_button(
    Storage* storage,
    const char* path,
    size_t slot,
    size_t other,
    const EddyLayoutButton* button,
    const InfraredSignal* signal) {
    if(slot >= EDDY_LAYOUT_SLOTS) return false;
    EddyLayout layout;
    FlipperFormat* old = open_layout(storage, path, &layout);
    if(!old) return false;
    size_t sources[EDDY_LAYOUT_SLOTS];
    for(size_t i = 0; i < EDDY_LAYOUT_SLOTS; ++i)
        sources[i] = i;
    if(!signal && !layout.buttons[slot].label[0]) {
        flipper_format_free(old);
        return false;
    }
    if(button) {
        layout.buttons[slot] = *button;
        if(signal) sources[slot] = EDDY_LAYOUT_SLOTS;
    } else if(other < EDDY_LAYOUT_SLOTS) {
        EddyLayoutButton temp = layout.buttons[slot];
        layout.buttons[slot] = layout.buttons[other];
        layout.buttons[other] = temp;
        sources[slot] = other;
        sources[other] = slot;
    } else {
        layout.buttons[slot] = (EddyLayoutButton){0};
    }
    return save_layout(storage, path, old, &layout, sources, signal);
}

bool eddy_layout_set(
    Storage* storage,
    const char* path,
    size_t slot,
    const EddyLayoutButton* button,
    const InfraredSignal* signal) {
    return button && eddy_layout_label_valid(button->label) &&
           button->glyph < EDDY_LAYOUT_GLYPHS && (!signal || infrared_signal_is_valid(signal)) &&
           change_button(storage, path, slot, EDDY_LAYOUT_SLOTS, button, signal);
}

bool eddy_layout_move(Storage* storage, const char* path, size_t from, size_t to) {
    return to < EDDY_LAYOUT_SLOTS && change_button(storage, path, from, to, NULL, NULL);
}

bool eddy_layout_remove(Storage* storage, const char* path, size_t slot) {
    return change_button(storage, path, slot, EDDY_LAYOUT_SLOTS, NULL, NULL);
}
