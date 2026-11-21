#include "spotify_library.h"
#include <string.h>
#include <toolbox/eddy_media_label.h>

const char* const spotify_category_names[SpotifyCategories] = {
    "Liked Songs",
    "Playlists",
    "Albums"};
const uint8_t spotify_category_ops[SpotifyCategories] = {
    SpotifyLiked,
    SpotifyPlaylists,
    SpotifyAlbums};

void spotify_library_begin(SpotifyLibrary* lib, uint8_t op, uint16_t request) {
    lib->op = op;
    lib->request = request;
    lib->collecting = false;
    lib->accepted = false;
    lib->error = SpotifyOk;
}

void spotify_library_fail(SpotifyLibrary* lib, SpotifyError error) {
    lib->request = 0;
    lib->collecting = false;
    lib->error = error;
}

void spotify_library_receive(SpotifyLibrary* lib, const uint8_t* data, size_t size) {
    if(size < 3 || size > 20 || !lib->request ||
       lib->request != (uint16_t)(data[1] | ((uint16_t)data[2] << 8)))
        return;
    bool playing = lib->op >= SpotifyPlay;
    switch(data[0]) {
    case 0x10: // Start a fresh transaction; partial pages stay off screen.
        if(size != 3 || playing) break;
        memset(lib->lengths, 0, sizeof(lib->lengths));
        lib->collecting = true;
        return;
    case 0x11: {
        if(!lib->collecting || size <= 4 || data[3] >= SpotifyRows) break;
        uint8_t row = data[3];
        size_t len = lib->lengths[row];
        if(size - 4 > SpotifyLabelBytes - len) break;
        memcpy(lib->staged[row] + len, data + 4, size - 4);
        lib->lengths[row] += size - 4;
        return;
    }
    case 0x12: {
        if(!lib->collecting || size != 10 || data[3] > SpotifyRows || data[4] > 1 || data[5] > 1)
            break;
        for(size_t i = 0; i < SpotifyRows; ++i) {
            size_t len = lib->lengths[i];
            if((i < data[3]) != (len != 0) || !eddy_media_label_valid(lib->staged[i], len)) {
                spotify_library_fail(lib, SpotifyInvalid);
                return;
            }
            lib->staged[i][len] = 0;
        }
        memcpy(lib->rows, lib->staged, sizeof(lib->rows));
        lib->count = data[3];
        lib->previous = data[4];
        lib->next = data[5];
        lib->offset = data[6] | ((uint32_t)data[7] << 8) | ((uint32_t)data[8] << 16) |
                      ((uint32_t)data[9] << 24);
        lib->selected = 0;
        lib->page = lib->request;
        lib->request = 0;
        lib->collecting = false;
        return;
    }
    case 0x13:
        if(size != 4 || data[3] > 4) break;
        spotify_library_fail(lib, (SpotifyError)(SpotifyNoPlayer + data[3]));
        return;
    case 0x14:
        if(!playing || size != 4 || data[3] != lib->op - SpotifyPlay || data[3] >= lib->count)
            break;
        lib->accepted = true;
        lib->request = 0;
        return;
    default:
        return;
    }
    spotify_library_fail(lib, SpotifyInvalid);
}
