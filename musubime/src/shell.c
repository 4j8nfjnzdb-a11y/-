/* musubime: the shell every project runs in.
 *   - the hand: each frame's input, live and from the gesture loop (REC: record, REC again: loop, REC again: stop;
 *     REC held a second: forget the loop)
 *   - HOME held 0.7 s: the project back to its simple state; PLAY: sound on / off (a fade, the system runs on)
 *   - the ear: DC cut, a jump guard (a sudden rise far above the last seconds comes in lower and is let up over
 *     0.3 s), a peak limiter at -3 dBFS, and any NaN or infinity turned into silence, counted and shown
 *   - the screen: the header, the seven encoders' rows, the project's plot, the meters; only what changed is sent */
#include "mz.h"
#include "fmvox.h"

#define CEIL 0.7079f                    /* -3 dBFS */
#define JG_RATIO 63.0f                  /* the jump guard: the last 5 ms' power over the last 1.5 s' by 18 dB */
#define JG_FLOOR 0.355f                 /* at most -9 dB */

/* ------------------------------------------------------------------ the ear --- */
static struct {
    float dcx[2], dcy[2];
    float fast, slow, jg, env, gain, fade, fade_to;
    float peak, gr;
    uint32_t bad;
    uint8_t bad_now;
} ear;

static void ear_init(void)
{
    int i;
    for (i = 0; i < 2; i++)
        ear.dcx[i] = ear.dcy[i] = 0.0f;
    ear.fast = ear.slow = 0.0f;
    ear.jg = 1.0f;
    ear.env = 0.0f;
    ear.fade = 0.0f;
    ear.fade_to = 1.0f;
    ear.peak = 0.0f;
    ear.gr = 0.0f;
}

static void ear_process(float *l, float *r, uint32_t n)
{
    uint32_t i;
    int bad = 0;
    const float kf = 1.0f - 0.99547f, ks = 1.0f - 0.999985f;   /* 5 ms and 1.5 s */
    const float jg_rel = 1.0f - 0.99992f, env_rel = 0.99981f;   /* 0.3 s, 120 ms */
    float pk = 0.0f, grmin = 1.0f;
    for (i = 0; i < n; i++)
        if (!m_finite(l[i]) || !m_finite(r[i]) || m_abs(l[i]) > 1.0e6f || m_abs(r[i]) > 1.0e6f)
            bad = 1;
    if (bad) {                                       /* silence, counted, and what feeds back cleared */
        for (i = 0; i < n; i++)
            l[i] = r[i] = 0.0f;
        ear.bad++;
        ear.bad_now = 1;
        ear.fade = 0.0f;
        ear.env = 0.0f;
        ear.fast = ear.slow = 0.0f;
        ear.dcx[0] = ear.dcx[1] = ear.dcy[0] = ear.dcy[1] = 0.0f;
        pj_reset_audio();
        return;
    }
    for (i = 0; i < n; i++) {
        float a = l[i], b = r[i], p, g, t;
        /* DC cut, about 7 Hz */
        ear.dcy[0] = a - ear.dcx[0] + 0.999f * ear.dcy[0];
        ear.dcx[0] = a;
        ear.dcy[1] = b - ear.dcx[1] + 0.999f * ear.dcy[1];
        ear.dcx[1] = b;
        a = ear.dcy[0];
        b = ear.dcy[1];
        /* the jump guard */
        p = 0.5f * (a * a + b * b);
        ear.fast += (p - ear.fast) * kf;
        ear.slow += (p - ear.slow) * ks;
        t = 1.0f;
        if (ear.fast > 0.01f && ear.fast > ear.slow * JG_RATIO) {
            float q = ear.slow * JG_RATIO / ear.fast;   /* power ratio; the gain is its square root */
            t = m_max(JG_FLOOR, m_exp2(0.5f * m_log2(q)));
        }
        if (t < ear.jg)
            ear.jg = t;
        else
            ear.jg += (t - ear.jg) * jg_rel;
        a *= ear.jg;
        b *= ear.jg;
        /* the limiter: instant attack, 120 ms release; |out| <= CEIL */
        p = m_max(m_abs(a), m_abs(b));
        ear.env = p > ear.env ? p : ear.env * env_rel + p * (1.0f - env_rel);
        g = ear.env > CEIL ? CEIL / ear.env : 1.0f;
        /* the fade (PLAY, a start, after a bad number) */
        ear.fade += (ear.fade_to - ear.fade) * 0.0005f;
        g *= ear.fade;
        a *= g;
        b *= g;
        if (g * ear.jg < grmin && ear.fade > 0.99f)
            grmin = g * ear.jg;
        l[i] = a;
        r[i] = b;
        p = m_max(m_abs(a), m_abs(b));
        if (p > pk)
            pk = p;
    }
    ear.peak = pk > ear.peak ? pk : ear.peak * 0.97f;
    ear.gr = m_lin2db(grmin);
}

