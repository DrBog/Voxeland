package com.voxeland.game.core

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin

/**
 * The environmental clock. A full 24-hour in-game day spans 48 real
 * minutes; every effect (light, fog, sky, ambience, zombie boldness)
 * is a continuous function of the sun's position — nothing snaps.
 */
class Environment {
    companion object {
        const val DAY_SECONDS = 2880f          // 48 real minutes = 24 game hours
        const val START_HOUR = 7.5f            // fresh saves wake at dawn
    }

    /** time of day in [0,1), 0 = midnight */
    var time: Float = START_HOUR / 24f
    var dayCount: Int = 0

    fun advance(dt: Float) {
        time += dt / DAY_SECONDS
        if (time >= 1f) { time -= 1f; dayCount++ }
    }

    val hour: Float get() = time * 24f

    /** sun elevation proxy in [-1,1]; >0 above horizon */
    val sunHeight: Float get() = sin((time - 0.25f) * 2f * Math.PI.toFloat())

    /** 0 at black night → 1 at high noon, with long realistic twilights */
    val daylight: Float
        get() {
            val s = sunHeight
            return smooth(((s + 0.12f) / 0.35f).coerceIn(0f, 1f))
        }

    /** how dark it feels — drives zombie aggression and detection */
    val darkness: Float get() = 1f - daylight

    /** dawn/dusk redness factor for the grim blood-sky */
    val duskGlow: Float
        get() {
            val s = abs(sunHeight)
            return smooth((1f - s / 0.30f).coerceIn(0f, 1f)) * daylightEdge()
        }

    private fun daylightEdge(): Float = smooth((1f - abs(daylight - 0.5f) * 2f).coerceIn(0f, 1f))

    /** morning ground fog: thickest shortly after dawn, mild otherwise */
    val fogDensity: Float
        get() {
            val h = hour
            val morning = if (h in 5f..10f) smooth(1f - abs(h - 7f) / 3f) else 0f
            val night = darkness * 0.35f
            return 0.9f + morning * 1.6f + night * 0.9f
        }

    /** sky/fog colour, grim and desaturated */
    fun skyColor(out: FloatArray) {
        val d = daylight
        val glow = duskGlow
        // day: ash gray-blue; night: near-black blue; dusk: dried-blood red
        var r = 0.06f + 0.32f * d + 0.30f * glow
        var g = 0.06f + 0.33f * d + 0.08f * glow
        var b = 0.09f + 0.36f * d + 0.06f * glow
        val m = max(r, max(g, b))
        if (m > 1f) { r /= m; g /= m; b /= m }
        out[0] = r; out[1] = g; out[2] = b
    }

    /** global light multiplier applied to all block faces */
    val blockLight: Float get() = 0.10f + 0.90f * daylight

    /** wind intensity swells through afternoon and in the dead of night */
    val windLevel: Float
        get() {
            val h = hour
            val afternoon = if (h in 12f..19f) smooth(1f - abs(h - 15.5f) / 3.5f) else 0f
            return 0.45f + 0.35f * afternoon + 0.25f * darkness
        }

    fun clockString(): String {
        val h = (hour).toInt()
        val m = ((hour - h) * 60).toInt()
        return String.format("%02d:%02d", h, m)
    }

    private fun smooth(t: Float) = t * t * (3f - 2f * t)
}
