package com.voxeland.game.core

/** Deterministic stateless hashing — the backbone of world generation. */
object Rng {
    fun hash(seed: Long, a: Int, b: Int = 0, c: Int = 0): Long {
        var h = seed xor 0x9E3779B97F4A7C15uL.toLong()
        h = mix(h + a * 0x85EBCA6BL)
        h = mix(h + b * 0xC2B2AE35L)
        h = mix(h + c * 0x27D4EB2FL)
        return h
    }

    private fun mix(v: Long): Long {
        var z = v
        z = (z xor (z ushr 30)) * -0x40a7b892e31b1a47L
        z = (z xor (z ushr 27)) * -0x6b2fb644ecceee15L
        return z xor (z ushr 31)
    }

    /** uniform float in [0,1) from a hash */
    fun toFloat(h: Long): Float = ((h ushr 40).toInt() and 0xFFFFFF) / 16777216f

    fun nextFloat(seed: Long, a: Int, b: Int = 0, c: Int = 0): Float = toFloat(hash(seed, a, b, c))

    fun nextInt(seed: Long, bound: Int, a: Int, b: Int = 0, c: Int = 0): Int =
        (toFloat(hash(seed, a, b, c)) * bound).toInt().coerceIn(0, bound - 1)

    /** cheap 2D value noise in [0,1] */
    fun valueNoise(seed: Long, x: Float, z: Float): Float {
        val x0 = kotlin.math.floor(x).toInt(); val z0 = kotlin.math.floor(z).toInt()
        val fx = x - x0; val fz = z - z0
        val sx = fx * fx * (3 - 2 * fx); val sz = fz * fz * (3 - 2 * fz)
        val v00 = nextFloat(seed, x0, z0); val v10 = nextFloat(seed, x0 + 1, z0)
        val v01 = nextFloat(seed, x0, z0 + 1); val v11 = nextFloat(seed, x0 + 1, z0 + 1)
        val a = v00 + (v10 - v00) * sx
        val b = v01 + (v11 - v01) * sx
        return a + (b - a) * sz
    }
}

/** Small mutable PRNG for sequential draws (entity think noise etc). */
class SplitMix(var state: Long) {
    fun nextLong(): Long {
        state += -0x61c8864680b583ebL
        var z = state
        z = (z xor (z ushr 30)) * -0x40a7b892e31b1a47L
        z = (z xor (z ushr 27)) * -0x6b2fb644ecceee15L
        return z xor (z ushr 31)
    }
    fun nextFloat(): Float = ((nextLong() ushr 40).toInt() and 0xFFFFFF) / 16777216f
    fun nextInt(bound: Int): Int = (nextFloat() * bound).toInt().coerceIn(0, bound - 1)
}
