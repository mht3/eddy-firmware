#include "music_state.h"
#include <string.h>
#include <toolbox/eddy_media_label.h>

static uint32_t read_ms(const uint8_t* p) {
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) |
           ((uint32_t)p[3] << 24);
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
    if(op == 5 && size == 2 && data[1] == 0) {
        frame->started = false;
        *track = (MusicTrackInfo){0};
        *state = MusicIdle;
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
       !eddy_media_label_valid(frame->pending.title, frame->title_len) ||
       !eddy_media_label_valid(frame->pending.artist, frame->artist_len))
        return false;
    *track = frame->pending;
    track->playing = data[1] != 0;
    track->duration = read_ms(data + 6);
    track->elapsed = read_ms(data + 2);
    if(track->duration && track->elapsed > track->duration) track->elapsed = track->duration;
    *state = MusicTrack;
    return true;
}
