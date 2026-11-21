// Apple Media Service is provided by the paired iPhone. All ATT procedures run
// on the app thread; the HCI event thread only copies controller responses.
#include "ams_client.h"
#include <ble/ble.h>
#include <interface/patterns/ble_thread/tl/tl.h>
#include <furi.h>
#include <furi_ble/gatt.h>
#include <furi_hal_bt.h>
#include <math.h>
#include <stdlib.h>

static const uint8_t service_uuid[] =
    {0xdc, 0xf8, 0x55, 0xad, 0x02, 0xc5, 0xf4, 0x8e, 0x3a, 0x43, 0x36, 0x0f, 0x2b, 0x50, 0xd3, 0x89};
static const uint8_t command_uuid[] =
    {0xc2, 0x51, 0xca, 0xf7, 0x56, 0x0e, 0xdf, 0xb8, 0x8a, 0x4a, 0xb1, 0x57, 0xd8, 0x81, 0x3c, 0x9b};
static const uint8_t update_uuid[] =
    {0x02, 0xc1, 0x96, 0xba, 0x92, 0xbb, 0x0c, 0x9a, 0x1f, 0x41, 0x8d, 0x80, 0xce, 0xab, 0x7c, 0x2f};
static const uint8_t attribute_uuid[] =
    {0xd7, 0xd5, 0xbb, 0x70, 0xa8, 0xa3, 0xab, 0xa6, 0xd8, 0x46, 0xab, 0x23, 0x8c, 0xf3, 0xb2, 0xc6};

typedef enum {
    DiscoverServices,
    DiscoverGatt,
    FindChangedCccd,
    SubscribeChanged,
    DiscoverMedia,
    FindCommandCccd,
    FindUpdateCccd,
    SubscribeCommand,
    SubscribeUpdate,
    RegisterPlayer,
    RegisterTrack,
    Ready,
    SelectAttribute,
    ReadAttribute,
    SendCommand,
    Waiting
} Phase;

typedef struct {
    uint16_t value;
    uint16_t last;
    uint16_t cccd;
} Characteristic;

typedef struct {
    uint16_t first;
    uint16_t last;
} Service;

typedef struct {
    uint32_t link;
    uint16_t code;
    uint8_t size;
    uint8_t data[253];
} ClientEvent;

typedef enum {
    Playback,
    Artist,
    Title,
    Duration,
    FieldCount
} Field;
static const uint8_t attribute_ids[FieldCount][2] = {{0, 1}, {2, 0}, {2, 2}, {2, 3}};

typedef struct {
    uint32_t link;
    Service gatt;
    Service media;
    Characteristic changed;
    Characteristic command;
    Characteristic update;
    Characteristic attribute;
    Phase phase;
    bool busy;
    bool rediscover;
    bool dirty;
    bool published;
    uint32_t started;
    uint32_t published_at;
    uint8_t supported;
    uint8_t pending_reads;
    Field reading;
    bool read_superseded;
    char read_value[96];
    size_t read_length;
    char title[96];
    char artist[96];
    uint32_t duration;
    uint32_t elapsed;
    uint32_t elapsed_at;
    float rate;
    bool playing;
} Session;

struct AmsClient {
    FuriMessageQueue* events;
    // The upper half changes even if the controller reuses its connection handle.
    uint32_t link;
    bool overflow;
    Session session;
};

#define NO_HANDLE UINT16_MAX

static uint16_t le16(const uint8_t* p) {
    return (uint16_t)(p[0] | ((uint16_t)p[1] << 8));
}

AmsClient* ams_client_alloc(void) {
    AmsClient* client = malloc(sizeof(AmsClient));
    *client = (AmsClient){
        .events = furi_message_queue_alloc(12, sizeof(ClientEvent)), .link = NO_HANDLE};
    return client;
}

void ams_client_free(AmsClient* client) {
    furi_message_queue_free(client->events);
    free(client);
}

