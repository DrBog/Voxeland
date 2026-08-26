package com.voxeland.game.core

/**
 * Block registry. IDs are stable bytes — they are written into save files,
 * so existing entries must never be renumbered.
 */
object Blocks {
    const val AIR: Byte = 0
    const val ASPHALT: Byte = 1
    const val ROAD_LINE: Byte = 2
    const val SIDEWALK: Byte = 3
    const val DIRT: Byte = 4
    const val GRASS: Byte = 5
    const val STONE: Byte = 6
    const val CONCRETE: Byte = 7
    const val CONCRETE_DARK: Byte = 8
    const val BRICK_RED: Byte = 9
    const val BRICK_GRAY: Byte = 10
    const val PLANK: Byte = 11
    const val WOOD_FRAME: Byte = 12
    const val GLASS: Byte = 13
    const val WINDOW_BOARDED: Byte = 14
    const val ROOF_SHINGLE: Byte = 15
    const val ROOF_TAR: Byte = 16
    const val METAL_PANEL: Byte = 17
    const val METAL_RUST: Byte = 18
    const val CONTAINER: Byte = 19      // lootable crate
    const val SHELF: Byte = 20          // lootable store shelf
    const val COUNTER: Byte = 21        // lootable cabinet/counter
    const val RUBBLE: Byte = 22
    const val LOG_DEAD: Byte = 23
    const val LEAVES_DEAD: Byte = 24
    const val FENCE: Byte = 25
    const val BARRICADE: Byte = 26
    const val GRAVEL: Byte = 27
    const val TILE_FLOOR: Byte = 28
    const val CARPET: Byte = 29
    const val GLASS_DARK: Byte = 30     // skyscraper curtain glass
    const val DOOR_FRAME: Byte = 31     // lintel above doorway gaps
    const val COUNT = 32

    /** seconds of punching with a bare hand to break; <0 = unbreakable-by-hand */
    private val hardness = FloatArray(COUNT).also {
        for (i in it.indices) it[i] = 2.5f
        it[AIR.toInt()] = 0f
        it[ASPHALT.toInt()] = 8f; it[ROAD_LINE.toInt()] = 8f; it[SIDEWALK.toInt()] = 6f
        it[DIRT.toInt()] = 1.2f; it[GRASS.toInt()] = 1.2f; it[GRAVEL.toInt()] = 1.4f
        it[STONE.toInt()] = 9f
        it[CONCRETE.toInt()] = 7f; it[CONCRETE_DARK.toInt()] = 7f
        it[BRICK_RED.toInt()] = 5f; it[BRICK_GRAY.toInt()] = 5f
        it[PLANK.toInt()] = 2.2f; it[WOOD_FRAME.toInt()] = 2.4f
        it[GLASS.toInt()] = 0.4f; it[GLASS_DARK.toInt()] = 0.5f
        it[WINDOW_BOARDED.toInt()] = 1.8f
        it[ROOF_SHINGLE.toInt()] = 2.6f; it[ROOF_TAR.toInt()] = 3.5f
        it[METAL_PANEL.toInt()] = 6f; it[METAL_RUST.toInt()] = 4f
        it[CONTAINER.toInt()] = 3f; it[SHELF.toInt()] = 2.5f; it[COUNTER.toInt()] = 2.5f
        it[RUBBLE.toInt()] = 1.6f
        it[LOG_DEAD.toInt()] = 3f; it[LEAVES_DEAD.toInt()] = 0.2f
        it[FENCE.toInt()] = 3f; it[BARRICADE.toInt()] = 2f
        it[TILE_FLOOR.toInt()] = 5f; it[CARPET.toInt()] = 0.8f
        it[DOOR_FRAME.toInt()] = 2.4f
    }

    fun hardness(id: Byte): Float = hardness[id.toInt()]
    fun isAir(id: Byte): Boolean = id == AIR
    fun isSolid(id: Byte): Boolean = id != AIR
    fun isTransparent(id: Byte): Boolean =
        id == AIR || id == GLASS || id == GLASS_DARK || id == FENCE || id == LEAVES_DEAD
    fun isTranslucentMesh(id: Byte): Boolean = id == GLASS || id == GLASS_DARK
    fun isLootable(id: Byte): Boolean = id == CONTAINER || id == SHELF || id == COUNTER
    fun stepsSoft(id: Byte): Boolean =
        id == DIRT || id == GRASS || id == GRAVEL || id == CARPET || id == RUBBLE || id == LEAVES_DEAD

    fun name(id: Byte): String = when (id) {
        ASPHALT -> "Asphalt"; ROAD_LINE -> "Asphalt"; SIDEWALK -> "Sidewalk"
        DIRT -> "Dirt"; GRASS -> "Dead Grass"; STONE -> "Stone"
        CONCRETE -> "Concrete"; CONCRETE_DARK -> "Dark Concrete"
        BRICK_RED -> "Red Brick"; BRICK_GRAY -> "Gray Brick"
        PLANK -> "Planks"; WOOD_FRAME -> "Wood Frame"
        GLASS -> "Glass"; GLASS_DARK -> "Tinted Glass"; WINDOW_BOARDED -> "Boarded Window"
        ROOF_SHINGLE -> "Shingles"; ROOF_TAR -> "Tar Roof"
        METAL_PANEL -> "Metal Panel"; METAL_RUST -> "Rusted Metal"
        CONTAINER -> "Crate"; SHELF -> "Shelf"; COUNTER -> "Cabinet"
        RUBBLE -> "Rubble"; LOG_DEAD -> "Dead Wood"; LEAVES_DEAD -> "Dead Leaves"
        FENCE -> "Chain Fence"; BARRICADE -> "Barricade"; GRAVEL -> "Gravel"
        TILE_FLOOR -> "Tile"; CARPET -> "Carpet"; DOOR_FRAME -> "Door Frame"
        else -> "Air"
    }
}
