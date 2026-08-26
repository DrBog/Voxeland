package com.voxeland.game

import com.voxeland.game.core.Blocks
import com.voxeland.game.core.Environment
import com.voxeland.game.core.World
import com.voxeland.game.entity.Player
import com.voxeland.game.entity.Zombie
import com.voxeland.game.gen.CityPlan
import com.voxeland.game.progression.Character
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Headless engine simulation — no Android classes involved. */
class SimulationTest {

    private fun newPlayer(): Pair<World, Player> {
        val world = World(4242L)
        val p = Player(Character("Test", 1, 0, 0, 0))
        p.x = 3.5; p.z = 230.0; p.y = world.surfaceY(3, 230).toDouble()
        return world to p
    }

    @Test
    fun playerLandsAndWalksForward() {
        val (world, p) = newPlayer()
        p.y += 3.0
        val startZ = p.z
        repeat(300) { p.move(world, 1f / 60f, 0f, 1f, false) }
        assertTrue("should land on ground", p.onGround)
        assertTrue("yaw 0 + forward must decrease z (moved ${startZ - p.z})", startZ - p.z > 3.0)
        // never fell through the street
        assertTrue(p.y >= CityPlan.GROUND_Y - 1)
    }

    @Test
    fun upperFloorsHoldWeight() {
        val (world, p) = newPlayer()
        // find an upper-storey slab cell (carpet or plank above ground level) near downtown
        var found = false
        outer@ for (x in -120..120 step 7) for (z in -120..120 step 7) {
            val lot = world.plan.lotAt(x, z) ?: continue
            if (lot.variant.floors < 2) continue
            for (y in CityPlan.GROUND_Y + 3 until CityPlan.GROUND_Y + 12) {
                val b = world.plan.blockAt(x, y, z)
                if ((b == Blocks.CARPET || b == Blocks.PLANK || b == Blocks.TILE_FLOOR || b == Blocks.CONCRETE) &&
                    world.plan.blockAt(x, y + 1, z) == Blocks.AIR &&
                    world.plan.blockAt(x, y + 2, z) == Blocks.AIR) {
                    p.x = x + 0.5; p.y = (y + 1).toDouble(); p.z = z + 0.5
                    found = true; break@outer
                }
            }
        }
        assertTrue("no upper floor found to stand on", found)
        val floorY = p.y
        repeat(240) { p.move(world, 1f / 60f, 0f, 0f, false) }
        assertTrue("fell through an upper floor: ${p.y} < $floorY", p.y > floorY - 1.5)
    }

    @Test
    fun zombieChasesAndBites() {
        val (world, p) = newPlayer()
        repeat(60) { p.move(world, 1f / 60f, 0f, 0f, false) }   // settle on ground
        val z = Zombie(p.x, world.surfaceY(3, 235).toDouble(), p.z + 5.0, 99L)   // same street, 5 m away
        var bit = false
        repeat(1800) {
            val dmg = z.update(world, 1f / 60f, p, darkness = 1f, detectMul = 1f)
            if (dmg > 0f) bit = true
        }
        assertTrue("zombie should reach and bite the player, dist=${z.distTo(p.x, p.z)}", bit)
        // and dies when beaten
        var died = false
        repeat(20) { if (z.hurt(10f)) died = true }
        assertTrue(died)
        assertEquals(Zombie.State.DEAD, z.state)
    }

    @Test
    fun fullDayLastsFortyEightMinutes() {
        val env = Environment()
        assertEquals(2880f, Environment.DAY_SECONDS, 0.01f)
        val startDay = env.dayCount
        var t = 0f
        while (t < 2880f) { env.advance(0.5f); t += 0.5f }
        assertEquals(startDay + 1, env.dayCount)
        // darkness and daylight stay complementary and bounded
        for (i in 0..100) {
            env.advance(28.8f)
            assertTrue(env.daylight in 0f..1f)
            assertTrue(env.fogDensity > 0f)
            assertEquals(1f, env.daylight + env.darkness, 0.001f)
        }
    }

    @Test
    fun editsSurviveSaveKeyRoundtrip() {
        val world = World(1L)
        world.setBlock(-37, 25, 118, Blocks.BARRICADE)
        world.setBlock(200, 21, -180, Blocks.PLANK)
        assertEquals(Blocks.BARRICADE, world.block(-37, 25, 118))
        assertEquals(Blocks.PLANK, world.block(200, 21, -180))
        // simulate reload: new world, replay edit map (as SaveManager does)
        val world2 = World(1L)
        for ((k, v) in world.edits) world2.edits[k] = v
        assertEquals(Blocks.BARRICADE, world2.block(-37, 25, 118))
        assertEquals(Blocks.PLANK, world2.block(200, 21, -180))
    }
}
