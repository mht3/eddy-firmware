#include "music_state.h"
#include <string.h>

static uint32_t read_ms(const uint8_t* p) {
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) |
           ((uint32_t)p[3] << 24);
}

static bool valid_text(const char* field, size_t length) {
    const uint8_t* s = (const uint8_t*)field;
    size_t i = 0;
    while(i < length) {
        uint8_t c = s[i++];
        if(c < 0x20 || c == 0x7f) return false;
        if(c < 0x80) continue;
        size_t n = c <= 0xdf ? 1 : c <= 0xef ? 2 : 3;
        if(c < 0xc2 || c > 0xf4 || length - i < n) return false;
        if((c == 0xe0 && s[i] < 0xa0) || (c == 0xed && s[i] >= 0xa0) ||
           (c == 0xf0 && s[i] < 0x90) || (c == 0xf4 && s[i] >= 0x90))
            return false;
        while(n--) {
            if((s[i++] & 0xc0) != 0x80) return false;
        }
    }
    return true;
}

bool music_frame_receive(
    MusicFrame* frame,
    MusicTrackInfo* track,
    MusicState* state,
    const uint8_t* data,
    size_t size) {
    if(!data || !size || size > 20) {
        frame->started = false;
        return false;
    }
    uint8_t op = data[0];
    if(op == 1 && size == 1) {
        *frame = (MusicFrame){.started = true};
        return false;
    }
    if(op == 5 && size == 2 && data[1] <= 4) {
        frame->started = false;
        *track = (MusicTrackInfo){0};
        *state = MusicIdle + data[1];
        return true;
    }
    if(!frame->started) return false;
    if(op == 2 || op == 3) {
        char* text = op == 2 ? frame->pending.title : frame->pending.artist;
        size_t* len = op == 2 ? &frame->title_len : &frame->artist_len;
        if(size - 1 > sizeof(frame->pending.title) - 1 - *len) {
            frame->started = false;
            return false;
        }
        memcpy(text + *len, data + 1, size - 1);
        *len += size - 1;
        return false;
    }
    frame->started = false;
    if(op != 4 || size != 10 || data[1] > 1 || !frame->title_len ||
       !valid_text(frame->pending.title, frame->title_len) ||
       !valid_text(frame->pending.artist, frame->artist_len))
        return false;
    *track = frame->pending;
    track->playing = data[1] != 0;
    track->duration = read_ms(data + 6);
    track->elapsed = read_ms(data + 2);
    if(track->duration && track->elapsed > track->duration) track->elapsed = track->duration;
    *state = MusicTrack;
    return true;
}
