#include <node_api.h>
#include <windows.h>
#include <stdlib.h>

static HHOOK g_keyboardHook = NULL;
static napi_threadsafe_function g_tsfn = NULL;

typedef struct {
  WPARAM wParam;
  DWORD vkCode;
  DWORD scanCode;
  DWORD flags;
  bool ctrlKey;
  bool shiftKey;
  bool altKey;
  bool metaKey;
} KeyEvent;

static void ExecuteJS(napi_env env, napi_value jsCb, void* ctx, void* data) {
  KeyEvent* evt = (KeyEvent*)data;
  if (!env || !jsCb || !evt) {
    free(evt);
    return;
  }

  napi_value obj, val;
  napi_create_object(env, &obj);

  bool isDown = (evt->wParam == WM_KEYDOWN || evt->wParam == WM_SYSKEYDOWN);
  bool isUp = (evt->wParam == WM_KEYUP || evt->wParam == WM_SYSKEYUP);

  napi_create_double(env, (double)evt->wParam, &val);
  napi_set_named_property(env, obj, "wParam", val);

  napi_create_double(env, (double)evt->vkCode, &val);
  napi_set_named_property(env, obj, "vkCode", val);

  napi_create_double(env, (double)evt->scanCode, &val);
  napi_set_named_property(env, obj, "scanCode", val);

  napi_create_double(env, (double)evt->flags, &val);
  napi_set_named_property(env, obj, "flags", val);

  napi_get_boolean(env, isDown, &val);
  napi_set_named_property(env, obj, "isDown", val);

  napi_get_boolean(env, isUp, &val);
  napi_set_named_property(env, obj, "isUp", val);

  napi_get_boolean(env, evt->ctrlKey, &val);
  napi_set_named_property(env, obj, "ctrlKey", val);

  napi_get_boolean(env, evt->shiftKey, &val);
  napi_set_named_property(env, obj, "shiftKey", val);

  napi_get_boolean(env, evt->altKey, &val);
  napi_set_named_property(env, obj, "altKey", val);

  napi_get_boolean(env, evt->metaKey, &val);
  napi_set_named_property(env, obj, "metaKey", val);

  napi_value undefined;
  napi_get_undefined(env, &undefined);
  napi_call_function(env, undefined, jsCb, 1, &obj, NULL);

  free(evt);
}

static void FinalizeCB(napi_env env, void* raw, void* hint) {
  g_tsfn = NULL;
}

static SHORT GetAsyncKeyStateSafe(int vk) {
  return GetAsyncKeyState(vk);
}

static LRESULT CALLBACK KeyboardProc(int nCode, WPARAM wParam, LPARAM lParam) {
  if (nCode >= 0 && g_tsfn) {
    KBDLLHOOKSTRUCT* p = (KBDLLHOOKSTRUCT*)lParam;

    KeyEvent* evt = (KeyEvent*)malloc(sizeof(KeyEvent));
    if (!evt) return CallNextHookEx(g_keyboardHook, nCode, wParam, lParam);
    evt->wParam = wParam;
    evt->vkCode = p->vkCode;
    evt->scanCode = p->scanCode;
    evt->flags = p->flags;

    evt->ctrlKey = (GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0;
    evt->shiftKey = (GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0;
    evt->altKey = (GetAsyncKeyState(VK_MENU) & 0x8000) != 0;
    evt->metaKey = (GetAsyncKeyState(VK_LWIN) & 0x8000) != 0 ||
                   (GetAsyncKeyState(VK_RWIN) & 0x8000) != 0;

    napi_call_threadsafe_function(g_tsfn, evt, napi_tsfn_nonblocking);
  }
  return CallNextHookEx(g_keyboardHook, nCode, wParam, lParam);
}

static napi_value Start(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);

  if (g_keyboardHook != NULL) {
    napi_throw_error(env, NULL, "Hooks already started");
    return NULL;
  }

  if (argc < 1) {
    napi_throw_type_error(env, NULL, "First argument must be a callback function");
    return NULL;
  }

  napi_value resourceName;
  napi_create_string_utf8(env, "keyboard-hook", NAPI_AUTO_LENGTH, &resourceName);

  napi_status status = napi_create_threadsafe_function(
    env, argv[0], NULL, resourceName, 0, 1, NULL, FinalizeCB, NULL, ExecuteJS, &g_tsfn
  );

  if (status != napi_ok) {
    napi_throw_error(env, NULL, "Failed to create thread-safe function");
    return NULL;
  }

  g_keyboardHook = SetWindowsHookExW(WH_KEYBOARD_LL, KeyboardProc, GetModuleHandleW(NULL), 0);

  if (!g_keyboardHook) {
    napi_release_threadsafe_function(g_tsfn, napi_tsfn_release);
    g_tsfn = NULL;
    napi_throw_error(env, NULL, "Failed to install keyboard hook");
    return NULL;
  }

  napi_value result;
  napi_get_boolean(env, true, &result);
  return result;
}

static napi_value Stop(napi_env env, napi_callback_info info) {
  if (g_keyboardHook) {
    UnhookWindowsHookEx(g_keyboardHook);
    g_keyboardHook = NULL;
  }

  if (g_tsfn) {
    napi_release_threadsafe_function(g_tsfn, napi_tsfn_release);
    g_tsfn = NULL;
  }

  napi_value result;
  napi_get_boolean(env, true, &result);
  return result;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value fnStart, fnStop;
  napi_create_function(env, "start", NAPI_AUTO_LENGTH, Start, NULL, &fnStart);
  napi_create_function(env, "stop", NAPI_AUTO_LENGTH, Stop, NULL, &fnStop);
  napi_set_named_property(env, exports, "start", fnStart);
  napi_set_named_property(env, exports, "stop", fnStop);
  return exports;
}

NAPI_MODULE(hooks, Init)
