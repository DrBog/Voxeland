package com.voxeland.game.core

import kotlin.math.min

/**
 * Pupil and rod adaptation.
 *
 * Brightening is fast (the pupil contracts in well under a second) but dark
 * adaptation is slow, so stepping out of daylight into a boarded-up room
 * leaves you effectively blind for several seconds before shapes resolve.
 * That lag is the whole point — it is what makes a doorway a decision.
 */
class EyeAdaptation {

    companion object {
        /** seconds to close most of the gap when the scene gets brighter */
        const val BRIGHTEN_TAU = 0.55f
        /** seconds to close most of the gap when the scene goes dark */
        const val DARKEN_TAU = 5.0f
        const val MIN_EXPOSURE = 0.85f
        const val MAX_EXPOSURE = 4.3f
    }

    /** smoothed scene luminance the eye is currently tuned to, 0..1 */
    var adapted = 1f
        private set

    fun reset(level: Float) { adapted = level.coerceIn(0f, 1f) }

    fun update(target: Float, dt: Float) {
        val t = target.coerceIn(0f, 1f)
        val tau = if (t > adapted) BRIGHTEN_TAU else DARKEN_TAU
        adapted += (t - adapted) * min(1f, dt / tau)
        adapted = adapted.coerceIn(0f, 1f)
    }

    /**
     * Gain applied to the rendered scene. Tuned to the dark, the world is
     * lifted; tuned to daylight it is not, which is why a dark room reads
     * as black the moment you walk in.
     */
    val exposure: Float
        get() = (1f / (0.24f + 0.76f * adapted)).coerceIn(MIN_EXPOSURE, MAX_EXPOSURE)
}
