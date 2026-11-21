/* WebAssembly entry points for the browser prototype (the same core, unchanged). */
#include "danchi.h"

#define EXPORT(n) __attribute__((export_name(n)))
static dn_state S;
static dn_big B;
static float OL[DN_BLOCK], OR_[DN_BLOCK], IN[DN_BLOCK];
static uint16_t FB[DN_SCREEN * DN_SCREEN];

EXPORT("init") void w_init(float sr, int seed) { dn_init(&S, &B, sr, (uint32_t)seed); }
EXPORT("process") void w_process(int n) { dn_process(&S, OL, OR_, n > DN_BLOCK ? DN_BLOCK : n); }
EXPORT("process_in") void w_process_in(int n) { dn_process_in(&S, IN, OL, OR_, n > DN_BLOCK ? DN_BLOCK : n); }
EXPORT("in_buf") float *w_in_buf(void) { return IN; }
EXPORT("samp_area") int16_t *w_samp_area(void) { return dn_sample_area(&S); }
EXPORT("samp_max") int w_samp_max(void) { return DN_OBJBUF; }
EXPORT("samp_commit") void w_samp_commit(int n) { dn_sample_commit(&S, n); }
EXPORT("fx_set") void w_fx_set(int f, int k, float v) { dn_fx_set(&S, f, k, v); }
EXPORT("out_l") float *w_out_l(void) { return OL; }
EXPORT("out_r") float *w_out_r(void) { return OR_; }
EXPORT("view") const float *w_view(void) { return dn_view(&S); }
EXPORT("view_n") int w_view_n(void) { return V_N; }
EXPORT("enc") void w_enc(int k, int d) { dn_encoder(&S, k, d); }
EXPORT("key") void w_key(int u, int down) { dn_key(&S, u, down); }
EXPORT("btn") void w_btn(int b, int a) { dn_button(&S, b, a); }
EXPORT("set_knob") void w_set_knob(int k, float v) { dn_set_knob(&S, k, v); }
EXPORT("draw") void w_draw(int y0, int n) { dn_draw_rows(&S, FB + y0 * DN_SCREEN, y0, n); }
EXPORT("fb") uint16_t *w_fb(void) { return FB; }
EXPORT("state_bytes") int w_state_bytes(void) { return (int)sizeof(dn_state); }
EXPORT("big_bytes") int w_big_bytes(void) { return (int)sizeof(dn_big); }
