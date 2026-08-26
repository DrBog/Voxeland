package com.voxeland.game.core

import com.voxeland.game.gen.CityPlan
import java.util.concurrent.ConcurrentHashMap

const val CHUNK_SIZE = 16
const val CHUNK_H = 96

class Chunk(val cx: Int, val cz: Int) {
    val blocks = ByteArray(CHUNK_SIZE * CHUNK_H * CHUNK_SIZE)
    /** propagated sky exposure per block, 0..LightEngine.MAX */
    val light = ByteArray(CHUNK_SIZE * CHUNK_H * CHUNK_SIZE)
    @Volatile var lit = false
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
    /**
     * Highest solid block the player has placed in each column. The light
     * pass treats everything above a column's top as open sky, so without
     * this a player-built roof would let full daylight through.
     */
    private val editTop = ConcurrentHashMap<Long, Int>()

    companion object {
        fun key(cx: Int, cz: Int) = (cx.toLong() shl 32) xor (cz.toLong() and 0xFFFFFFFFL)
        fun posKey(x: Int, y: Int, z: Int) =
            (x.toLong() and 0x3FFFFFF shl 38) or (z.toLong() and 0x3FFFFFF shl 12) or (y.toLong() and 0xFFF)

        private fun signed26(v: Int) = if (v >= 0x2000000) v - 0x4000000 else v
        fun keyX(k: Long) = signed26((k shr 38 and 0x3FFFFFF).toInt())
        fun keyZ(k: Long) = signed26((k shr 12 and 0x3FFFFFF).toInt())
        fun keyY(k: Long) = (k and 0xFFF).toInt()
        fun columnKey(x: Int, z: Int) = (x.toLong() shl 32) xor (z.toLong() and 0xFFFFFFFFL)
    }

    private fun noteEditTop(x: Int, y: Int, z: Int, b: Byte) {
        if (b == Blocks.AIR) return
        val k = columnKey(x, z)
        val cur = editTop[k]
        if (cur == null || y > cur) editTop[k] = y
    }

    /** call after bulk-loading [edits] from a save */
    fun rebuildEditTops() {
        editTop.clear()
        for ((k, b) in edits) noteEditTop(keyX(k), keyY(k), keyZ(k), b)
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
            val ex = keyX(k); val ez = keyZ(k); val ey = keyY(k)
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
        noteEditTop(x, y, z, b)
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

    /**
     * Highest y worth lighting in this column: the ground plus whatever
     * building stands on it. Everything above is open sky, which lets the
     * light pass skip most of the empty world.
     */
    fun columnTop(x: Int, z: Int): Int {
        val g = plan.groundHeight(x, z)
        val lot = plan.lotAt(x, z)
        val h = if (lot != null) lot.variant.height + 10 else 6
        var top = g + h
        editTop[columnKey(x, z)]?.let { if (it + 2 > top) top = it + 2 }
        return Math.min(CHUNK_H - 1, top)
    }

    /** propagated sky exposure in 0..1; falls back to a lit sky when unloaded */
    fun skyLight(x: Int, y: Int, z: Int): Float {
        if (y < 0) return 0f
        if (y >= CHUNK_H) return 1f
        val c = chunkAt(Math.floorDiv(x, CHUNK_SIZE), Math.floorDiv(z, CHUNK_SIZE))
        if (c != null && c.lit) {
            val i = (Math.floorMod(x, CHUNK_SIZE) * CHUNK_SIZE + Math.floorMod(z, CHUNK_SIZE)) * CHUNK_H + y
            return c.light[i].toInt() / LightEngine.MAX.toFloat()
        }
        return if (y > columnTop(x, z)) 1f else 0.35f
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