uint32_t mz_bad_count(void) { return ear.bad; }
float mz_out_db(void) { return ear.peak > 1.0e-5f ? m_lin2db(ear.peak) : -100.0f; }
float mz_gr_db(void) { return ear.gr; }

void mz_render(float *l, float *r, const float *inl, const float *inr, uint32_t n)
{
    pj_render(l, r, inl, inr, n);
    ear_process(l, r, n);
}

void mz_panic(void) { ear.fade = 0.0f; }

/* ------------------------------------------------------------------ the slots --- */
static mz_slot_t slots[MZ_SLOTS];
static uint32_t slot_rev;
static void slot_clear(mz_slot_t *s)
{
    s->src = 0;
    s->tune = 0.0f;
    s->bright = 0.0f;
    s->dec_x = 1.0f;
    s->level_db = 0.0f;
    s->fb = 0.0f;
}
const mz_slot_t *mz_slot(int i) { return &slots[i < 0 ? 0 : i >= MZ_SLOTS ? MZ_SLOTS - 1 : i]; }
const mz_slot_t *mz_voice(int i)
{
    const mz_slot_t *s = mz_slot(i);
    if (s->src)
        return s;
    return slots[0].src ? &slots[0] : 0;
}
void mz_slot_set(int i, uint8_t src)
{
    if (i >= 0 && i < MZ_SLOTS && src <= NVB) {
        slots[i].src = src;
        slot_rev++;
    }
}
uint32_t mz_slot_rev(void) { return slot_rev; }

/* ----------------------------------------------------------- the gesture loop --- */
enum { GL_IDLE, GL_REC, GL_LOOP };
enum { EV_ENC, EV_KDOWN, EV_KUP, EV_PRS, EV_BDOWN, EV_BUP };
#define GL_N 4096u
typedef struct {
    uint32_t t;                          /* ms from the loop's start */
    uint8_t type, idx;
    int8_t val;
    uint8_t v2;
} gl_ev_t;
static gl_ev_t gl_ev[GL_N] MZ_POOL;
static struct {
    uint8_t state;
    uint32_t n, t, len, pos;
    uint32_t keys, btn;                  /* held by the loop now */
    uint8_t vel[HW_NKEYS], prs[HW_NKEYS];
    uint32_t rec_keys;                   /* held live while recording (their releases are owed at the end) */
    uint8_t rec_prs[HW_NKEYS];
} gl;

static void gl_put(uint8_t type, uint8_t idx, int8_t val, uint8_t v2)
{
    if (gl.n >= GL_N)
        return;
    gl_ev[gl.n].t = gl.t;
    gl_ev[gl.n].type = type;
    gl_ev[gl.n].idx = idx;
    gl_ev[gl.n].val = val;
    gl_ev[gl.n].v2 = v2;
    gl.n++;
}

#define SHELL_BTNS ((1u << HB_REC) | (1u << HB_HOME) | (1u << HB_PLAY) | (1u << HB_EDIT))