void ams_client_set_link(AmsClient* client, uint16_t handle) {
    uint32_t link = __atomic_load_n(&client->link, __ATOMIC_ACQUIRE);
    if((uint16_t)link != handle)
        __atomic_store_n(
            &client->link, ((link + 0x10000) & 0xffff0000u) | handle, __ATOMIC_RELEASE);
}

void ams_client_event(AmsClient* client, const void* event) {
    const hci_event_pckt* packet = (const void*)((const hci_uart_pckt*)event)->data;
    uint32_t link = __atomic_load_n(&client->link, __ATOMIC_ACQUIRE);
    if(packet->evt == HCI_VENDOR_SPECIFIC_DEBUG_EVT_CODE && packet->plen >= 4) {
        const uint16_t code = le16(packet->data);
        switch(code) {
        case ACI_ATT_READ_BY_GROUP_TYPE_RESP_VSEVT_CODE:
        case ACI_ATT_READ_BY_TYPE_RESP_VSEVT_CODE:
        case ACI_ATT_FIND_INFO_RESP_VSEVT_CODE:
        case ACI_ATT_READ_BLOB_RESP_VSEVT_CODE:
        case ACI_ATT_READ_RESP_VSEVT_CODE:
        case ACI_GATT_NOTIFICATION_VSEVT_CODE:
        case ACI_GATT_INDICATION_VSEVT_CODE:
        case ACI_GATT_PROC_TIMEOUT_VSEVT_CODE:
        case ACI_GATT_PROC_COMPLETE_VSEVT_CODE:
            break;
        default:
            return;
        }
        if((uint16_t)link == NO_HANDLE || le16(packet->data + 2) != (uint16_t)link) return;
        ClientEvent copy = {.link = link, .code = code, .size = packet->plen - 2};
        memcpy(copy.data, packet->data + 2, copy.size);
        if(furi_message_queue_put(client->events, &copy, 0) != FuriStatusOk)
            __atomic_store_n(&client->overflow, true, __ATOMIC_RELEASE);
        return;
    }
}

static void discover_services(Session* s, const uint8_t* p, size_t size) {
    if(size < 2 || (p[0] != 6 && p[0] != 20) || p[1] > size - 2) return;
    const size_t width = p[0], end = p[1] + 2;
    for(size_t i = 2; i + width <= end; i += width) {
        Service range = {.first = le16(p + i), .last = le16(p + i + 2)};
        if(width == 6 && le16(p + i + 4) == 0x1801) s->gatt = range;
        if(width == 20 && !memcmp(p + i + 4, service_uuid, 16)) s->media = range;
    }
}

static void discover_chars(Session* s, const uint8_t* p, size_t size) {
    if(size < 2 || (p[0] != 7 && p[0] != 21) || p[1] > size - 2) return;
    const size_t width = p[0], end = p[1] + 2;
    Characteristic* chars[] = {&s->changed, &s->command, &s->update};
    Service service = s->phase == DiscoverGatt ? s->gatt : s->media;
    for(size_t i = 2; i + width <= end; i += width) {
        uint16_t declaration = le16(p + i), value = le16(p + i + 3);
        if(declaration < service.first || value <= declaration || value > service.last) continue;
        // Descriptor ranges end immediately before the next declaration, including
        // unknown characteristics and declarations in later response packets.
        for(size_t c = 0; c < COUNT_OF(chars); c++) {
            if(chars[c]->value && chars[c]->value < declaration && chars[c]->last >= declaration)
                chars[c]->last = declaration - 1;
        }
        Characteristic* target = NULL;
        const uint8_t* uuid = p + i + 5;
        if(s->phase == DiscoverGatt && width == 7 && le16(uuid) == 0x2a05) target = &s->changed;
        if(s->phase == DiscoverMedia && width == 21) {
            if(!memcmp(uuid, command_uuid, 16)) target = &s->command;
            if(!memcmp(uuid, update_uuid, 16)) target = &s->update;
            if(!memcmp(uuid, attribute_uuid, 16)) target = &s->attribute;
        }
        if(target) *target = (Characteristic){.value = value, .last = service.last};
    }
}

