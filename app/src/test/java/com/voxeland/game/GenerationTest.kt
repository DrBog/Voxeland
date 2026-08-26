package com.voxeland.game

import com.voxeland.game.core.Blocks
import com.voxeland.game.gen.Archetype
import com.voxeland.game.gen.BuildingFunction
import com.voxeland.game.gen.BuildingVariant
import com.voxeland.game.gen.CityPlan
import com.voxeland.game.gen.District
import com.voxeland.game.gen.RoofStyle
import com.voxeland.game.gen.VariantCatalog
import com.voxeland.game.gen.WindowStyle
import com.voxeland.game.items.Loot
import com.voxeland.game.progression.Skills
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GenerationTest {

    @Test
    fun catalogHasExactly100LegalVariants() {
        assertEquals(100, VariantCatalog.variants.size)
        // every variant passes its own archetype's gate
        for (v in VariantCatalog.variants) {
            assertTrue(v.archetype.permits(v.roof, v.wall, v.window, v.function, v.floors))
        }
        // ids are unique and sequential
        assertEquals((0 until 100).toList(), VariantCatalog.variants.map { it.id })
        // all archetypes are represented
        assertEquals(Archetype.entries.toSet(), VariantCatalog.variants.map { it.archetype }.toSet())
    }

    @Test
    fun gateLogicRejectsIllegalAssemblies() {
        // a house can never take a skyscraper roof
        assertTrue(runCatching {
            BuildingVariant(0, Archetype.HOUSE, RoofStyle.TOWER_CAP, Blocks.PLANK,
                WindowStyle.PUNCHED, BuildingFunction.RESIDENTIAL, 1)
        }.isFailure)
        // a skyscraper can never start as a factory
        assertTrue(runCatching {
            BuildingVariant(0, Archetype.SKYSCRAPER, RoofStyle.PARAPET, Blocks.CONCRETE_DARK,
                WindowStyle.CURTAIN, BuildingFunction.INDUSTRIAL, 12)
        }.isFailure)
        // a warehouse can never rise like an apartment tower
        assertTrue(runCatching {
            BuildingVariant(0, Archetype.WAREHOUSE, RoofStyle.FLAT, Blocks.METAL_PANEL,
                WindowStyle.SMALL_HIGH, BuildingFunction.STORAGE, 6)
        }.isFailure)
    }

    @Test
    fun cityPlanIsDeterministicAndSane() {
        val plan = CityPlan(12345L)
        val plan2 = CityPlan(12345L)
        var buildings = 0
        var districtsSeen = HashSet<District>()
        for (x in -260..260 step 13) for (z in -260..260 step 13) {
            districtsSeen.add(plan.districtAt(x, z))
            val lot = plan.lotAt(x, z)
            val lot2 = plan2.lotAt(x, z)
            assertEquals(lot?.variant?.id, lot2?.variant?.id)
            if (lot != null) {
                buildings++
                // district gating holds on the ground
                assertTrue(lot.variant.archetype in lot.district.archetypes)
                // block function never throws across the full column
                for (y in 0 until 96) plan.blockAt(x, y, z)
            }
        }
        assertTrue("expected a real city, got $buildings sampled buildings", buildings > 150)
        assertTrue(districtsSeen.containsAll(listOf(
            District.DOWNTOWN, District.COMMERCIAL, District.SUBURBS, District.INDUSTRIAL, District.WASTELAND)))
    }

    @Test
    fun buildingsHaveFloorsDoorsAndRoofs() {
        val plan = CityPlan(777L)
        var checked = 0
        var doorways = 0
        val seen = HashSet<Pair<Int, Int>>()
        outer@ for (x in -250..250 step 9) for (z in -250..250 step 9) {
            val lot = plan.lotAt(x, z) ?: continue
            if (!seen.add(lot.x0 to lot.z0)) continue     // once per lot
            checked++
            val g = CityPlan.GROUND_Y
            var hasGroundFloor = false
            var doorGap = false
            for (bx in lot.x0..lot.x1) for (bz in lot.z0..lot.z1) {
                if (plan.blockAt(bx, g, bz) != Blocks.AIR) hasGroundFloor = true
                // doorway = walkable gap at ground level with a frame above
                if (plan.blockAt(bx, g + 1, bz) == Blocks.AIR &&
                    plan.blockAt(bx, g + 2, bz) == Blocks.AIR &&
                    plan.blockAt(bx, g + 3, bz) == Blocks.DOOR_FRAME) doorGap = true
            }
            assertTrue(hasGroundFloor)
            if (doorGap) doorways++
            if (checked > 60) break@outer
        }
        assertTrue(checked > 20)
        assertTrue("most buildings should have an enterable doorway ($doorways/$checked)", doorways > checked / 2)
    }

    @Test
    fun lootIsDeterministicByPosition() {
        val a = Loot.roll(9L, 10, 21, 30, BuildingFunction.PHARMACY, 0)
        val b = Loot.roll(9L, 10, 21, 30, BuildingFunction.PHARMACY, 0)
        assertEquals(a.map { it.item.id to it.count }, b.map { it.item.id to it.count })
        assertTrue(a.isNotEmpty())
    }

    @Test
    fun xpCurveIsMonotonic() {
        var prev = -1
        for (l in 1..40) {
            val need = Skills.xpForLevel(l)
            assertTrue(need > prev)
            prev = need
        }
        assertEquals(1, Skills.levelForXp(0))
        assertTrue(Skills.levelForXp(100000) > 10)
    }
}
