package com.voxeland.game.core

import com.voxeland.game.gen.CityPlan
import java.util.concurrent.ConcurrentHashMap

const val CHUNK_SIZE = 16
const val CHUNK_H = 96

class Chunk(val cx: Int, val cz: Int) {
    val blocks = ByteArray(CHUNK_SIZE * CHUNK_H * CHUNK_SIZE)
    @Volatile var generated = false
    @Volatile var dirty = true            // needs remesh

    fun idx(x: Int, y: Int, z: Int) = (x * CHUNK_SIZE + z) * CHUNK_H + y
    fun get(x: Int, y: Int, z: Int): Byte =
        if (y < 0 || y >= CHUNK_H) Blocks.AIR else blocks[idx(x, y, z)]
    fun set(x: Int, y: Int, z: Int, b: Byte) {
        if (y in 0 until CHUNK_H) blocks[idx(x, y, z)] = b
    }
}

/**
 * The block world: procedural city plan + a sparse edit layer for
 * everything the player broke or built. Chunks cache generated blocks.
 */
class World(val seed: Long) {
    val plan = CityPlan(seed)
    private val chunks = ConcurrentHashMap<Long, Chunk>()
    /** player edits, world-position key -> block. Persisted in saves. */
    val edits = ConcurrentHashMap<Long, Byte>()
    /** containers already looted (world-pos key) */
    val looted = ConcurrentHashMap.newKeySet<Long>()

    companion object {
        fun key(cx: Int, cz: Int) = (cx.toLong() shl 32) xor (cz.toLong() and 0xFFFFFFFFL)
        fun posKey(x: Int, y: Int, z: Int) =
            (x.toLong() and 0x3FFFFFF shl 38) or (z.toLong() and 0x3FFFFFF shl 12) or (y.toLong() and 0xFFF)
    }

    fun chunkAt(cx: Int, cz: Int): Chunk? = chunks[key(cx, cz)]

    fun obtainChunk(cx: Int, cz: Int): Chunk = chunks.computeIfAbsent(key(cx, cz)) { Chunk(cx, cz) }

    fun generate(c: Chunk) {
        if (c.generated) return
        val bx = c.cx * CHUNK_SIZE; val bz = c.cz * CHUNK_SIZE
        for (x in 0 until CHUNK_SIZE) for (z in 0 until CHUNK_SIZE) {
            val wx = bx + x; val wz = bz + z
            for (y in 0 until CHUNK_H) {
                c.blocks[c.idx(x, y, z)] = plan.blockAt(wx, y, wz)
            }
        }
        // apply persisted edits that fall inside this chunk
        for ((k, b) in edits) {
            val ex = (k shr 38 and 0x3FFFFFF).toInt().let { if (it >= 0x2000000) it - 0x4000000 else it }
            val ez = (k shr 12 and 0x3FFFFFF).toInt().let { if (it >= 0x2000000) it - 0x4000000 else it }
            val ey = (k and 0xFFF).toInt()
            if (Math.floorDiv(ex, CHUNK_SIZE) == c.cx && Math.floorDiv(ez, CHUNK_SIZE) == c.cz)
                c.set(Math.floorMod(ex, CHUNK_SIZE), ey, Math.floorMod(ez, CHUNK_SIZE), b)
        }
        c.generated = true
        c.dirty = true
    }

    /** Block lookup. Falls back to the pure plan outside loaded chunks. */
    fun block(x: Int, y: Int, z: Int): Byte {
        if (y < 0) return Blocks.STONE
        if (y >= CHUNK_H) return Blocks.AIR
        val c = chunkAt(Math.floorDiv(x, CHUNK_SIZE), Math.floorDiv(z, CHUNK_SIZE))
        if (c != null && c.generated)
            return c.get(Math.floorMod(x, CHUNK_SIZE), y, Math.floorMod(z, CHUNK_SIZE))
        edits[posKey(x, y, z)]?.let { return it }
        return plan.blockAt(x, y, z)
    }

    fun setBlock(x: Int, y: Int, z: Int, b: Byte) {
        if (y !in 0 until CHUNK_H) return
        edits[posKey(x, y, z)] = b
        val cx = Math.floorDiv(x, CHUNK_SIZE); val cz = Math.floorDiv(z, CHUNK_SIZE)
        val c = chunkAt(cx, cz)
        if (c != null && c.generated) {
            c.set(Math.floorMod(x, CHUNK_SIZE), y, Math.floorMod(z, CHUNK_SIZE), b)
            c.dirty = true
            // neighbours need remesh when we touch a border cell
            val lx = Math.floorMod(x, CHUNK_SIZE); val lz = Math.floorMod(z, CHUNK_SIZE)
            if (lx == 0) chunkAt(cx - 1, cz)?.dirty = true
            if (lx == CHUNK_SIZE - 1) chunkAt(cx + 1, cz)?.dirty = true
            if (lz == 0) chunkAt(cx, cz - 1)?.dirty = true
            if (lz == CHUNK_SIZE - 1) chunkAt(cx, cz + 1)?.dirty = true
        }
    }

    fun isSolidForCollision(x: Int, y: Int, z: Int): Boolean {
        val b = block(x, y, z)
        return b != Blocks.AIR && b != Blocks.LEAVES_DEAD
    }

    fun surfaceY(x: Int, z: Int): Int {
        for (y in CHUNK_H - 1 downTo 0) if (isSolidForCollision(x, y, z)) return y + 1
        return CityPlan.GROUND_Y + 1
    }

    fun loadedChunks(): Collection<Chunk> = chunks.values

    fun unloadFar(pcx: Int, pcz: Int, keep: Int) {
        val it = chunks.entries.iterator()
        while (it.hasNext()) {
            val c = it.next().value
            if (Math.abs(c.cx - pcx) > keep || Math.abs(c.cz - pcz) > keep) it.remove()
        }
    }
}