static Characteristic* descriptor_target(Session* s) {
    if(s->phase == FindChangedCccd) return &s->changed;
    if(s->phase == FindCommandCccd) return &s->command;
    if(s->phase == FindUpdateCccd) return &s->update;
    return NULL;
}

static void discover_descriptors(Session* s, const uint8_t* p, size_t size) {
    Characteristic* target = descriptor_target(s);
    if(!target || size < 2 || p[0] != 1 || p[1] > size - 2) return;
    const size_t end = 2 + p[1];
    for(size_t i = 2; i + 4 <= end; i += 4) {
        const uint16_t handle = le16(p + i);
        if(handle > target->value && handle <= target->last && le16(p + i + 2) == 0x2902)
            target->cccd = handle;
    }
}

static void copy_value(char* out, const uint8_t* value, size_t len) {
    const size_t size = MIN(len, 95u);
    memcpy(out, value, size);
    out[size] = 0;
}

// iOS can truncate an update in the middle of a UTF-8 scalar. Keep the
// longest valid prefix while waiting for the extended attribute value.
static void copy_label(char* out, const uint8_t* p, size_t size) {
    size_t i = 0, len = MIN(size, 95u);
    while(i < len) {
        const uint8_t c = p[i];
        size_t width = c < 0x80               ? 1 :
                       c >= 0xc2 && c <= 0xdf ? 2 :
                       c >= 0xe0 && c <= 0xef ? 3 :
                       c >= 0xf0 && c <= 0xf4 ? 4 :
                                                0;
        if(!width || width > len - i) break;
        bool valid = true;
        for(size_t j = 1; j < width; j++)
            valid &= (p[i + j] & 0xc0) == 0x80;
        if(!valid || (c == 0xe0 && p[i + 1] < 0xa0) || (c == 0xed && p[i + 1] >= 0xa0) ||
           (c == 0xf0 && p[i + 1] < 0x90) || (c == 0xf4 && p[i + 1] >= 0x90))
            break;
        if(c < 0x20 || c == 0x7f)
            out[i] = ' ';
        else
            memcpy(out + i, p + i, width);
        i += width;
    }
    out[i] = 0;
}

static uint32_t milliseconds(float seconds) {
    if(!isfinite(seconds) || seconds <= 0) return 0;
    if(seconds >= 4294967.0f) return UINT32_MAX;
    return (uint32_t)(seconds * 1000.0f);
}

static void update_field(Session* s, Field field, const uint8_t* p, size_t size) {
    char text[96];
    copy_value(text, p, size);
    switch(field) {
    case Artist:
        copy_label(s->artist, p, size);
        break;
    case Title:
        copy_label(s->title, p, size);
        break;
    case Duration:
        s->duration = milliseconds(strtof(text, NULL));
        break;
    case Playback: {
        char* end;
        long state = strtol(text, &end, 10);
        if(end == text || *end != ',') return;
        char* rate_start = end + 1;
        float rate = strtof(rate_start, &end);
        if(end == rate_start || *end != ',' || !isfinite(rate)) return;
        char* elapsed_start = end + 1;
        float elapsed = strtof(elapsed_start, &end);
        if(end == elapsed_start || *end || !isfinite(elapsed)) return;
        s->rate = rate;
        s->elapsed = milliseconds(elapsed);
        s->elapsed_at = furi_get_tick();
        s->playing = state != 0 && rate != 0;
        break;
    }
    default:
        return;
    }
    s->dirty = true;
}

static void notification(Session* s, const uint8_t* p, size_t size) {
    if(size < 3 || p[2] > size - 3) return;
    const uint16_t handle = le16(p);
    const size_t count = p[2];
    p += 3;
    if(handle == s->command.value && handle) {
        s->supported = 0;
        for(size_t i = 0; i < count; i++) {
            if(p[i] <= 4) s->supported |= 1u << p[i];
        }
    } else if(handle == s->update.value && handle && count >= 3) {
        for(Field field = Playback; field < FieldCount; field++) {
            if(memcmp(attribute_ids[field], p, 2)) continue;
            if(s->reading == field && (s->phase == SelectAttribute || s->phase == ReadAttribute))
                s->read_superseded = true;
            if(p[2] & 1) {
                if(s->attribute.value) s->pending_reads |= 1u << field;
                if(field == Playback || field == Duration) break;
            } else {
                s->pending_reads &= ~(1u << field);
            }
            update_field(s, field, p + 3, count - 3);
            break;
        }
    }
}