static void gl_record(const mz_in_t *in)
{
    int i;
    for (i = 0; i < HW_NENC; i++) {
        int32_t d = in->enc[i];
        while (d) {
            int32_t s = d > 100 ? 100 : d < -100 ? -100 : d;
            gl_put(EV_ENC, (uint8_t)i, (int8_t)s, 0);
            d -= s;
        }
    }
    for (i = 0; i < HW_NKEYS; i++) {
        uint32_t bit = 1u << i;
        if (in->down & bit) {
            gl_put(EV_KDOWN, (uint8_t)i, 0, in->vel[i]);
            gl.rec_keys |= bit;
            gl.rec_prs[i] = 0;
        }
        if ((in->keys & bit) && (in->prs[i] >> 2) != (gl.rec_prs[i] >> 2)) {
            gl_put(EV_PRS, (uint8_t)i, 0, in->prs[i]);
            gl.rec_prs[i] = in->prs[i];
        }
        if (in->up & bit) {
            gl_put(EV_KUP, (uint8_t)i, 0, 0);
            gl.rec_keys &= ~bit;
        }
    }
    for (i = 0; i < HW_NBTN; i++) {
        uint32_t bit = 1u << i;
        if (bit & SHELL_BTNS)
            continue;
        if (in->bdown & bit)
            gl_put(EV_BDOWN, (uint8_t)i, 0, 0);
        if (in->bup & bit)
            gl_put(EV_BUP, (uint8_t)i, 0, 0);
    }
}

static void gl_stop_rec(void)
{
    int i;
    for (i = 0; i < HW_NKEYS; i++)              /* keys still held when recording stopped: released at the loop's end */
        if (gl.rec_keys & (1u << i))
            gl_put(EV_KUP, (uint8_t)i, 0, 0);
    gl.rec_keys = 0;
    gl.len = gl.t > 50u ? gl.t : 50u;
    gl.t = 0;
    gl.pos = 0;
    gl.keys = gl.btn = 0;
    gl.state = gl.n ? GL_LOOP : GL_IDLE;
}

/* the loop's events up to now, merged into the frame's input (the hand plays on top) */
static void gl_play(mz_in_t *in, uint32_t dt)
{
    uint32_t end = gl.t + dt;
    int wrapped = 0;
    for (;;) {
        while (gl.pos < gl.n && gl_ev[gl.pos].t < end) {
            const gl_ev_t *e = &gl_ev[gl.pos++];
            uint32_t bit = 1u << e->idx;
            switch (e->type) {
            case EV_ENC:
                in->enc[e->idx] += e->val;
                break;
            case EV_KDOWN:
                gl.keys |= bit;
                gl.vel[e->idx] = e->v2;
                gl.prs[e->idx] = 0;
                if (!(in->keys & bit)) {
                    in->down |= bit;
                    in->vel[e->idx] = e->v2;
                }
                break;
            case EV_KUP:
                gl.keys &= ~bit;
                gl.prs[e->idx] = 0;
                if (!(in->keys & bit))
                    in->up |= bit;
                break;
            case EV_PRS:
                gl.prs[e->idx] = e->v2;
                break;
            case EV_BDOWN:
                gl.btn |= bit;
                in->bdown |= bit;
                break;
            case EV_BUP:
                gl.btn &= ~bit;
                in->bup |= bit;
                break;
            }
        }
        if (end < gl.len || wrapped)
            break;
        end -= gl.len;                           /* the loop's end: again from its start */
        gl.pos = 0;
        wrapped = 1;
    }
    gl.t = end < gl.len ? end : 0;
    {
        int i;
        in->keys |= gl.keys;
        in->btn |= gl.btn;
        for (i = 0; i < HW_NKEYS; i++)
            if (gl.prs[i] > in->prs[i])
                in->prs[i] = gl.prs[i];
    }
}

/* ------------------------------------------------------------------ the UI --- */
static mz_in_t in;
static mz_body_t body;
static struct {
    uint32_t last_ms, prev_keys, prev_btn;
    uint32_t home_t, rec_t;
    uint8_t playing, home_done, rec_held_done;
    char msg_a[16], msg_b[20];
    uint32_t msg_until;
    mz_row_t rows[HW_NENC];
    uint8_t row_ok[HW_NENC];
    char head_cache[48];
    uint32_t plot_rev, plot_at, foot_at;
    uint32_t frames;
    uint8_t vpage, vpage_was;             /* EDIT held: the voice page */
    int vslot;
    uint32_t vhot[HW_NENC];
} ui;

