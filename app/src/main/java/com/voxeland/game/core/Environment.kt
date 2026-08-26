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
        // day: ash gray-blue; night: very near black; dusk: dried-blood red
        var r = 0.020f + 0.26f * d + 0.28f * glow
        var g = 0.022f + 0.27f * d + 0.07f * glow
        var b = 0.034f + 0.30f * d + 0.05f * glow
        val m = max(r, max(g, b))
        if (m > 1f) { r /= m; g /= m; b /= m }
        out[0] = r; out[1] = g; out[2] = b
    }

    /**
     * Horizontal direction sunlight travels, normalised. Light shafts are
     * baked pointing into their rooms; the shader compares them against this
     * so beams swing round and die out as the day turns.
     */
    fun sunTravelXZ(out: FloatArray) {
        val a = (time - 0.25f) * 2f * Math.PI.toFloat()
        val sx = cos(a)
        val sz = 0.34f                     // the arc leans, so beams are not purely east-west
        val len = kotlin.math.sqrt(sx * sx + sz * sz)
        out[0] = -sx / len; out[1] = -sz / len
    }

    /** 0 below the horizon, rising to 1 with the sun overhead */
    val sunUp: Float get() = smooth(sunHeight.coerceIn(0f, 1f))

    /** sunlight tint: sodium-orange at the edges of the day, ashen at noon */
    fun sunTint(out: FloatArray) {
        val h = sunHeight.coerceIn(0f, 1f)
        val t = smooth(h)
        out[0] = 1.18f - 0.16f * t
        out[1] = 0.92f + 0.04f * t
        out[2] = 0.74f + 0.28f * t
    }

    /** airborne dust: worst in the dry afternoon, and always thicker indoors */
    val dustLevel: Float
        get() {
            val h = hour
            val afternoon = if (h in 10f..19f) smooth(1f - abs(h - 14.5f) / 4.5f) else 0f
            return 0.45f + 0.55f * afternoon
        }

    /** global light multiplier applied to all block faces */
    val blockLight: Float get() = 0.015f + 0.985f * daylight

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