static void wait_for_service(Session* s) {
    s->phase = Waiting;
    s->started = furi_get_tick();
    s->busy = false;
}

static void complete(Session* s, bool ok) {
    s->busy = false;
    if(s->rediscover) {
        s->phase = Waiting;
        return;
    }
    if(s->phase == ReadAttribute || s->phase == SendCommand ||
       (s->phase == SelectAttribute && !ok)) {
        if(s->phase == ReadAttribute && ok && !s->read_superseded && s->read_length)
            update_field(s, s->reading, (uint8_t*)s->read_value, s->read_length);
        s->phase = Ready;
        return;
    }
    if(!ok &&
       (s->phase == DiscoverServices || s->phase == DiscoverMedia || s->phase == SubscribeUpdate ||
        s->phase == RegisterPlayer || s->phase == RegisterTrack)) {
        wait_for_service(s);
        return;
    }
    if(s->phase == SelectAttribute)
        s->phase = ReadAttribute;
    else if(s->phase < Ready) {
        s->phase++;
        if(s->phase == Ready) s->dirty = true;
    }
}

static void consume(Session* s, const ClientEvent* event) {
    if(event->link != s->link || event->size < 2) return;
    const uint8_t* p = event->data + 2; // Connection handle was validated by the producer.
    size_t size = event->size - 2;
    switch(event->code) {
    case ACI_GATT_NOTIFICATION_VSEVT_CODE:
        notification(s, p, size);
        break;
    case ACI_GATT_INDICATION_VSEVT_CODE:
        if(size >= 7 && le16(p) == s->changed.value && p[2] == 4) s->rediscover = true;
        break;
    case ACI_ATT_READ_BY_GROUP_TYPE_RESP_VSEVT_CODE:
        if(s->busy && s->phase == DiscoverServices) discover_services(s, p, size);
        break;
    case ACI_ATT_READ_BY_TYPE_RESP_VSEVT_CODE:
        if(s->busy && (s->phase == DiscoverGatt || s->phase == DiscoverMedia))
            discover_chars(s, p, size);
        break;
    case ACI_ATT_FIND_INFO_RESP_VSEVT_CODE:
        if(s->busy) discover_descriptors(s, p, size);
        break;
    case ACI_ATT_READ_RESP_VSEVT_CODE:
    case ACI_ATT_READ_BLOB_RESP_VSEVT_CODE:
        if(s->busy && s->phase == ReadAttribute && size && p[0] <= size - 1) {
            size_t n = MIN((size_t)p[0], sizeof(s->read_value) - 1 - s->read_length);
            memcpy(s->read_value + s->read_length, p + 1, n);
            s->read_length += n;
        }
        break;
    case ACI_GATT_PROC_COMPLETE_VSEVT_CODE:
        if(s->busy && size) complete(s, p[0] == 0 || (p[0] == 0x0a && s->phase <= FindUpdateCccd));
        break;
    case ACI_GATT_PROC_TIMEOUT_VSEVT_CODE:
        wait_for_service(s);
        break;
    }
}

