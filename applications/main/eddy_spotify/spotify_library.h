#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

enum {
    SpotifyRows = 4,
    SpotifyLabelBytes = 80,
    SpotifyLiked = 0x10,
    SpotifyPlaylists = 0x18,
    SpotifyAlbums = 0x19,
    SpotifyCategories = 3,
    SpotifyNext = 0x11,
    SpotifyPrevious = 0x12,
    SpotifyPlay = 0x20,
    SpotifyHello = 0x15,
    SpotifyClear = 0x16,
};

typedef enum {
    SpotifyOk,
    SpotifyNoPlayer,
    SpotifyLogin,
    SpotifyOffline,
    SpotifyRestricted,
    SpotifyRateLimited,
    SpotifyInvalid,
} SpotifyError;

typedef struct {
    char rows[SpotifyRows][SpotifyLabelBytes + 1];
    char staged[SpotifyRows][SpotifyLabelBytes + 1];
    uint8_t lengths[SpotifyRows];
    uint32_t offset;
    uint16_t page;
    uint16_t request;
    uint8_t op;
    uint8_t count;
    uint8_t selected;
    bool previous;
    bool next;
    bool collecting;
    bool accepted;
    SpotifyError error;
} SpotifyLibrary;

extern const char* const spotify_category_names[SpotifyCategories];
extern const uint8_t spotify_category_ops[SpotifyCategories];

void spotify_library_begin(SpotifyLibrary* lib, uint8_t op, uint16_t request);
void spotify_library_fail(SpotifyLibrary* lib, SpotifyError error);
void spotify_library_receive(SpotifyLibrary* lib, const uint8_t* data, size_t size);