void mz_say(const char *a, const char *b)
{
    ui.msg_a[0] = ui.msg_b[0] = 0;
    if (a) {
        int i;
        for (i = 0; i < 15 && a[i]; i++)
            ui.msg_a[i] = a[i];
        ui.msg_a[i] = 0;
    }
    if (b) {
        int i;
        for (i = 0; i < 19 && b[i]; i++)
            ui.msg_b[i] = b[i];
        ui.msg_b[i] = 0;
    }
    ui.msg_until = hw_ms() + 1400u;
}

void mz_init(uint32_t seed)
{
    int i;
    ear_init();
    body_reset(&body);
    gl.state = GL_IDLE;
    gl.n = 0;
    ui.playing = 1;
    ui.last_ms = hw_ms();
    for (i = 0; i < HW_NENC; i++)
        ui.row_ok[i] = 0;
    ui.head_cache[0] = 0;
    ui.plot_rev = 0xFFFFFFFFu;
    for (i = 0; i < MZ_SLOTS; i++)
        slot_clear(&slots[i]);
    pj_init(seed ? seed : 0x1234567u);
}

static void draw_head(void)
{
    char st[16], flags[24], key[48];
    uint32_t now = hw_ms();
    int msg = now < ui.msg_until;
    st[0] = flags[0] = key[0] = 0;
    pj_status(st);
    if (gl.state == GL_REC) {
        mz_cat(flags, "REC ");
        mz_fix(flags, (float)gl.t * 0.001f, 1);
    } else if (gl.state == GL_LOOP) {
        mz_cat(flags, "LOOP ");
        mz_fix(flags, (float)gl.len * 0.001f, 1);
    }
    if (!ui.playing)
        mz_cat(flags, flags[0] ? " STOP" : "STOP");
    if (ear.bad) {
        mz_cat(flags, flags[0] ? " NAN" : "NAN");
        mz_int(flags, (int32_t)ear.bad);
    }
    if (ui.vpage && !msg) {
        st[0] = 0;
        mz_cat(st, PJ_NAME);
    }
    mz_cat(key, msg ? ui.msg_a : ui.vpage ? "VOICES" : PJ_NAME);
    mz_cat(key, "|");
    mz_cat(key, msg ? ui.msg_b : st);
    mz_cat(key, "|");
    mz_cat(key, flags);
    {
        int i, same = 1;
        for (i = 0; key[i] || ui.head_cache[i]; i++)
            if (key[i] != ui.head_cache[i]) {
                same = 0;
                break;
            }
        if (same)
            return;
        for (i = 0; key[i] && i < 47; i++)
            ui.head_cache[i] = key[i];
        ui.head_cache[i] = 0;
    }
    hw_strip_begin(0, 20);
    if (msg) {
        scr_text(4, 3, 2, ui.msg_a, C_HOT);
        scr_text(236 - scr_text_w(1, ui.msg_b), 2, 1, ui.msg_b, C_VAL);
    } else {
        scr_text(4, 3, 2, ui.vpage ? "VOICES" : PJ_NAME, ui.vpage ? C_CYN : C_VAL);
        scr_text(236 - scr_text_w(1, st), 2, 1, st, C_LAB);
    }
    scr_text(236 - scr_text_w(1, flags), 11, 1, flags, ear.bad_now ? C_RED : gl.state == GL_REC ? C_RED : C_GRN);
    scr_hline(0, 19, 240, C_RULE);
    hw_strip_end();
}

static int row_same(const mz_row_t *a, const mz_row_t *b)
{
    int i;
    if (a->hot != b->hot || a->alert != b->alert)
        return 0;
    for (i = 0; i < 8; i++) {
        if (a->label[i] != b->label[i])
            return 0;
        if (!a->label[i])
            break;
    }
    for (i = 0; i < 16; i++) {
        if (a->value[i] != b->value[i])
            return 0;
        if (!a->value[i])
            break;
    }
    return 1;
}

