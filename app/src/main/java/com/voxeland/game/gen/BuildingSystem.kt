package com.voxeland.game.gen

import com.voxeland.game.core.Blocks
import com.voxeland.game.core.Rng

/**
 * Component-based building generator.
 *
 * A building variant is a validated combination of components:
 *   archetype x wall material x roof style x floor count x window style.
 * Gate logic lives in [Archetype]: each archetype declares exactly which
 * components it may be assembled from, so a HOUSE can never receive a
 * TOWER_CAP roof and a SKYSCRAPER can never carry an INDUSTRIAL interior.
 * The [VariantCatalog] enumerates every legal combination and locks the
 * game to a deterministic set of exactly 100 variants.
 */

enum class RoofStyle { GABLE, HIP, FLAT, PARAPET, TOWER_CAP, SAWTOOTH }

enum class WindowStyle { PUNCHED, WIDE, RIBBON, CURTAIN, SMALL_HIGH }

/** What the interior is for — drives loot, furnishing and container types. */
enum class BuildingFunction { RESIDENTIAL, OFFICE, GROCERY, HARDWARE, PHARMACY, INDUSTRIAL, STORAGE }

enum class Archetype(
    val allowedRoofs: Set<RoofStyle>,
    val allowedWalls: Set<Byte>,
    val allowedWindows: Set<WindowStyle>,
    val allowedFunctions: Set<BuildingFunction>,
    val floorRange: IntRange,
    val floorHeight: Int,
) {
    HOUSE(
        setOf(RoofStyle.GABLE, RoofStyle.HIP),
        setOf(Blocks.PLANK, Blocks.BRICK_RED, Blocks.BRICK_GRAY),
        setOf(WindowStyle.PUNCHED, WindowStyle.WIDE),
        setOf(BuildingFunction.RESIDENTIAL),
        1..2, 4
    ),
    TOWNHOUSE(
        setOf(RoofStyle.GABLE, RoofStyle.PARAPET),
        setOf(Blocks.BRICK_RED, Blocks.BRICK_GRAY),
        setOf(WindowStyle.PUNCHED, WindowStyle.WIDE),
        setOf(BuildingFunction.RESIDENTIAL),
        2..3, 4
    ),
    APARTMENT(
        setOf(RoofStyle.FLAT, RoofStyle.PARAPET),
        setOf(Blocks.BRICK_RED, Blocks.BRICK_GRAY, Blocks.CONCRETE),
        setOf(WindowStyle.PUNCHED, WindowStyle.RIBBON),
        setOf(BuildingFunction.RESIDENTIAL),
        3..6, 4
    ),
    OFFICE(
        setOf(RoofStyle.FLAT, RoofStyle.PARAPET),
        setOf(Blocks.CONCRETE, Blocks.CONCRETE_DARK),
        setOf(WindowStyle.RIBBON, WindowStyle.CURTAIN),
        setOf(BuildingFunction.OFFICE),
        4..7, 4
    ),
    SKYSCRAPER(
        setOf(RoofStyle.TOWER_CAP, RoofStyle.PARAPET),
        setOf(Blocks.CONCRETE_DARK, Blocks.CONCRETE),
        setOf(WindowStyle.CURTAIN),
        setOf(BuildingFunction.OFFICE),
        9..15, 4
    ),
    STORE(
        setOf(RoofStyle.FLAT, RoofStyle.PARAPET),
        setOf(Blocks.BRICK_RED, Blocks.BRICK_GRAY, Blocks.CONCRETE),
        setOf(WindowStyle.WIDE),
        setOf(BuildingFunction.GROCERY, BuildingFunction.HARDWARE, BuildingFunction.PHARMACY),
        1..2, 5
    ),
    FACTORY(
        setOf(RoofStyle.SAWTOOTH, RoofStyle.FLAT),
        setOf(Blocks.METAL_PANEL, Blocks.BRICK_GRAY),
        setOf(WindowStyle.SMALL_HIGH),
        setOf(BuildingFunction.INDUSTRIAL),
        1..2, 6
    ),
    WAREHOUSE(
        setOf(RoofStyle.FLAT, RoofStyle.SAWTOOTH),
        setOf(Blocks.METAL_PANEL, Blocks.METAL_RUST),
        setOf(WindowStyle.SMALL_HIGH),
        setOf(BuildingFunction.STORAGE),
        1..1, 7
    );

    /** Gate check — the single authority on which components may combine. */
    fun permits(roof: RoofStyle, wall: Byte, win: WindowStyle, fn: BuildingFunction, floors: Int) =
        roof in allowedRoofs && wall in allowedWalls && win in allowedWindows &&
        fn in allowedFunctions && floors in floorRange
}