static void pump(Session* s) {
    const uint16_t conn = (uint16_t)s->link;
    const uint8_t notify[] = {1, 0}, indicate[] = {2, 0}, player[] = {0, 1},
                  track[] = {2, 0, 2, 3};
    if(s->busy) return;
    // Phases with no matching optional characteristic can be skipped synchronously.
    for(;;) {
        bool sent = false;
        switch(s->phase) {
        case DiscoverServices:
            sent = ble_gatt_client_discover_services(conn);
            break;
        case DiscoverGatt:
            if(!s->gatt.first) {
                s->phase = DiscoverMedia;
                continue;
            }
            sent = ble_gatt_client_discover_chars(conn, s->gatt.first, s->gatt.last);
            break;
        case DiscoverMedia:
            if(!s->media.first) {
                wait_for_service(s);
                return;
            }
            sent = ble_gatt_client_discover_chars(conn, s->media.first, s->media.last);
            break;
        case FindChangedCccd:
        case FindCommandCccd:
        case FindUpdateCccd: {
            Characteristic* c = descriptor_target(s);
            if(!c->value || c->last <= c->value) {
                s->phase++;
                continue;
            }
            sent = ble_gatt_client_discover_descriptors(conn, c->value, c->last);
            break;
        }
        case SubscribeChanged:
            if(!s->changed.cccd) {
                s->phase++;
                continue;
            }
            sent = ble_gatt_client_write(conn, s->changed.cccd, 2, indicate);
            break;
        case SubscribeCommand:
            if(!s->command.cccd) {
                s->phase++;
                continue;
            }
            sent = ble_gatt_client_write(conn, s->command.cccd, 2, notify);
            break;
        case SubscribeUpdate:
            if(!s->update.cccd) {
                wait_for_service(s);
                return;
            }
            sent = ble_gatt_client_write(conn, s->update.cccd, 2, notify);
            break;
        case RegisterPlayer:
            sent = ble_gatt_client_write(conn, s->update.value, sizeof(player), player);
            break;
        case RegisterTrack:
            sent = ble_gatt_client_write(conn, s->update.value, sizeof(track), track);
            break;
        case Ready:
            if(!s->pending_reads) return;
            for(Field field = Playback; field < FieldCount; field++) {
                if(!(s->pending_reads & (1u << field))) continue;
                s->pending_reads &= ~(1u << field);
                s->reading = field;
                break;
            }
            s->read_length = 0;
            s->read_superseded = false;
            s->phase = SelectAttribute;
            continue;
        case SelectAttribute:
            sent = ble_gatt_client_write(conn, s->attribute.value, 2, attribute_ids[s->reading]);
            break;
        case ReadAttribute:
            sent = ble_gatt_client_read_long(conn, s->attribute.value);
            break;
        case SendCommand:
        case Waiting:
            return;
        }
        if(sent) {
            s->busy = true;
            s->started = furi_get_tick();
        } else {
            // A competing stack operation can temporarily own the ATT bearer.
            // Retry discovery later, and never retry a playback command.
            wait_for_service(s);
        }
        return;
    }
}

static void emit_text(uint8_t tag, const char* text, AmsReceive receive, void* context) {
    uint8_t chunk[20] = {tag};
    size_t len = strlen(text);
    for(size_t offset = 0; offset < len; offset += sizeof(chunk) - 1) {
        size_t n = MIN(sizeof(chunk) - 1, len - offset);
        memcpy(chunk + 1, text + offset, n);
        receive(chunk, n + 1, context);
    }
}

static void publish(Session* s, AmsReceive receive, void* context) {
    s->dirty = false;
    s->published = true;
    s->published_at = furi_get_tick();
    if(!s->title[0] || !s->duration) {
        const uint8_t idle[] = {5, 0};
        receive(idle, sizeof(idle), context);
        return;
    }
    const uint8_t begin = 1;
    receive(&begin, 1, context);
    emit_text(2, s->title, receive, context);
    emit_text(3, s->artist, receive, context);
    float delta = (float)(s->published_at - s->elapsed_at) / furi_kernel_get_tick_frequency();
    float seconds = s->elapsed / 1000.0f + (s->playing ? delta * s->rate : 0.0f);
    uint32_t elapsed = MIN(milliseconds(seconds), s->duration);
    uint8_t commit[10] = {4, s->playing};
    for(size_t i = 0; i < 4; i++) {
        commit[2 + i] = (uint8_t)(elapsed >> (8 * i));
        commit[6 + i] = (uint8_t)(s->duration >> (8 * i));
    }
    receive(commit, sizeof(commit), context);
}