/* the voice page's rows: the slot, its source, and its settings */
static void voice_row(int i, mz_row_t *r)
{
    static const char *const LAB[HW_NENC] = {"SLOT", "SOURCE", "TUNE", "BRIGHT", "DECAY", "LEVEL", "FB"};
    const mz_slot_t *s = &slots[ui.vslot];
    int k;
    for (k = 0; LAB[i][k]; k++)
        r->label[k] = LAB[i][k];
    r->label[k] = 0;
    r->hot = hw_ms() < ui.vhot[i];
    switch (i) {
    case 0:
        mz_int(r->value, ui.vslot + 1);
        mz_cat(r->value, " / 4");
        break;
    case 1:
        if (s->src)
            mz_cat(r->value, VB_NAME[s->src - 1]);
        else
            mz_cat(r->value, ui.vslot == 0 ? "- (OWN FM)" : "- (= SLOT 1)");
        break;
    case 2:
        mz_fix(r->value, s->tune, 2);
        mz_cat(r->value, " OCT");
        break;
    case 3:
        mz_fix(r->value, s->bright, 2);
        mz_cat(r->value, " RAD");
        break;
    case 4:
        mz_cat(r->value, "X");
        mz_fix(r->value, s->dec_x, 2);
        break;
    case 5:
        mz_fix(r->value, s->level_db, 1);
        mz_cat(r->value, " DB");
        break;
    case 6:
        mz_fix(r->value, s->fb, 2);
        mz_cat(r->value, " RAD");
        break;
    }
}

/* the voice page's plot: the four slots, what each sound of the project falls back to */
static void voice_plot(int h)
{
    int i;
    (void)h;
    for (i = 0; i < MZ_SLOTS; i++) {
        const mz_slot_t *s = &slots[i];
        int y = 2 + i * 15;
        char t[24];
        t[0] = 0;
        mz_int(t, i + 1);
        scr_text(4, y + 3, 1, t, i == ui.vslot ? C_HOT : C_LAB);
        if (i == ui.vslot)
            scr_rect(0, y, 240, 14, C_HOT);
        t[0] = 0;
        if (s->src)
            mz_cat(t, VB_NAME[s->src - 1]);
        else
            mz_cat(t, i == 0 ? "-  OWN FM" : "-  = SLOT 1");
        scr_text(16, y + 3, 1, t, s->src ? C_VAL : C_DIMC);
    }
}

static void voice_turn(const mz_in_t *in)
{
    mz_slot_t *s = &slots[ui.vslot];
    int i;
    for (i = 0; i < HW_NENC; i++) {
        int32_t d = in->enc[i];
        if (!d)
            continue;
        ui.vhot[i] = in->ms + 400u;
        switch (i) {
        case 0:
            ui.vslot = ((ui.vslot + d) % MZ_SLOTS + MZ_SLOTS) % MZ_SLOTS;
            s = &slots[ui.vslot];
            break;
        case 1:
            s->src = (uint8_t)((((int)s->src + d) % (NVB + 1) + (NVB + 1)) % (NVB + 1));
            break;
        case 2:
            s->tune = m_clamp(s->tune + (float)d * 0.0833333f, -5.0f, 5.0f);   /* a twelfth of an octave a detent */
            break;
        case 3:
            s->bright = m_clamp(s->bright + (float)d * 0.1f, -10.0f, 10.0f);
            break;
        case 4:
            s->dec_x = m_clamp(s->dec_x * m_exp2((float)d * (1.0f / 6.0f)), 0.05f, 20.0f);
            break;
        case 5:
            s->level_db = m_clamp(s->level_db + (float)d * 0.5f, -40.0f, 12.0f);
            break;
        case 6:
            s->fb = m_clamp(s->fb + (float)d * 0.02f, -2.0f, 2.0f);
            break;
        }
        slot_rev++;
    }
}

