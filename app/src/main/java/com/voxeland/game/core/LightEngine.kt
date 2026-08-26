package com.voxeland.game.core

import kotlin.math.min

/**
 * Sky-light propagation.
 *
 * Produces a 0..[MAX] "how much of the open sky reaches this cell" value per
 * block, flooded through doorways and broken windows. A room lit by a single
 * window is bright at the glass and black at the back wall — which is the
 * difference between a voxel box and somewhere you are not sure is safe.
 *
 * The value is time-independent; the shader multiplies it by the current
 * daylight, so interiors stay dark both day and night.
 */
object LightEngine {
    const val MAX = 10

    /** padding so light arriving from neighbouring chunks is accounted for */
    private const val R = 8

    /** A finished light field, valid until the next compute() on this thread. */
    class Field(private val b: Buf, private val bx: Int, private val bz: Int) {
        /** light at a world cell, or -1 outside the padded region */
        fun at(wx: Int, y: Int, wz: Int): Int {
            if (y < 0 || y >= CHUNK_H) return if (y >= CHUNK_H) MAX else 0
            val px = wx - bx; val pz = wz - bz
            if (px < 0 || pz < 0 || px >= b.pw || pz >= b.pw) return -1
            return b.light[(px * b.pw + pz) * CHUNK_H + y].toInt()
        }

        fun copyInto(out: ByteArray) {
            for (x in 0 until CHUNK_SIZE) for (z in 0 until CHUNK_SIZE) {
                val src = ((x + R) * b.pw + (z + R)) * CHUNK_H
                val dst = (x * CHUNK_SIZE + z) * CHUNK_H
                System.arraycopy(b.light, src, out, dst, CHUNK_H)
            }
        }
    }

    class Buf {
        val pw = CHUNK_SIZE + 2 * R
        val cost = ByteArray(pw * pw * CHUNK_H)      // per-cell traversal cost, 0 = opaque
        val light = ByteArray(pw * pw * CHUNK_H)
        val queue = IntArray(pw * pw * CHUNK_H)
        val top = IntArray(pw * pw)
    }

    private val bufs = ThreadLocal.withInitial { Buf() }

    fun compute(world: World, cx: Int, cz: Int): Field {
        val b = bufs.get()
        val pw = b.pw
        val bx = cx * CHUNK_SIZE - R
        val bz = cz * CHUNK_SIZE - R
        java.util.Arrays.fill(b.light, 0)

        var head = 0; var tail = 0

        // 1. gather traversal costs, and seed vertical sky columns.
        //    Only scan up to whatever actually stands in each column — above a
        //    suburb that is ~30 blocks instead of the full 96.
        for (px in 0 until pw) for (pz in 0 until pw) {
            val wx = bx + px; val wz = bz + pz
            val ceiling = min(CHUNK_H - 1, world.columnTop(wx, wz))
            b.top[px * pw + pz] = ceiling
            val base = (px * pw + pz) * CHUNK_H

            for (y in 0..ceiling) {
                b.cost[base + y] = Blocks.lightCost(world.block(wx, y, wz)).toByte()
            }
            // everything above the column's ceiling is open sky
            for (y in ceiling + 1 until CHUNK_H) {
                b.cost[base + y] = 1
                b.light[base + y] = MAX.toByte()
            }
            // sunlight falls straight down at full strength until something stops it
            var level = MAX
            for (y in ceiling downTo 0) {
                val c = b.cost[base + y].toInt()
                if (c <= 0) break                       // opaque: the column is capped
                level -= (c - 1)                        // dirty glass costs extra
                if (level <= 0) break
                b.light[base + y] = level.toByte()
                if (level == MAX) b.queue[tail++] = base + y
            }
        }

        // 2. flood outward from every lit cell
        //    (seed anything the vertical pass lit but did not already queue)
        for (px in 0 until pw) for (pz in 0 until pw) {
            val base = (px * pw + pz) * CHUNK_H
            for (y in 0..b.top[px * pw + pz]) {
                val l = b.light[base + y].toInt()
                if (l in 1 until MAX) b.queue[tail++] = base + y
            }
        }

        while (head < tail) {
            val idx = b.queue[head++]
            val level = b.light[idx].toInt()
            if (level <= 1) continue
            val y = idx % CHUNK_H
            val col = idx / CHUNK_H
            val px = col / pw; val pz = col % pw

            // six neighbours
            spread(b, px - 1, pz, y, level, ::inRange, pw)?.let { if (tail < b.queue.size) b.queue[tail++] = it }
            spread(b, px + 1, pz, y, level, ::inRange, pw)?.let { if (tail < b.queue.size) b.queue[tail++] = it }
            spread(b, px, pz - 1, y, level, ::inRange, pw)?.let { if (tail < b.queue.size) b.queue[tail++] = it }
            spread(b, px, pz + 1, y, level, ::inRange, pw)?.let { if (tail < b.queue.size) b.queue[tail++] = it }
            if (y > 0) spreadY(b, px, pz, y - 1, level, pw)?.let { if (tail < b.queue.size) b.queue[tail++] = it }
            if (y < CHUNK_H - 1) spreadY(b, px, pz, y + 1, level, pw)?.let { if (tail < b.queue.size) b.queue[tail++] = it }
        }

        return Field(b, bx, bz)
    }

    private fun inRange(v: Int, pw: Int) = v in 0 until pw

    private fun spread(b: Buf, px: Int, pz: Int, y: Int, level: Int, check: (Int, Int) -> Boolean, pw: Int): Int? {
        if (!check(px, pw) || !check(pz, pw)) return null
        return push(b, (px * pw + pz) * CHUNK_H + y, level)
    }

    private fun spreadY(b: Buf, px: Int, pz: Int, y: Int, level: Int, pw: Int): Int? =
        push(b, (px * pw + pz) * CHUNK_H + y, level)

    private fun push(b: Buf, idx: Int, level: Int): Int? {
        val c = b.cost[idx].toInt()
        if (c <= 0) return null                          // opaque
        val next = level - c
        if (next <= 0) return null
        if (b.light[idx].toInt() >= next) return null
        b.light[idx] = next.toByte()
        return idx
    }
}
