package com.voxeland.game

import com.voxeland.game.audio.SoundManager
import com.voxeland.game.core.Environment
import com.voxeland.game.core.LightKind
import com.voxeland.game.items.Items
import com.voxeland.game.progression.Character
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** Engine-level behaviour of the two lights, not just the constants. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class LightEngineWiringTest {

    private fun engine(): GameEngine {
        val ctx = RuntimeEnvironment.getApplication()
        val sound = SoundManager(ctx)
        val (w, p) = GameEngine.newGame(77L, Character("Test", 1, 0, 0, 0))
        // The torch tests run several simulated minutes with the player stood
        // still. Zombies spawn on a clock seeded from the wall clock, so an
        // unlucky run could kill the test subject and stop the simulation
        // mid-burn. Make them unkillable so these tests measure the torch and
        // nothing else.
        p.health = 1_000_000f
        return GameEngine(w, p, Environment(), sound)
    }

    /** burn the light for a while without running the rest of the simulation */
    private fun burn(e: GameEngine, seconds: Float) {
        val dt = 1f / 20f
        var t = 0f
        while (t < seconds) { e.update(dt); t += dt }
    }

    @Test
    fun theStartingTorchLightsAndBurnsDownOverItsRuntime() {
        val e = engine()
        assertEquals(LightKind.SHAKE, e.preferredLight())
        e.toggleFlashlight()
        assertTrue("the shake torch should light", e.player.flashlightOn)
        assertEquals(LightKind.SHAKE, e.activeKind)
        assertTrue(e.flashStrength() > 0f)

        burn(e, 60f)
        val left = e.player.shakeCharge
        // 60s of a 168s runtime is a bit over a third gone
        assertTrue("expected roughly a third burned, had $left", left in 55f..70f)

        burn(e, 130f)
        assertFalse("it should have wound down by now", e.player.flashlightOn)
        assertEquals(LightKind.NONE, e.activeKind)
        assertEquals(0f, e.flashStrength(), 1e-6f)
    }

    @Test
    fun aFlatDynamoRefusesUntilWound() {
        val e = engine()
        e.player.shakeCharge = 0f
        e.toggleFlashlight()
        assertFalse("a flat dynamo must not light", e.player.flashlightOn)

        e.windUp(50f)
        assertEquals(50f, e.player.shakeCharge, 0.01f)
        e.toggleFlashlight()
        assertTrue("winding should bring it back", e.player.flashlightOn)
    }

    @Test
    fun windingClampsAndOnlyWorksWithTheTorch() {
        val e = engine()
        e.player.shakeCharge = 90f
        e.windUp(50f)
        assertEquals("charge must clamp at full", 100f, e.player.shakeCharge, 0.01f)

        // drop the torch and winding does nothing
        e.player.inventory.remove(Items.SHAKE_LIGHT, 1)
        e.player.shakeCharge = 0f
        e.windUp(30f)
        assertEquals(0f, e.player.shakeCharge, 0.01f)
    }

    @Test
    fun holdingTheCrankWindsOverTime() {
        val e = engine()
        e.player.shakeCharge = 0f
        e.crankHeld = true
        burn(e, 4f)
        e.crankHeld = false
        val gained = e.player.shakeCharge
        assertTrue("four seconds of cranking should give a usable charge, got $gained",
            gained > 25f && gained <= 100f)
    }

    @Test
    fun aFoundFlashlightBecomesThePreferredLight() {
        val e = engine()
        assertEquals(LightKind.SHAKE, e.preferredLight())
        e.player.inventory.add(Items.FLASHLIGHT, 1)
        e.player.battery = 100f
        assertEquals("a charged flashlight should win", LightKind.ELECTRIC, e.preferredLight())

        e.toggleFlashlight()
        assertEquals(LightKind.ELECTRIC, e.activeKind)
        assertTrue("the flashlight should be the brighter beam",
            e.flashStrength() > LightKind.SHAKE.strength)

        // a flat flashlight hands the job back to the dynamo
        e.toggleFlashlight()
        e.player.battery = 0f
        assertEquals(LightKind.SHAKE, e.preferredLight())
    }

    @Test
    fun theBurningLightDoesNotSilentlySwapKind() {
        val e = engine()
        e.toggleFlashlight()
        assertEquals(LightKind.SHAKE, e.activeKind)
        // picking up a flashlight mid-use must not teleport the beam
        e.player.inventory.add(Items.FLASHLIGHT, 1)
        e.player.battery = 100f
        burn(e, 2f)
        assertEquals("the lit torch should stay the lit torch", LightKind.SHAKE, e.activeKind)
        assertEquals("the untouched flashlight must not drain", 100f, e.player.battery, 0.01f)
    }
}