static void draw_rows(void)
{
    static const char *const TAG[HW_NENC] = {"SL", "AL", "PR", "K1", "K2", "K3", "K4"};
    int i;
    for (i = 0; i < HW_NENC; i++) {
        mz_row_t r;
        int y = 20 + i * 20;
        r.tag = TAG[i];
        r.label[0] = r.value[0] = 0;
        r.hot = r.alert = 0;
        if (ui.vpage)
            voice_row(i, &r);
        else
            pj_row(i, &r);
        if (ui.row_ok[i] && row_same(&r, &ui.rows[i]))
            continue;
        ui.rows[i] = r;
        ui.row_ok[i] = 1;
        hw_strip_begin(y, 20);
        if (r.hot)
            hw_fill(0, 0, 3, 19, C_HOT);
        scr_text(6, 7, 1, TAG[i], C_DIMC);
        scr_text(22, 7, 1, r.label, r.hot ? C_HOT : C_LAB);
        scr_text(66, 3, 2, r.value, r.alert ? C_RED : r.hot ? C_HOT : C_VAL);
        scr_hline(0, 19, 240, C_RULE);
        hw_strip_end();
    }
}

static void draw_foot(void)
{
    char t[40];
    float db = mz_out_db(), gr = ear.gr;
    int w = (int)((db + 60.0f) * (100.0f / 60.0f)), g = (int)(-gr * 4.0f);
    if (w < 0)
        w = 0;
    if (w > 100)
        w = 100;
    if (g > 40)
        g = 40;
    hw_strip_begin(222, 18);
    scr_hline(0, 0, 240, C_RULE);
    scr_text(2, 3, 1, "OUT", C_LAB);
    hw_fill(22, 3, 100, 6, C_RULE);
    hw_fill(22, 3, w, 6, db > -6.0f ? C_VAL : C_GRN);
    scr_text(126, 3, 1, "GR", C_LAB);
    hw_fill(140, 3, 40, 6, C_RULE);
    if (g > 0)
        hw_fill(140, 3, g, 6, C_RED);
    t[0] = 0;
    mz_fix(t, gr, 1);
    scr_text(184, 3, 1, t, g > 0 ? C_RED : C_DIMC);
    t[0] = 0;
    mz_cat(t, "SPD ");
    mz_int(t, (int32_t)(body.agit + 0.5f));
    mz_cat(t, " REV ");
    mz_fix(t, body.revs, 1);
    mz_cat(t, " STILL ");
    mz_fix(t, (float)(body.still_all > 999000u ? 999000u : body.still_all) * 0.001f, 1);
    mz_cat(t, " E");
    mz_int(t, (int32_t)(body.energy * 99.0f));
    scr_text(2, 11, 1, t, C_DIMC);
    hw_strip_end();
}