data class BuildingVariant(
    val id: Int,
    val archetype: Archetype,
    val roof: RoofStyle,
    val wall: Byte,
    val window: WindowStyle,
    val function: BuildingFunction,
    val floors: Int,
) {
    init {
        // Assembling an illegal combination is a programming error, not bad luck.
        require(archetype.permits(roof, wall, window, function, floors)) {
            "gate violation: $archetype cannot combine $roof/$wall/$window/$function/$floors"
        }
    }
    val height: Int get() = floors * archetype.floorHeight
}

/**
 * Deterministic catalog of exactly 100 legal building variants,
 * spread across all archetypes proportionally to how many legal
 * combinations each archetype offers.
 */
object VariantCatalog {
    const val TARGET = 100
    val variants: List<BuildingVariant> = build()

    private fun build(): List<BuildingVariant> {
        val all = ArrayList<BuildingVariant>()
        for (arch in Archetype.entries) {
            val combos = ArrayList<BuildingVariant>()
            for (roof in arch.allowedRoofs)
                for (wall in arch.allowedWalls)
                    for (win in arch.allowedWindows)
                        for (fn in arch.allowedFunctions)
                            for (fl in arch.floorRange)
                                combos.add(BuildingVariant(0, arch, roof, wall, win, fn, fl))
            all.addAll(combos)
        }
        check(all.size >= TARGET) { "component space too small: ${all.size}" }
        // Deterministic thinning: keep a proportional, evenly-strided sample per archetype.
        val byArch = all.groupBy { it.archetype }
        val picked = ArrayList<BuildingVariant>()
        val quota = HashMap<Archetype, Int>()
        var assigned = 0
        for ((arch, list) in byArch) {
            val q = (list.size.toFloat() / all.size * TARGET).toInt().coerceAtLeast(3)
            quota[arch] = q; assigned += q
        }
        // fix rounding drift on the largest bucket
        val largest = byArch.maxBy { it.value.size }.key
        quota[largest] = quota[largest]!! + (TARGET - assigned)
        for ((arch, list) in byArch) {
            val q = quota[arch]!!.coerceAtMost(list.size)
            for (i in 0 until q) {
                val idx = (i.toLong() * list.size / q).toInt()
                picked.add(list[idx])
            }
        }
        // top up if any bucket was smaller than its quota
        var cursor = 0
        while (picked.size < TARGET) {
            val cand = all[cursor % all.size]; cursor++
            if (picked.none { it === cand }) picked.add(cand)
        }
        return picked.take(TARGET).mapIndexed { i, v -> v.copy(id = i) }
    }

    fun pickFor(district: District, seed: Long, a: Int, b: Int): BuildingVariant {
        val pool = variants.filter { it.archetype in district.archetypes }
        return pool[Rng.nextInt(seed, pool.size, a, b, 77)]
    }
}

enum class District(val archetypes: Set<Archetype>) {
    DOWNTOWN(setOf(Archetype.SKYSCRAPER, Archetype.OFFICE)),
    COMMERCIAL(setOf(Archetype.STORE, Archetype.APARTMENT, Archetype.OFFICE)),
    SUBURBS(setOf(Archetype.HOUSE, Archetype.TOWNHOUSE)),
    INDUSTRIAL(setOf(Archetype.FACTORY, Archetype.WAREHOUSE)),
    WASTELAND(emptySet()),
}
