package com.voxeland.game.core

/**
 * Portable light sources.
 *
 * The wind-up torch you start with is the weak option on purpose: it runs
 * for 60% less than a battery torch on a charge, and throws a dimmer cone —
 * but it never runs out permanently, because you can always shake it back
 * to life. Finding a real flashlight is a genuine upgrade.
 */
object LightSpec {
    /** a fresh set of batteries in a proper flashlight */
    const val ELECTRIC_SECONDS = 420f

    /** the shake torch lasts 60% less than that */
    const val SHAKE_RUNTIME_REDUCTION = 0.60f
    const val SHAKE_SECONDS = ELECTRIC_SECONDS * (1f - SHAKE_RUNTIME_REDUCTION)

    /** percent of a full wind added per second of steady cranking */
    const val CRANK_RATE = 11f

    /** how much shaking converts to charge: percent per (m/s^2 above the threshold) second */
    const val SHAKE_GAIN = 1.6f
    const val SHAKE_THRESHOLD = 6f
}

enum class LightKind(
    val runtimeSeconds: Float,
    /** beam strength handed to the shader */
    val strength: Float,
    val label: String,
) {
    NONE(0f, 0f, "—"),
    SHAKE(LightSpec.SHAKE_SECONDS, 1.15f, "WIND"),
    ELECTRIC(LightSpec.ELECTRIC_SECONDS, 2.1f, "LAMP");

    /** percent of charge burned per second while lit */
    val drainPerSecond: Float
        get() = if (runtimeSeconds <= 0f) 0f else 100f / runtimeSeconds
}