void ams_client_tick(AmsClient* client, bool connected, AmsReceive receive, void* context) {
    Session* s = &client->session;
    uint32_t link = __atomic_load_n(&client->link, __ATOMIC_ACQUIRE);
    const bool active = connected && (uint16_t)link != NO_HANDLE &&
                        furi_hal_bt_get_radio_stack() == FuriHalBtStackFull;
    bool dropped = __atomic_exchange_n(&client->overflow, false, __ATOMIC_ACQ_REL);
    if(!active || s->link != link) *s = (Session){.link = active ? link : NO_HANDLE};
    ClientEvent event;
    while(furi_message_queue_get(client->events, &event, 0) == FuriStatusOk) {
        if(active) consume(s, &event);
    }
    if(!active) return;
    if(dropped || (s->busy && furi_get_tick() - s->started >= furi_ms_to_ticks(32000))) {
        wait_for_service(s);
    }
    if((s->rediscover && !s->busy) ||
       (s->phase == Waiting && furi_get_tick() - s->started >= furi_ms_to_ticks(15000))) {
        if(s->published) receive(NULL, 0, context);
        *s = (Session){.link = link};
    }
    pump(s);
    if((s->phase == Ready || s->phase == SelectAttribute || s->phase == ReadAttribute ||
        s->phase == SendCommand) &&
       (s->dirty || furi_get_tick() - s->published_at >= furi_ms_to_ticks(5000)))
        publish(s, receive, context);
}

// Closing the app keeps the phone connection alive. Stop subscriptions when the
// peer is responsive, without blocking exit on a dropped link or busy controller.
static bool wait_for_completion(AmsClient* client, uint32_t link, uint32_t start) {
    uint32_t budget = furi_ms_to_ticks(400);
    ClientEvent event;
    while(__atomic_load_n(&client->link, __ATOMIC_ACQUIRE) == link) {
        uint32_t elapsed = furi_get_tick() - start;
        if(elapsed >= budget ||
           furi_message_queue_get(client->events, &event, budget - elapsed) != FuriStatusOk)
            break;
        if(event.link == link && event.code == ACI_GATT_PROC_COMPLETE_VSEVT_CODE) return true;
    }
    return false;
}

void ams_client_close(AmsClient* client) {
    Session* s = &client->session;
    if((uint16_t)s->link == NO_HANDLE ||
       s->link != __atomic_load_n(&client->link, __ATOMIC_ACQUIRE) || s->rediscover)
        return;
    uint32_t start = furi_get_tick();
    if(s->busy && !wait_for_completion(client, s->link, start)) return;
    const uint16_t handles[] = {s->update.cccd, s->command.cccd, s->changed.cccd};
    const uint8_t disabled[2] = {0};
    for(size_t i = 0; i < COUNT_OF(handles); ++i) {
        if(!handles[i]) continue;
        if(s->link != __atomic_load_n(&client->link, __ATOMIC_ACQUIRE) ||
           !ble_gatt_client_write((uint16_t)s->link, handles[i], sizeof(disabled), disabled) ||
           !wait_for_completion(client, s->link, start))
            break;
    }
}

bool ams_client_send(AmsClient* client, uint8_t command) {
    Session* s = &client->session;
    if(s->phase != Ready || s->busy || !s->command.value || s->rediscover ||
       s->link != __atomic_load_n(&client->link, __ATOMIC_ACQUIRE))
        return false;
    uint8_t remote;
    switch(command) {
    case 1:
        remote = 4;
        break;
    case 2:
        remote = (s->supported & (1u << 2)) ? 2 : (s->playing ? 1 : 0);
        break;
    case 3:
        remote = 3;
        break;
    default:
        return false;
    }
    if(!(s->supported & (1u << remote))) return false;
    if(!ble_gatt_client_write((uint16_t)s->link, s->command.value, 1, &remote)) return false;
    s->phase = SendCommand;
    s->busy = true;
    s->started = furi_get_tick();
    return true;
}