void mz_frame(void)
{
    uint32_t now = hw_ms(), dt = now - ui.last_ms, live_keys, bit;
    int i;
    if (dt > 200u)
        dt = 200u;
    if (dt == 0u)
        dt = 1u;
    ui.last_ms = now;
    ui.frames++;
    /* the hand, live */
    for (i = 0; i < HW_NENC; i++)
        in.enc[i] = hw_enc(i);
    in.btn = hw_buttons();
    in.bdown = in.btn & ~ui.prev_btn;
    in.bup = ~in.btn & ui.prev_btn;
    ui.prev_btn = in.btn;
    live_keys = hw_keys();
    in.keys = live_keys;
    in.down = live_keys & ~ui.prev_keys;
    in.up = ~live_keys & ui.prev_keys;
    ui.prev_keys = live_keys;
    for (i = 0; i < HW_NKEYS; i++) {
        in.vel[i] = hw_vel(i);
        in.prs[i] = (live_keys >> i & 1u) && i < HW_NPRESS ? hw_pressure(i) : 0;
    }
    in.ms = now;
    in.dt = dt;
    /* the shell's buttons */
    if (in.bdown & (1u << HB_PLAY)) {
        ui.playing = (uint8_t)!ui.playing;
        ear.fade_to = ui.playing ? 1.0f : 0.0f;
        mz_say(ui.playing ? "PLAY" : "STOP", "");
    }
    if (in.bdown & (1u << HB_HOME)) {
        ui.home_t = now;
        ui.home_done = 0;
        mz_say("HOME", "HOLD = SIMPLE");
    }
    if ((in.btn & (1u << HB_HOME)) && !ui.home_done && now - ui.home_t >= 700u) {
        ui.home_done = 1;
        pj_home();
        mz_say("HOME", "BACK TO SIMPLE");
    }
    if (in.bdown & (1u << HB_REC)) {
        ui.rec_t = now;
        ui.rec_held_done = 0;
    }
    if ((in.btn & (1u << HB_REC)) && !ui.rec_held_done && now - ui.rec_t >= 1000u) {
        ui.rec_held_done = 1;
        gl.state = GL_IDLE;
        gl.n = 0;
        gl.keys = gl.btn = 0;
        mz_say("LOOP", "FORGOTTEN");
    }
    if ((in.bup & (1u << HB_REC)) && !ui.rec_held_done) {
        if (gl.state == GL_IDLE) {
            gl.state = GL_REC;
            gl.n = 0;
            gl.t = 0;
            gl.rec_keys = 0;
            mz_say("REC", "HANDS RECORDED");
        } else if (gl.state == GL_REC) {
            gl_stop_rec();
            mz_say("LOOP", gl.state == GL_LOOP ? "PLAYING HANDS" : "NOTHING");
        } else {
            uint32_t k;                          /* the loop's keys let go */
            for (k = 0; k < HW_NKEYS; k++)
                if ((gl.keys >> k & 1u) && !(live_keys >> k & 1u))
                    in.up |= 1u << k;
            gl.keys = gl.btn = 0;
            for (k = 0; k < HW_NKEYS; k++)
                gl.prs[k] = 0;
            gl.state = GL_IDLE;
            mz_say("LOOP", "STOPPED");
        }
    }
    if (gl.state == GL_REC) {
        gl_record(&in);
        gl.t += dt;
        if (gl.t > 600000u || gl.n >= GL_N)
            gl_stop_rec();
    } else if (gl.state == GL_LOOP) {
        gl_play(&in, dt);
    }
    ui.vpage = (uint8_t)((in.btn >> HB_EDIT) & 1u);    /* EDIT held: the voice page takes the encoders */
    if (ui.vpage != ui.vpage_was) {
        ui.vpage_was = ui.vpage;
        for (i = 0; i < HW_NENC; i++)
            ui.row_ok[i] = 0;
        ui.plot_rev = 0xFFFFFFFFu;
    }
    if (ui.vpage) {                      /* (and they are not the body's: choosing a sound is not a gesture) */
        voice_turn(&in);
        for (i = 0; i < HW_NENC; i++)
            in.enc[i] = 0;
    }
    body_update(&body, &in);
    pj_control(&in, &body);
    /* lights */
    bit = 0;
    if (ui.playing)
        bit |= 1u << HB_PLAY;
    if (gl.state == GL_LOOP || (gl.state == GL_REC && (now / 250u) & 1u))
        bit |= 1u << HB_REC;
    if (in.btn & (1u << HB_HOME))
        bit |= 1u << HB_HOME;
    hw_leds(bit | (in.btn & ~SHELL_BTNS), pj_lit_keys() | in.keys, pj_dim_keys());
    /* the screen */
    if (ear.bad_now && (ui.frames & 63u) == 0)
        ear.bad_now = 0;
    draw_head();
    draw_rows();
    {
        uint32_t rev = ui.vpage ? slot_rev * 7u + (uint32_t)ui.vslot : pj_plot_rev();
        if (rev != ui.plot_rev && now - ui.plot_at >= 50u) {
            ui.plot_rev = rev;
            ui.plot_at = now;
            hw_strip_begin(160, 62);
            if (ui.vpage)
                voice_plot(62);
            else
                pj_plot(62);
            hw_strip_end();
        }
    }
    if (now - ui.foot_at >= 120u) {
        ui.foot_at = now;
        draw_foot();
    }
}
