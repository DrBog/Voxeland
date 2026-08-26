#!/usr/bin/env python3
"""Procedural asset generator for Voxeland.

Synthesizes every sound effect and ambient bed in the game from noise/DSP
primitives (no samples), plus the launcher icons. Music is intentionally
absent — composition is left to the project owner.

Run from repo root:  python3 tools/gen_assets.py
"""
import os, struct, zlib, wave
import numpy as np

SR = 22050
ROOT = os.path.join(os.path.dirname(__file__), "..")
SND = os.path.join(ROOT, "app/src/main/assets/sounds")
os.makedirs(SND, exist_ok=True)
rng = np.random.default_rng(1349)

# ---------------------------------------------------------------- helpers

def save(name, x, gain=0.9):
    x = np.asarray(x, dtype=np.float64)
    m = np.max(np.abs(x)) or 1.0
    x = x / m * gain
    data = (x * 32767).astype("<i2").tobytes()
    with wave.open(os.path.join(SND, name), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(data)
    print("wrote", name, f"{len(data)/1024:.0f} KiB")

def t_axis(dur):
    return np.arange(int(SR * dur)) / SR

def noise(dur):
    return rng.standard_normal(int(SR * dur))

def brown(dur):
    n = noise(dur)
    b = np.cumsum(n)
    b -= np.linspace(0, b[-1], len(b))          # remove drift so loops meet
    return b / (np.max(np.abs(b)) or 1)

def lowpass(x, alpha):
    y = np.empty_like(x); acc = 0.0
    for i, v in enumerate(x):
        acc += alpha * (v - acc); y[i] = acc
    return y

def lowpass_fft(x, cutoff):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    X[f > cutoff] *= np.exp(-(f[f > cutoff] - cutoff) / (cutoff * 0.5 + 1))
    return np.fft.irfft(X, len(x))

def bandpass_fft(x, lo, hi, soft=0.3):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    g = np.ones_like(f)
    g[f < lo] = np.exp(-(lo - f[f < lo]) / (lo * soft + 1))
    g[f > hi] = np.exp(-(f[f > hi] - hi) / (hi * soft + 1))
    return np.fft.irfft(X * g, len(x))

def env_ar(n, a, r):
    """attack/release envelope in samples"""
    e = np.ones(n)
    a = max(1, int(a)); r = max(1, int(r))
    e[:a] = np.linspace(0, 1, a)
    e[-r:] *= np.linspace(1, 0, r)
    return e

def loopable(x, fade=0.6):
    """crossfade tail into head so the buffer loops seamlessly"""
    n = int(SR * fade)
    y = x[:-n].copy()
    w = np.linspace(0, 1, n)
    y[:n] = y[:n] * w + x[-n:] * (1 - w)
    return y

def reverbish(x, taps=((0.043, 0.4), (0.089, 0.28), (0.153, 0.19), (0.221, 0.12))):
    y = x.copy()
    for dt, g in taps:
        d = int(dt * SR)
        y[d:] += x[:-d] * g
    return y

# ---------------------------------------------------------------- ambient beds

def amb_wind():
    dur = 14
    t = t_axis(dur)
    base = lowpass_fft(noise(dur), 420)
    # two integer-cycle LFOs keep the loop seamless
    lfo = 0.55 + 0.30 * np.sin(2 * np.pi * 3 * t / dur) + 0.15 * np.sin(2 * np.pi * 7 * t / dur + 1.3)
    whistle = bandpass_fft(noise(dur), 700, 1150) * (0.10 + 0.10 * np.sin(2 * np.pi * 5 * t / dur + 0.7))
    grit = bandpass_fft(noise(dur), 1800, 3200) * 0.03
    save("amb_wind.wav", loopable(base * lfo + whistle + grit), 0.8)

def amb_city():
    dur = 16
    t = t_axis(dur)
    rumble = lowpass_fft(brown(dur), 90) * (0.8 + 0.2 * np.sin(2 * np.pi * 2 * t / dur))
    x = rumble * 1.2
    # distant metal creaks
    for i in range(6):
        at = int(SR * (0.9 + i * 2.45))
        d = int(SR * rng.uniform(0.5, 1.1))
        f0 = rng.uniform(180, 420)
        tt = np.arange(d) / SR
        sweep = f0 * (1 + 0.25 * np.sin(2 * np.pi * 1.7 * tt + rng.uniform(0, 6)))
        creak = np.sin(2 * np.pi * np.cumsum(sweep) / SR) * env_ar(d, SR*0.15, SR*0.3)
        creak = bandpass_fft(creak * (1 + 0.6 * noise(d / SR)[:d] * 0.2), 150, 900) * 0.10
        end = min(len(x), at + d)
        x[at:end] += creak[:end - at]
    # far-off single moan, drowned in reverb
    at = int(SR * 9.2); d = int(SR * 1.6)
    tt = np.arange(d) / SR
    moan = np.sin(2 * np.pi * (110 - 18 * tt) * tt) * env_ar(d, SR*0.5, SR*0.8)
    x[at:at+d] += reverbish(bandpass_fft(moan, 90, 500)) [:d]* 0.07
    save("amb_city.wav", loopable(x), 0.8)

def amb_night():
    dur = 16
    t = t_axis(dur)
    drone = lowpass_fft(brown(dur), 65) * 1.1
    # slow beating dark pad: two detuned sines, integer cycles for looping
    pad = 0.10 * np.sin(2 * np.pi * 55 * t) * (0.6 + 0.4 * np.sin(2 * np.pi * 4 * t / dur))
    pad += 0.06 * np.sin(2 * np.pi * 82.5 * t) * (0.6 + 0.4 * np.sin(2 * np.pi * 6 * t / dur + 2.0))
    x = drone + pad
    # sparse dead-branch ticks
    for i in range(10):
        at = int(rng.uniform(0.2, dur - 0.3) * SR)
        d = int(SR * 0.05)
        x[at:at+d] += bandpass_fft(noise(0.05), 2000, 5200)[:d] * env_ar(d, 8, d-10)[:d] * 0.05
    save("amb_night.wav", loopable(x), 0.8)

def amb_interior():
    dur = 13
    t = t_axis(dur)
    muffled = lowpass_fft(brown(dur), 120) * (0.7 + 0.3 * np.sin(2 * np.pi * 2 * t / dur))
    x = muffled
    # wood creaks of the structure settling
    for i in range(5):
        at = int(SR * (1.2 + i * 2.3))
        d = int(SR * rng.uniform(0.25, 0.5))
        tt = np.arange(d) / SR
        f = rng.uniform(300, 700)
        cr = np.sign(np.sin(2 * np.pi * f * tt * (1 + 2.5 * tt))) * env_ar(d, SR*0.05, SR*0.12)
        x[at:at+d] += bandpass_fft(cr, 250, 1400)[:d] * 0.05
    save("amb_interior.wav", loopable(x), 0.75)

# ---------------------------------------------------------------- zombies

def groan(dur, f0, wobble, breath, seed_shift=0.0):
    d = int(SR * dur)
    tt = np.arange(d) / SR
    f = f0 * (1 + wobble * np.sin(2 * np.pi * 2.3 * tt + seed_shift) + 0.04 * np.sin(2 * np.pi * 9 * tt))
    ph = 2 * np.pi * np.cumsum(f) / SR
    # rough glottal-ish tone: fundamental + strong odd harmonics, jitter
    v = np.sin(ph) + 0.55 * np.sin(2 * ph + 0.3) + 0.35 * np.sin(3 * ph) + 0.18 * np.sin(5 * ph)
    v *= 1 + 0.35 * lowpass_fft(noise(dur)[:d], 40)      # amplitude jitter
    v += breath * bandpass_fft(noise(dur)[:d], 300, 1800)
    # throat formant
    v = bandpass_fft(v, 90, 1100)
    v *= env_ar(d, SR * dur * 0.25, SR * dur * 0.35)
    return reverbish(v, (((0.031, 0.25), (0.067, 0.15))))

def zombies():
    save("zombie_groan1.wav", groan(1.7, 92, 0.10, 0.30, 0.0), 0.85)
    save("zombie_groan2.wav", groan(2.2, 74, 0.16, 0.40, 2.1), 0.85)
    save("zombie_groan3.wav", groan(1.3, 118, 0.08, 0.22, 4.0), 0.85)
    # alert snarl: fast upward sweep, harsher
    d = int(SR * 0.8); tt = np.arange(d) / SR
    f = 120 + 260 * tt
    s = np.sign(np.sin(2 * np.pi * np.cumsum(f) / SR)) * 0.6 + bandpass_fft(noise(0.8), 400, 2600)[:d]
    save("zombie_alert.wav", bandpass_fft(s, 150, 2600) * env_ar(d, SR*0.03, SR*0.25), 0.9)
    # attack bite/lunge
    d = int(SR * 0.5)
    s = bandpass_fft(noise(0.5), 200, 3000)[:d] * env_ar(d, 30, SR*0.35)
    s += groan(0.5, 140, 0.05, 0.5)[:d] * 0.8
    save("zombie_attack.wav", s, 0.9)
    # death rattle: falling tone into gurgle
    d = int(SR * 1.4); tt = np.arange(d) / SR
    f = 130 * np.exp(-1.6 * tt)
    g = np.sin(2 * np.pi * np.cumsum(f) / SR) * (1 + 0.7 * lowpass_fft(noise(1.4)[:d], 30))
    g += 0.5 * bandpass_fft(noise(1.4)[:d], 150, 700) * np.exp(-3 * tt)
    save("zombie_die.wav", bandpass_fft(g, 80, 900) * env_ar(d, SR*0.02, SR*0.9), 0.85)

# ---------------------------------------------------------------- player / world sfx

def thud(dur, lo, hi, punch=0.012):
    d = int(SR * dur)
    x = bandpass_fft(noise(dur), lo, hi)[:d]
    return x * np.exp(-np.arange(d) / (SR * punch * 4)) * env_ar(d, 4, int(d*0.7))

def sfx():
    # footsteps: short filtered bursts, two surfaces, two variants each
    for i, (lo, hi, dur) in enumerate([(90, 900, 0.16), (110, 1100, 0.14)]):
        save(f"step_concrete{i+1}.wav", thud(dur, lo, hi), 0.5)
    for i, (lo, hi, dur) in enumerate([(60, 500, 0.18), (70, 620, 0.16)]):
        soft = thud(dur, lo, hi) + bandpass_fft(noise(dur), 900, 2400)[:int(SR*dur)] * 0.12
        save(f"step_dirt{i+1}.wav", soft, 0.45)
    # melee
    save("hit_flesh.wav", thud(0.22, 120, 1400, 0.02), 0.85)
    save("hit_block.wav", thud(0.15, 200, 2600, 0.012), 0.8)
    # mining/breaking
    d = int(SR * 0.45)
    crack = thud(0.45, 300, 4000, 0.02)
    for at, g in [(0.05, 0.6), (0.11, 0.45), (0.2, 0.8)]:
        a = int(at * SR); crack[a:a+300] += bandpass_fft(noise(0.02), 800, 5200)[:300] * g
    save("block_break.wav", crack, 0.85)
    save("block_place.wav", thud(0.18, 150, 1200, 0.02), 0.7)
    # hurt grunts
    for i, f0 in enumerate((150, 128)):
        d = int(SR * 0.45); tt = np.arange(d) / SR
        v = np.sin(2 * np.pi * f0 * (1 - 0.3 * tt) * tt)
        v = bandpass_fft(v + 0.4 * bandpass_fft(noise(0.45), 300, 1500)[:d], 100, 1500)
        save(f"player_hurt{i+1}.wav", v * env_ar(d, 300, int(d*0.7)), 0.85)
    d = int(SR * 2.2); tt = np.arange(d) / SR
    f = 120 * np.exp(-1.1 * tt)
    v = np.sin(2 * np.pi * np.cumsum(f) / SR) * (1 + 0.4 * lowpass_fft(noise(2.2)[:d], 25))
    save("player_die.wav", reverbish(bandpass_fft(v, 60, 700)) * env_ar(d, SR*0.05, SR*1.4), 0.9)
    # heartbeat: lub-dub
    d = int(SR * 0.9); x = np.zeros(d)
    for at, g in [(0.0, 1.0), (0.18, 0.7)]:
        a = int(at * SR); n = int(SR * 0.12)
        x[a:a+n] += lowpass_fft(noise(0.12), 150)[:n] * env_ar(n, 40, int(n*0.8)) * g
    save("heartbeat.wav", x, 0.9)
    # consumables
    d = int(SR * 0.7); x = np.zeros(d)
    for i in range(3):
        a = int(SR * 0.22 * i); n = int(SR * 0.09)
        x[a:a+n] += bandpass_fft(noise(0.09), 300, 2500)[:n] * env_ar(n, 60, int(n*0.6)) * (0.9 - i*0.15)
    save("eat.wav", x, 0.6)
    d = int(SR * 0.8); tt = np.arange(d) / SR
    glug = np.sin(2 * np.pi * (260 - 120 * (tt % 0.25) / 0.25)) * 0.5
    save("drink.wav", lowpass_fft(glug + bandpass_fft(noise(0.8), 400, 1400)[:d] * 0.15, 900) * env_ar(d, 400, int(d*0.4)), 0.55)
    # cloth wrap for bandage
    d = int(SR * 0.9)
    save("bandage.wav", bandpass_fft(noise(0.9), 900, 4200)[:d] * (0.4 + 0.6*np.abs(np.sin(2*np.pi*4*np.arange(d)/SR))) * env_ar(d, 500, int(d*0.3)), 0.5)
    # crafting: taps + scrape
    d = int(SR * 1.1); x = np.zeros(d)
    for at in (0.05, 0.3, 0.55, 0.8):
        a = int(at * SR); n = int(SR * 0.08)
        x[a:a+n] += bandpass_fft(noise(0.08), 600, 3600)[:n] * env_ar(n, 20, int(n*0.7)) * 0.8
    x += bandpass_fft(noise(1.1), 1200, 3200)[:d] * 0.08
    save("craft.wav", x, 0.6)
    save("pickup.wav", thud(0.12, 500, 3200, 0.008), 0.5)
    d = int(SR * 0.5)
    save("container_open.wav", bandpass_fft(noise(0.5), 200, 1800)[:d] * env_ar(d, SR*0.05, int(d*0.6)), 0.55)
    # UI
    d = int(SR * 0.06)
    save("ui_click.wav", bandpass_fft(noise(0.06), 1200, 4800)[:d] * env_ar(d, 8, int(d*0.8)), 0.4)
    d = int(SR * 0.25); tt = np.arange(d) / SR
    save("ui_open.wav", np.sin(2 * np.pi * (320 + 160 * tt) * tt) * env_ar(d, 60, int(d*0.7)), 0.35)
    # level up: rising grim chord (kept dry & short — not musical scoring)
    d = int(SR * 1.2); tt = np.arange(d) / SR; x = np.zeros(d)
    for f, gg in ((110, 0.5), (165, 0.35), (220, 0.3)):
        x += np.sin(2 * np.pi * f * tt) * gg * np.minimum(1, tt * 6)
    save("level_up.wav", reverbish(x * env_ar(d, SR*0.05, int(d*0.5))), 0.55)
    d = int(SR * 0.4); tt = np.arange(d) / SR
    save("skill_unlock.wav", (np.sin(2*np.pi*196*tt) + 0.5*np.sin(2*np.pi*392*tt)) * env_ar(d, 200, int(d*0.7)), 0.5)

# ---------------------------------------------------------------- launcher icon (raw PNG writer)

def write_png(path, rgba):
    h, w = rgba.shape[:2]
    raw = b"".join(b"\x00" + rgba[y].tobytes() for y in range(h))
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f: f.write(png)
    print("wrote", path)

def icon(size):
    img = np.zeros((size, size, 4), dtype=np.uint8)
    yy, xx = np.mgrid[0:size, 0:size].astype(float) / size
    # blood-dusk sky gradient
    img[..., 0] = (46 + 60 * yy).astype(np.uint8)
    img[..., 1] = (18 + 14 * yy).astype(np.uint8)
    img[..., 2] = (22 + 16 * yy).astype(np.uint8)
    img[..., 3] = 255
    r = np.random.default_rng(7)
    # skyline of voxel towers
    x = 0
    while x < size:
        bw = max(2, int(size * r.uniform(0.08, 0.16)))
        bh = int(size * r.uniform(0.30, 0.72))
        top = size - bh
        shade = int(r.uniform(16, 34))
        img[top:size, x:min(size, x+bw), 0] = shade
        img[top:size, x:min(size, x+bw), 1] = shade
        img[top:size, x:min(size, x+bw), 2] = shade + 4
        # sparse dead windows
        for wy in range(top + 2, size - 2, max(2, size // 16)):
            for wx in range(x + 1, min(size, x + bw) - 1, max(2, size // 16)):
                if r.random() < 0.16:
                    c = 120 if r.random() < 0.3 else 52
                    img[wy, wx, :3] = (c, c - 30 if c > 60 else c, 30)
        x += bw + max(1, size // 48)
    return img

def icons():
    for dpi, px in (("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)):
        write_png(os.path.join(ROOT, f"app/src/main/res/mipmap-{dpi}/ic_launcher.png"), icon(px))

if __name__ == "__main__":
    amb_wind(); amb_city(); amb_night(); amb_interior()
    zombies(); sfx(); icons()
    total = sum(os.path.getsize(os.path.join(SND, f)) for f in os.listdir(SND))
    print(f"total sound payload: {total/1024/1024:.1f} MiB")
