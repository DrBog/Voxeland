package com.voxeland.game

import com.voxeland.game.core.Blocks
import com.voxeland.game.core.CHUNK_SIZE
import com.voxeland.game.core.EyeAdaptation
import com.voxeland.game.core.LightEngine
import com.voxeland.game.core.World
import com.voxeland.game.gen.CityPlan
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The atmosphere pass lives or dies on one property: light must fall off
 * with depth into a building. A uniformly lit interior is what makes a
 * voxel game read as a toy.
 */
class LightingTest {

    private fun world() = World(2024L)

    /** a downtown lot big enough to have a genuine interior */
    private fun findBigLot(w: World): CityPlan.Lot {
        for (x in -200..200 step 3) for (z in -200..200 step 3) {
            val lot = w.plan.lotAt(x, z)
            if (lot != null && lot.w >= 15 && lot.variant.floors >= 3) return lot
        }
        throw AssertionError("no large building found to test")
    }

    @Test
    fun openSkyIsFullyLit() {
        val w = world()
        // a point high over the map, and the street surface itself
        val cx = Math.floorDiv(3, CHUNK_SIZE); val cz = Math.floorDiv(3, CHUNK_SIZE)
        val f = LightEngine.compute(w, cx, cz)
        assertEquals(LightEngine.MAX, f.at(3, 80, 3))
        // just above the road, nothing overhead
        val g = w.plan.groundHeight(3, 3)
        if (w.plan.isRoad(3, 3)) assertEquals(LightEngine.MAX, f.at(3, g + 2, 3))
    }

    @Test
    fun interiorsGoDarkWithDepth() {
        val w = world()
        val lot = findBigLot(w)
        val cx = Math.floorDiv(lot.x0 + lot.w / 2, CHUNK_SIZE)
        val cz = Math.floorDiv(lot.z0 + lot.d / 2, CHUNK_SIZE)
        val f = LightEngine.compute(w, cx, cz)
        val g = CityPlan.GROUND_Y
        val y = g + 2                     // head height on the ground floor

        // collect interior air cells and bucket them by distance from the facade
        var edgeSum = 0.0; var edgeN = 0
        var coreSum = 0.0; var coreN = 0
        for (x in lot.x0..lot.x1) for (z in lot.z0..lot.z1) {
            if (w.block(x, y, z) != Blocks.AIR) continue
            val v = f.at(x, y, z)
            if (v < 0) continue
            val depth = minOf(x - lot.x0, lot.x1 - x, z - lot.z0, lot.z1 - z)
            if (depth <= 2) { edgeSum += v; edgeN++ }
            if (depth >= 6) { coreSum += v; coreN++ }
        }
        assertTrue("no facade cells sampled", edgeN > 0)
        assertTrue("no deep interior cells sampled", coreN > 0)
        val edge = edgeSum / edgeN
        val core = coreSum / coreN
        assertTrue("interior is not darker than the facade (edge=$edge core=$core)", core < edge - 1.0)
        assertTrue("deep interior should be near black, was $core", core < LightEngine.MAX * 0.35)
    }

    @Test
    fun lightStillReachesThroughOpenings() {
        // the flip side: making everything black would also be wrong
        val w = world()
        val lot = findBigLot(w)
        val cx = Math.floorDiv(lot.x0 + lot.w / 2, CHUNK_SIZE)
        val cz = Math.floorDiv(lot.z0 + lot.d / 2, CHUNK_SIZE)
        val f = LightEngine.compute(w, cx, cz)
        val y = CityPlan.GROUND_Y + 2
        var lit = 0
        for (x in lot.x0..lot.x1) for (z in lot.z0..lot.z1) {
            if (w.block(x, y, z) != Blocks.AIR) continue
            if (f.at(x, y, z) >= 4) lit++
        }
        assertTrue("no daylight gets inside at all — rooms would be unplayable", lit > 0)
    }

    @Test
    fun opaqueBlocksStopLight() {
        val w = world()
        // bury a cell under solid stone and confirm it stays dark
        for (y in 30..40) for (dx in -1..1) for (dz in -1..1)
            w.setBlock(500 + dx, y, 500 + dz, Blocks.STONE)
        w.setBlock(500, 35, 500, Blocks.AIR)
        val cx = Math.floorDiv(500, CHUNK_SIZE); val cz = Math.floorDiv(500, CHUNK_SIZE)
        val f = LightEngine.compute(w, cx, cz)
        assertEquals("a sealed pocket must be pitch black", 0, f.at(500, 35, 500))
    }

    @Test
    fun lightIsDeterministic() {
        val a = LightEngine.compute(world(), 2, 3)
        val b = LightEngine.compute(world(), 2, 3)
        // Field views are thread-local and reused, so compare copies
        val ca = ByteArray(CHUNK_SIZE * 96 * CHUNK_SIZE)
        val cb = ByteArray(CHUNK_SIZE * 96 * CHUNK_SIZE)
        LightEngine.compute(world(), 2, 3).copyInto(ca)
        LightEngine.compute(world(), 2, 3).copyInto(cb)
        assertTrue(ca.contentEquals(cb))
    }

    @Test
    fun lightPassIsFastEnoughToStream() {
        val w = world()
        val lot = findBigLot(w)
        val cx = Math.floorDiv(lot.x0, CHUNK_SIZE); val cz = Math.floorDiv(lot.z0, CHUNK_SIZE)
        LightEngine.compute(w, cx, cz)              // warm up
        val t0 = System.nanoTime()
        repeat(8) { LightEngine.compute(w, cx, cz) }
        val msPerChunk = (System.nanoTime() - t0) / 1e6 / 8
        println("light pass: %.1f ms per downtown chunk".format(msPerChunk))
        assertTrue("light pass too slow to stream: $msPerChunk ms", msPerChunk < 400.0)
    }

    // ---------------------------------------------------------------- eyes

    @Test
    fun steppingIntoTheDarkBlindsYouThenResolves() {
        val eye = EyeAdaptation()
        eye.reset(1f)                                   // stood in daylight
        val bright = eye.exposure

        // walk through the doorway into a black room
        repeat(30) { eye.update(0.02f, 1f / 60f) }       // half a second
        val justInside = eye.exposure
        assertTrue("the eye adapted far too fast to be frightening", justInside < bright * 1.35f)

        // several seconds later shapes resolve
        repeat(60 * 12) { eye.update(0.02f, 1f / 60f) }
        val settled = eye.exposure
        assertTrue("dark adaptation never lifted (was $settled)", settled > justInside * 2f)
        assertTrue(settled <= EyeAdaptation.MAX_EXPOSURE + 0.001f)

        // stepping back out clamps down fast — much faster than going dark
        repeat(60) { eye.update(1f, 1f / 60f) }          // one second
        assertTrue("pupil did not contract on the way out (was ${eye.exposure})",
            eye.exposure < settled * 0.55f)
    }

    @Test
    fun exposureStaysWithinBounds() {
        val eye = EyeAdaptation()
        for (t in listOf(0f, 0.01f, 0.5f, 1f, 2f, -1f)) {
            repeat(200) { eye.update(t, 1f / 30f) }
            assertTrue(eye.exposure in EyeAdaptation.MIN_EXPOSURE..EyeAdaptation.MAX_EXPOSURE)
            assertTrue(eye.adapted in 0f..1f)
        }
    }
}
