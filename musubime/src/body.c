/* musubime: the body. How fast each encoder turns, how often it changes direction, how long it has been still, the
 * moment it starts again after stillness, how hard a key is pressed and how fast that changes. The projects put
 * these into how the system reacts (how easily it mutates, its hysteresis, its wiring), not into values. */
#include "mz.h"

#define ONSET_STILL_MS 600u

void body_reset(mz_body_t *b)
{
    int i;
    for (i = 0; i < HW_NENC; i++) {
        b->speed[i] = b->rev[i] = b->onset[i] = 0.0f;
        b->dir[i] = 0;
        b->count[i] = 0.0f;
        b->still[i] = 0u;
    }
    b->agit = b->revs = b->onset_any = b->press = b->press_rate = b->energy = 0.0f;
    b->still_all = 0u;
}

void body_update(mz_body_t *b, const mz_in_t *in)
{
    int i;
    float dt = (float)(in->dt ? in->dt : 1u) * 0.001f;
    float k_spd = m_tc(0.25f, 1.0f / dt), k_rev = 1.0f - m_tc(1.5f, 1.0f / dt);
    float agit = 0.0f, revs = 0.0f, press = 0.0f, pr;
    int moved = 0;
    b->onset_any = 0.0f;
    for (i = 0; i < HW_NENC; i++) {
        int32_t d = in->enc[i];
        float rv = 0.0f;
        b->onset[i] = 0.0f;
        if (d) {
            int8_t s = d > 0 ? 1 : -1;
            if (b->dir[i] && s != b->dir[i])
                rv = 1.0f / dt;
            b->dir[i] = s;
            if (b->still[i] >= ONSET_STILL_MS) {
                b->onset[i] = (float)(b->still[i] > 60000u ? 60000u : b->still[i]) * 0.001f;
                if (b->onset[i] > b->onset_any)
                    b->onset_any = b->onset[i];
            }
            b->still[i] = 0;
            moved = 1;
        } else if (b->still[i] < 0x7FFFFFFFu) {
            b->still[i] += in->dt;
        }
        /* detents in about the last 250 ms, a second: a leaky count, so one detent a frame is not 60 a second */
        b->count[i] = b->count[i] * k_spd + (float)(d < 0 ? -d : d);
        b->speed[i] = b->count[i] * 4.0f;
        b->rev[i] += (rv - b->rev[i]) * k_rev;
        agit += b->speed[i];
        revs += b->rev[i];
    }
    for (i = 0; i < HW_NKEYS; i++) {
        float p = (float)in->prs[i] * (1.0f / 127.0f);
        if (p > press)
            press = p;
    }
    if (in->down || in->up)
        moved = 1;
    if (in->down && b->still_all >= ONSET_STILL_MS) {     /* a key after stillness is an onset too */
        float o = (float)(b->still_all > 60000u ? 60000u : b->still_all) * 0.001f;
        if (o > b->onset_any)
            b->onset_any = o;
    }
    b->still_all = moved ? 0u : b->still_all + in->dt;
    pr = (press - b->press) / dt;
    b->press_rate += (pr - b->press_rate) * 0.3f;
    b->press = press;
    b->agit = agit;
    b->revs = revs;
    {
        float target = m_min(1.0f, agit * (1.0f / 24.0f) + press * 0.6f + revs * 0.15f);
        b->energy += (target - b->energy) * (1.0f - m_tc(4.0f, 1.0f / dt));
    }
}
