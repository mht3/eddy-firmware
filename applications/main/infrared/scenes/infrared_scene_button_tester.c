#include "../infrared_app_i.h"

enum {
    SignalSeen = 1
};

static void tester_receive(void* context, InfraredWorkerSignal* signal) {
    UNUSED(signal);
    furi_event_flag_set(context, SignalSeen);
}

static void tester_retry(DialogExResult result, void* context) {
    InfraredApp* app = context;
    if(result == DialogExResultCenter) {
        view_dispatcher_send_custom_event(app->view_dispatcher, DialogExResultCenter);
    }
}

static void tester_listen(InfraredApp* app) {
    furi_event_flag_clear(app->tester_flags, SignalSeen);
    scene_manager_set_scene_state(app->scene_manager, InfraredSceneButtonTester, 0);
    dialog_ex_set_header(app->dialog_ex, "Button tester", 2, 2, AlignLeft, AlignTop);
    dialog_ex_set_text(
        app->dialog_ex,
        "Point your remote here\nand press a button.",
        64,
        32,
        AlignCenter,
        AlignCenter);
    dialog_ex_set_center_button_text(app->dialog_ex, NULL);
}

void infrared_scene_button_tester_on_enter(void* context) {
    InfraredApp* app = context;
    app->tester_flags = furi_event_flag_alloc();
    tester_listen(app);
    dialog_ex_set_context(app->dialog_ex, app);
    dialog_ex_set_result_callback(app->dialog_ex, tester_retry);
    // A button can emit infrared even when its protocol is unknown.
    infrared_worker_rx_force_signal_decoding(app->worker, false);
    infrared_worker_rx_enable_signal_decoding(app->worker, false);
    infrared_worker_rx_set_received_signal_callback(
        app->worker, tester_receive, app->tester_flags);
    infrared_worker_rx_start(app->worker);
    view_dispatcher_switch_to_view(app->view_dispatcher, InfraredViewDialogEx);
}

bool infrared_scene_button_tester_on_event(void* context, SceneManagerEvent event) {
    InfraredApp* app = context;
    if(event.type == SceneManagerEventTypeCustom && event.event == DialogExResultCenter) {
        tester_listen(app);
        return true;
    }
    if(event.type != SceneManagerEventTypeTick) return false;
    if(!scene_manager_get_scene_state(app->scene_manager, InfraredSceneButtonTester) &&
       (furi_event_flag_get(app->tester_flags) & SignalSeen)) {
        scene_manager_set_scene_state(app->scene_manager, InfraredSceneButtonTester, 1);
        dialog_ex_set_header(app->dialog_ex, "Signal detected", 2, 2, AlignLeft, AlignTop);
        dialog_ex_set_text(
            app->dialog_ex, "Your remote sent infrared.", 64, 30, AlignCenter, AlignCenter);
        dialog_ex_set_center_button_text(app->dialog_ex, "Test another");
    }
    return true;
}

void infrared_scene_button_tester_on_exit(void* context) {
    InfraredApp* app = context;
    infrared_worker_rx_stop(app->worker);
    infrared_worker_rx_set_received_signal_callback(app->worker, NULL, NULL);
    infrared_worker_rx_enable_signal_decoding(app->worker, app->app_state.is_decode_enabled);
    infrared_worker_rx_force_signal_decoding(app->worker, app->app_state.is_decode_forced);
    furi_event_flag_free(app->tester_flags);
    app->tester_flags = NULL;
    dialog_ex_reset(app->dialog_ex);
}
