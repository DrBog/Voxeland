package com.voxeland.game

import com.voxeland.game.core.LightKind
import com.voxeland.game.core.LightSpec
import com.voxeland.game.items.Items
import com.voxeland.game.progression.Character
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The shake torch is the starting light: always available, never permanently
 * dead, and deliberately the weaker of the two. Its runtime is defined as a
 * reduction against the battery flashlight, so that relationship is asserted
 * rather than left as two loose constants that can drift apart.
 */
class LightSourceTest {

    @Test
    fun shakeTorchRunsSixtyPercentLessThanAFlashlight() {
        assertEquals(0.60f, LightSpec.SHAKE_RUNTIME_REDUCTION, 1e-6f)
        val electric = LightKind.ELECTRIC.runtimeSeconds
        val shake = LightKind.SHAKE.runtimeSeconds

        // 60% less means 40% of the runtime
        assertEquals(electric * 0.40f, shake, 1e-3f)
        assertEquals(420f, electric, 1e-3f)
        assertEquals(168f, shake, 1e-3f)

        // stated the other way round: the shortfall really is 60%
        assertEquals(0.60f, (electric - shake) / electric, 1e-4f)
    }

    @Test
    fun drainRatesEmptyEachLightOverItsOwnRuntime() {
        for (k in listOf(LightKind.SHAKE, LightKind.ELECTRIC)) {
            // the engine burns charge as `charge -= dt * drainPerSecond`
            var charge = 100f
            val dt = 1f / 60f
            var seconds = 0f
            while (charge > 0f && seconds < 2000f) {
                charge -= dt * k.drainPerSecond
                seconds += dt
            }
            assertEquals("$k should last exactly its runtime", k.runtimeSeconds, seconds, 0.5f)
        }
        // and a dead light has no drain to divide by zero on
        assertEquals(0f, LightKind.NONE.drainPerSecond, 1e-6f)
    }

    @Test
    fun theShakeTorchIsTheWeakerBeam() {
        assertTrue("the dynamo should be dimmer than a real flashlight",
            LightKind.SHAKE.strength < LightKind.ELECTRIC.strength)
        assertTrue(LightKind.SHAKE.strength > 0f)
        assertEquals(0f, LightKind.NONE.strength, 1e-6f)
    }

    @Test
    fun freshSurvivorsSpawnWithAChargedShakeTorch() {
        for (background in 0..3) {
            val (_, player) = GameEngine.newGame(1234L, Character("Test", 1, 0, 0, background))
            assertTrue("background $background did not spawn with a shake torch", player.hasShakeLight())
            assertEquals("the starting torch should be wound", 100f, player.shakeCharge, 0.01f)
            // it is the starting light, not a spare flashlight
            assertTrue("should not also start with a battery flashlight", !player.hasElectricLight())
            assertEquals(0f, player.battery, 0.01f)
            assertNotNull(Items.byId("shakelight"))
        }
    }

    @Test
    fun aFullWindGivesTheStatedRuntime() {
        // cranking from flat to full, then burning it down
        var charge = 0f
        var windSeconds = 0f
        val dt = 1f / 60f
        while (charge < 100f && windSeconds < 60f) {
            charge = minOf(100f, charge + LightSpec.CRANK_RATE * dt)
            windSeconds += dt
        }
        assertEquals("a full wind should take about nine seconds", 9.1f, windSeconds, 0.6f)

        var lit = 0f
        while (charge > 0f) { charge -= dt * LightKind.SHAKE.drainPerSecond; lit += dt }
        assertEquals(LightKind.SHAKE.runtimeSeconds, lit, 0.5f)
        assertTrue("winding must pay for itself several times over", lit > windSeconds * 10f)
    }

    @Test
    fun shakeGainTurnsRealMotionIntoCharge() {
        // a vigorous shake sits well above the threshold; a still hand does not
        val still = 0.4f
        val vigorous = 18f
        fun gain(mag: Float, dt: Float): Float {
            val jolt = kotlin.math.abs(mag - 9.81f)
            return if (jolt > LightSpec.SHAKE_THRESHOLD)
                (jolt - LightSpec.SHAKE_THRESHOLD) * LightSpec.SHAKE_GAIN * dt else 0f
        }
        assertEquals("a still handset must not charge anything", 0f, gain(9.81f + still, 1f), 1e-6f)
        val perSecond = gain(vigorous, 1f)
        assertTrue("vigorous shaking should charge meaningfully, got $perSecond", perSecond > 3f)
        // and should not be so strong that one flick fills it
        assertTrue("shaking is too generous, got $perSecond", perSecond < 40f)
    }
}
