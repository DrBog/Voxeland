package com.voxeland.game.items

import com.voxeland.game.core.Rng
import com.voxeland.game.gen.BuildingFunction

/**
 * Loot rolled deterministically from world seed + container position,
 * weighted by the building function the container sits in.
 */
object Loot {
    private data class Entry(val item: ItemDef, val weight: Float, val min: Int, val max: Int)

    private val tables: Map<BuildingFunction, List<Entry>> = mapOf(
        BuildingFunction.RESIDENTIAL to listOf(
            Entry(Items.BEANS, 3f, 1, 2), Entry(Items.CHIPS, 2.5f, 1, 2), Entry(Items.SODA, 2f, 1, 2),
            Entry(Items.WATER, 2f, 1, 1), Entry(Items.CLOTH, 3f, 1, 3), Entry(Items.BANDAGE, 1.2f, 1, 1),
            Entry(Items.KNIFE, 0.7f, 1, 1), Entry(Items.WATCH, 0.5f, 1, 1), Entry(Items.PAINKILLERS, 0.8f, 1, 2),
            Entry(Items.WOOD, 2f, 1, 3), Entry(Items.CANNED_SOUP, 1.5f, 1, 1),
            Entry(Items.FLASHLIGHT, 0.6f, 1, 1), Entry(Items.BATTERY, 1.4f, 1, 2),
        ),
        BuildingFunction.OFFICE to listOf(
            Entry(Items.SODA, 2.5f, 1, 2), Entry(Items.CHIPS, 2f, 1, 2), Entry(Items.CLOTH, 2f, 1, 2),
            Entry(Items.TAPE, 1.5f, 1, 2), Entry(Items.WATCH, 1.2f, 1, 1), Entry(Items.PAINKILLERS, 1f, 1, 1),
            Entry(Items.SCRAP, 1f, 1, 2), Entry(Items.MURKY_WATER, 1f, 1, 1),
            Entry(Items.BATTERY, 1.6f, 1, 2),
        ),
        BuildingFunction.GROCERY to listOf(
            Entry(Items.BEANS, 4f, 1, 3), Entry(Items.CANNED_SOUP, 3f, 1, 2), Entry(Items.JERKY, 2.5f, 1, 2),
            Entry(Items.CHIPS, 3f, 1, 3), Entry(Items.WATER, 3f, 1, 2), Entry(Items.SODA, 2.5f, 1, 2),
            Entry(Items.CLOTH, 1f, 1, 2),
        ),
        BuildingFunction.HARDWARE to listOf(
            Entry(Items.NAILS, 4f, 4, 12), Entry(Items.SCRAP, 3f, 1, 3), Entry(Items.TAPE, 2.5f, 1, 2),
            Entry(Items.WOOD, 3f, 2, 4), Entry(Items.HAMMER, 1f, 1, 1), Entry(Items.CROWBAR, 0.8f, 1, 1),
            Entry(Items.CHEMICALS, 1.5f, 1, 2), Entry(Items.FIREAXE, 0.25f, 1, 1),
            Entry(Items.FLASHLIGHT, 1.2f, 1, 1), Entry(Items.BATTERY, 3f, 2, 4),
        ),
        BuildingFunction.PHARMACY to listOf(
            Entry(Items.BANDAGE, 3.5f, 1, 3), Entry(Items.PAINKILLERS, 2.5f, 1, 2),
            Entry(Items.ANTIBIOTICS, 1.5f, 1, 2), Entry(Items.MEDKIT, 0.6f, 1, 1),
            Entry(Items.CHEMICALS, 2f, 1, 2), Entry(Items.WATER, 1.5f, 1, 1),
        ),
        BuildingFunction.INDUSTRIAL to listOf(
            Entry(Items.SCRAP, 4f, 2, 4), Entry(Items.NAILS, 2.5f, 3, 8), Entry(Items.CHEMICALS, 2f, 1, 2),
            Entry(Items.PIPE, 1f, 1, 1), Entry(Items.TAPE, 1.5f, 1, 2), Entry(Items.MURKY_WATER, 1f, 1, 1),
            Entry(Items.BATTERY, 2.2f, 1, 3), Entry(Items.FLASHLIGHT, 0.5f, 1, 1),
            Entry(Items.CROWBAR, 0.6f, 1, 1),
        ),
        BuildingFunction.STORAGE to listOf(
            Entry(Items.WOOD, 3f, 2, 4), Entry(Items.SCRAP, 3f, 1, 3), Entry(Items.BEANS, 2f, 1, 2),
            Entry(Items.TAPE, 1.8f, 1, 2), Entry(Items.NAILS, 2f, 4, 10), Entry(Items.WATER, 1.5f, 1, 2),
            Entry(Items.MEDKIT, 0.3f, 1, 1), Entry(Items.FIREAXE, 0.2f, 1, 1), Entry(Items.WATCH, 0.6f, 1, 1),
            Entry(Items.BATTERY, 2.4f, 1, 3), Entry(Items.FLASHLIGHT, 0.8f, 1, 1),
        ),
    )

    /** scavenging skill level adds bonus rolls */
    fun roll(worldSeed: Long, x: Int, y: Int, z: Int, fn: BuildingFunction, bonusRolls: Int): List<Stack> {
        val table = tables[fn] ?: tables[BuildingFunction.RESIDENTIAL]!!
        val total = table.sumOf { it.weight.toDouble() }.toFloat()
        val out = ArrayList<Stack>()
        val rolls = 2 + Rng.nextInt(Rng.hash(worldSeed, x, y, z), 2, 1) + bonusRolls
        for (i in 0 until rolls) {
            val h = Rng.hash(worldSeed, x * 31 + i, y, z * 17 + i)
            var pick = Rng.toFloat(h) * total
            for (e in table) {
                pick -= e.weight
                if (pick <= 0f) {
                    val n = e.min + Rng.nextInt(Rng.hash(h, i, 9), e.max - e.min + 1, 2)
                    val existing = out.find { it.item == e.item }
                    if (existing != null) existing.count += n else out.add(Stack(e.item, n))
                    break
                }
            }
        }
        return out
    }
}
