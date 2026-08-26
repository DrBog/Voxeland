package com.voxeland.game.gen

import com.voxeland.game.core.Blocks
import com.voxeland.game.core.Rng
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Deterministic city layout: a road grid carves the plain into blocks,
 * blocks are split into lots, every lot gets a [BuildingVariant] legal for
 * its district, and [Blueprint] turns lot+variant into blocks on demand.
 * Nothing is stored — every query is a pure function of the world seed.
 */
class CityPlan(val worldSeed: Long) {

    companion object {
        const val GROUND_Y = 20
        const val PERIOD = 26            // road grid pitch
        const val ROAD_BAND = 7          // sidewalk, 5 asphalt, sidewalk
        const val CITY_RADIUS = 268f
        const val DOWNTOWN_R = 78f
        const val COMMERCIAL_R = 150f
    }

    fun groundHeight(x: Int, z: Int): Int {
        val d = sqrt((x * x + z * z).toFloat())
        if (d < CITY_RADIUS + 6) return GROUND_Y
        val n = Rng.valueNoise(worldSeed + 11, x / 19f, z / 19f) +
                0.5f * Rng.valueNoise(worldSeed + 12, x / 7f, z / 7f)
        val fade = min(1f, (d - CITY_RADIUS - 6) / 40f)
        return GROUND_Y + (n * 4f * fade).toInt() - (fade * 1.5f).toInt()
    }

    fun districtAt(x: Int, z: Int): District {
        val d = sqrt((x * x + z * z).toFloat())
        if (d >= CITY_RADIUS) return District.WASTELAND
        if (d < DOWNTOWN_R) return District.DOWNTOWN
        if (d < COMMERCIAL_R) return District.COMMERCIAL
        // one wedge of the outer ring is the industrial sector
        return if (x > 40 && z > 40) District.INDUSTRIAL else District.SUBURBS
    }

    private fun floorDiv(a: Int, b: Int) = Math.floorDiv(a, b)
    private fun floorMod(a: Int, b: Int) = Math.floorMod(a, b)

    fun isRoad(x: Int, z: Int): Boolean {
        val lx = floorMod(x, PERIOD); val lz = floorMod(z, PERIOD)
        return lx < ROAD_BAND || lz < ROAD_BAND
    }

    /** surface block on a road cell */
    private fun roadSurface(x: Int, z: Int): Byte {
        val lx = floorMod(x, PERIOD); val lz = floorMod(z, PERIOD)
        val onX = lx < ROAD_BAND; val onZ = lz < ROAD_BAND
        // sidewalk edges
        if (onX && (lx == 0 || lx == ROAD_BAND - 1) && !(onZ && lz in 1 until ROAD_BAND - 1)) return Blocks.SIDEWALK
        if (onZ && (lz == 0 || lz == ROAD_BAND - 1) && !(onX && lx in 1 until ROAD_BAND - 1)) return Blocks.SIDEWALK
        // dashed center line
        if (onX && lx == 3 && !onZ && floorMod(z, 4) < 2) return Blocks.ROAD_LINE
        if (onZ && lz == 3 && !onX && floorMod(x, 4) < 2) return Blocks.ROAD_LINE
        return Blocks.ASPHALT
    }

    data class Lot(
        val x0: Int, val z0: Int, val x1: Int, val z1: Int,   // inclusive bounds
        val seed: Long,
        val district: District,
        val variant: BuildingVariant,
        val front: Int,                                       // 0=-z 1=+z 2=-x 3=+x
    ) {
        val w get() = x1 - x0 + 1
        val d get() = z1 - z0 + 1
    }

    private val lotCache = java.util.concurrent.ConcurrentHashMap<Long, Any>()
    private val NO_LOT = Any()

    /** the lot containing world cell (x,z), or null on roads/gaps/wasteland */
    fun lotAt(x: Int, z: Int): Lot? {
        val lx = floorMod(x, PERIOD); val lz = floorMod(z, PERIOD)
        if (lx < ROAD_BAND || lz < ROAD_BAND) return null
        val bx = floorDiv(x, PERIOD); val bz = floorDiv(z, PERIOD)
        val innerX = lx - ROAD_BAND; val innerZ = lz - ROAD_BAND    // 0..18
        val inner = PERIOD - ROAD_BAND                              // 19
        val cx = bx * PERIOD + ROAD_BAND + inner / 2
        val cz = bz * PERIOD + ROAD_BAND + inner / 2
        val district = districtAt(cx, cz)
        if (district == District.WASTELAND) return null

        val split = district == District.SUBURBS   // 2x2 sublots for houses
        val sub = inner / 2                                          // 9
        val sx: Int; val sz: Int; val qx: Int; val qz: Int
        if (split) {
            qx = if (innerX < sub) 0 else 1
            qz = if (innerZ < sub) 0 else 1
            if (innerX == inner - 1 || innerZ == inner - 1) { /* 1-cell alley absorbed below */ }
            sx = bx * PERIOD + ROAD_BAND + qx * (sub + 1)
            sz = bz * PERIOD + ROAD_BAND + qz * (sub + 1)
            if (x < sx || z < sz || x > sx + sub - 1 || z > sz + sub - 1) return null
        } else {
            qx = 0; qz = 0
            sx = bx * PERIOD + ROAD_BAND
            sz = bz * PERIOD + ROAD_BAND
        }
        val key = (sx.toLong() shl 32) xor (sz.toLong() and 0xFFFFFFFFL)
        val cached = lotCache.computeIfAbsent(key) {
            val lw = if (split) sub else inner
            val seed = Rng.hash(worldSeed, sx, sz, 5)
            // a few lots stay empty — vacant ground reads more like a real dead city
            if (Rng.toFloat(Rng.hash(seed, 91)) < if (district == District.SUBURBS) 0.10f else 0.06f) {
                NO_LOT
            } else {
                val variant = VariantCatalog.pickFor(district, worldSeed, sx, sz)
                val front = if (split) {
                    if (Rng.toFloat(Rng.hash(seed, 7)) < 0.5f) (if (qz == 0) 0 else 1) else (if (qx == 0) 2 else 3)
                } else Rng.nextInt(seed, 4, 8)
                Lot(sx, sz, sx + lw - 1, sz + lw - 1, seed, district, variant, front)
            }
        }
        return cached as? Lot
    }

    /**
     * The world's block function. Pure and deterministic; overrides
     * (player edits) are layered on top by the World.
     */
    fun blockAt(x: Int, y: Int, z: Int): Byte {
        val g = groundHeight(x, z)
        if (y < g) return if (y < g - 3) Blocks.STONE else Blocks.DIRT

        val d2 = sqrt((x * x + z * z).toFloat())
        val inCity = d2 < CITY_RADIUS

        if (inCity && isRoad(x, z)) {
            return if (y == g) {
                // grim touch: occasional rubble spilled on roads
                if (Rng.toFloat(Rng.hash(worldSeed, x, z, 31)) < 0.012f) Blocks.RUBBLE else roadSurface(x, z)
            } else Blocks.AIR
        }

        val lot = if (inCity) lotAt(x, z) else null
        if (lot != null) {
            val b = Blueprint.blockAt(lot, x - lot.x0, y - g, z - lot.z0, worldSeed)
            if (b != Blueprint.PASS) return b
            return if (y == g) Blueprint.yardSurface(lot, x, z, worldSeed) else Blocks.AIR
        }

        // vacant city ground / wasteland
        if (y == g) {
            val r = Rng.toFloat(Rng.hash(worldSeed, x, z, 44))
            return when {
                inCity && r < 0.05f -> Blocks.RUBBLE
                inCity -> if (r < 0.55f) Blocks.DIRT else Blocks.GRASS
                r < 0.04f -> Blocks.GRAVEL
                r < 0.5f -> Blocks.GRASS
                else -> Blocks.DIRT
            }
        }
        if (!inCity && y > g) {
            // dead trees dot the wasteland
            val tr = Rng.toFloat(Rng.hash(worldSeed, x, z, 71))
            if (tr < 0.0025f) {
                val h = 3 + (Rng.toFloat(Rng.hash(worldSeed, x, z, 72)) * 3).toInt()
                if (y <= g + h) return Blocks.LOG_DEAD
            }
            // branch stubs adjacent to trunks
            for (dx in -1..1) for (dz in -1..1) {
                if (dx == 0 && dz == 0) continue
                val nx = x + dx; val nz = z + dz
                if (Rng.toFloat(Rng.hash(worldSeed, nx, nz, 71)) < 0.0025f) {
                    val h = 3 + (Rng.toFloat(Rng.hash(worldSeed, nx, nz, 72)) * 3).toInt()
                    val gn = groundHeight(nx, nz)
                    if (y in gn + h - 1..gn + h && Rng.toFloat(Rng.hash(worldSeed, x, z, 73 + y)) < 0.4f)
                        return Blocks.LEAVES_DEAD
                }
            }
        }
        return Blocks.AIR
    }

    /** true if any solid blueprint/terrain blocks exist above this y (cheap "under a roof" test) */
    fun isSheltered(x: Int, y: Int, z: Int): Boolean {
        val lot = lotAt(x, z) ?: return false
        val g = groundHeight(x, z)
        val top = g + lot.variant.height + 8
        for (yy in y + 1..top) {
            val b = Blueprint.blockAt(lot, x - lot.x0, yy - g, z - lot.z0, worldSeed)
            if (b != Blueprint.PASS && b != Blocks.AIR && !Blocks.isTransparent(b)) return true
        }
        return false
    }
}

/**
 * Renders a [BuildingVariant] onto a lot as a pure block function.
 * Local coords: bx in [0,w), bz in [0,d), ly = height above ground
 * (ly 0 = ground slab level).
 */
object Blueprint {
    /** sentinel: "no building block here — fall through to yard/terrain" */
    const val PASS: Byte = -1

    fun yardSurface(lot: CityPlan.Lot, x: Int, z: Int, seed: Long): Byte {
        val r = Rng.toFloat(Rng.hash(seed, x, z, 21))
        return when (lot.district) {
            District.SUBURBS -> if (r < 0.7f) Blocks.GRASS else Blocks.DIRT
            District.INDUSTRIAL -> if (r < 0.85f) Blocks.GRAVEL else Blocks.RUBBLE
            else -> if (r < 0.9f) Blocks.SIDEWALK else Blocks.RUBBLE
        }
    }

    fun blockAt(lot: CityPlan.Lot, bx: Int, ly: Int, bz: Int, worldSeed: Long): Byte {
        val v = lot.variant
        val arch = v.archetype
        val seed = lot.seed

        // building footprint inset from lot bounds
        val margin = when (arch) {
            Archetype.HOUSE -> 1
            Archetype.TOWNHOUSE -> 1
            Archetype.SKYSCRAPER -> 2
            Archetype.FACTORY, Archetype.WAREHOUSE -> 2
            else -> 2
        }
        val w = lot.w - margin * 2
        val d = lot.d - margin * 2
        val fx = bx - margin; val fz = bz - margin      // footprint coords
        val inside = fx in 0 until w && fz in 0 until d
        if (ly < 0) return PASS

        val fh = arch.floorHeight
        val bodyH = v.floors * fh                        // top slab sits at ly == bodyH
        val perim = inside && (fx == 0 || fz == 0 || fx == w - 1 || fz == d - 1)

        // ------------------------------------------------ fence for factories
        if (!inside && arch == Archetype.FACTORY && ly in 1..2) {
            val edge = bx == 0 || bz == 0 || bx == lot.w - 1 || bz == lot.d - 1
            if (edge && Rng.toFloat(Rng.hash(seed, bx, bz, 3)) > 0.15f) return Blocks.FENCE
        }
        if (!inside) return PASS

        // ------------------------------------------------ ground slab
        if (ly == 0) return floorMaterial(v, 0, seed)

        // ------------------------------------------------ roof zone
        if (ly > bodyH) {
            return roofBlock(v, fx, ly - bodyH, fz, w, d, seed)
        }

        // ------------------------------------------------ intermediate + top slabs
        val onSlab = ly % fh == 0
        val floorIdx = (ly - 1) / fh                      // which storey this cell is inside

        // stairwell: a 2-wide well along the back wall gets slab holes + steps
        val stair = stairInfo(v, w, d, seed)
        if (onSlab && ly < bodyH + 1) {
            val inWell = fx in stair.x0..stair.x1 && fz == stair.z && ly != bodyH
            if (!inWell || arch == Archetype.WAREHOUSE) {
                if (ly == bodyH) return roofSlabMaterial(v)
                return floorMaterial(v, ly / fh, seed)
            }
            return Blocks.AIR
        }

        // steps inside the well (skip in single-storey warehouses)
        if (v.floors > 1 && fz == stair.z && fx in stair.x0..stair.x1) {
            val local = ly - floorIdx * fh                // 1..fh-1
            val stepX = if (floorIdx % 2 == 0) stair.x0 + (local - 1) else stair.x1 - (local - 1)
            if (fx == stepX && local <= fh) return floorMaterial(v, floorIdx, seed)
        }

        // ------------------------------------------------ perimeter walls
        if (perim) {
            return wallBlock(v, fx, ly, fz, w, d, fh, seed, lot, worldSeed)
        }

        // ------------------------------------------------ interior
        return interiorBlock(v, fx, ly, fz, w, d, fh, floorIdx, seed)
    }

    private data class Stair(val x0: Int, val x1: Int, val z: Int)
    private fun stairInfo(v: BuildingVariant, w: Int, d: Int, seed: Long): Stair {
        val x0 = 1 + Rng.nextInt(seed, max(1, w - 2 - 4), 13)
        return Stair(x0, min(w - 2, x0 + 3), d - 2)
    }

    private fun floorMaterial(v: BuildingVariant, floor: Int, seed: Long): Byte = when (v.function) {
        BuildingFunction.RESIDENTIAL -> if (floor == 0) Blocks.PLANK else Blocks.CARPET
        BuildingFunction.OFFICE -> if (floor == 0) Blocks.TILE_FLOOR else Blocks.CARPET
        BuildingFunction.GROCERY, BuildingFunction.PHARMACY, BuildingFunction.HARDWARE -> Blocks.TILE_FLOOR
        BuildingFunction.INDUSTRIAL, BuildingFunction.STORAGE -> Blocks.CONCRETE
    }

    private fun roofSlabMaterial(v: BuildingVariant): Byte = when (v.roof) {
        RoofStyle.GABLE, RoofStyle.HIP -> Blocks.PLANK       // attic floor under pitched roofs
        else -> Blocks.ROOF_TAR
    }

    // -------------------------------------------------------------- walls

    private fun wallBlock(
        v: BuildingVariant, fx: Int, ly: Int, fz: Int, w: Int, d: Int, fh: Int,
        seed: Long, lot: CityPlan.Lot, worldSeed: Long,
    ): Byte {
        val floorIdx = (ly - 1) / fh
        val local = ly - floorIdx * fh                    // 1..fh

        // front door: 2-high gap centered on the front face, ground floor only
        val front = lot.front
        val onFront = when (front) {
            0 -> fz == 0; 1 -> fz == d - 1; 2 -> fx == 0; else -> fx == w - 1
        }
        val doorCenter = if (front < 2) w / 2 else d / 2
        val along = if (front < 2) fx else fz
        if (onFront && floorIdx == 0 && along in doorCenter - (if (v.archetype == Archetype.WAREHOUSE || v.archetype == Archetype.FACTORY) 1 else 0)..doorCenter) {
            if (local <= 2) return Blocks.AIR
            if (local == 3) return Blocks.DOOR_FRAME
        }

        // corners always solid
        val corner = (fx == 0 || fx == w - 1) && (fz == 0 || fz == d - 1)
        if (corner) return v.wall

        // decay: some wall cells collapsed into holes/rubble
        val decay = Rng.toFloat(Rng.hash(seed, fx, ly, fz * 7 + 3))
        if (decay < 0.015f) return Blocks.AIR
        if (decay < 0.022f && local == 1) return Blocks.RUBBLE

        // window band per style
        val win = isWindowCell(v, fx, local, fz, w, d, floorIdx)
        if (win) {
            val wr = Rng.toFloat(Rng.hash(seed, fx, ly, fz + 501))
            return when {
                wr < 0.14f -> Blocks.WINDOW_BOARDED       // survivors were here
                wr < 0.30f -> Blocks.AIR                  // shattered
                v.window == WindowStyle.CURTAIN -> Blocks.GLASS_DARK
                else -> Blocks.GLASS
            }
        }
        return v.wall
    }

    private fun isWindowCell(v: BuildingVariant, fx: Int, local: Int, fz: Int, w: Int, d: Int, floorIdx: Int): Boolean {
        val alongX = fz == 0 || fz == d - 1
        val along = if (alongX) fx else fz
        val len = if (alongX) w else d
        if (along == 0 || along == len - 1) return false
        return when (v.window) {
            WindowStyle.PUNCHED -> local == 2 && along % 3 == 1
            WindowStyle.WIDE -> local == 2 && along % 4 != 0
            WindowStyle.RIBBON -> (local == 2 || local == 3) && along % 5 != 0
            WindowStyle.CURTAIN -> local in 1..3 && along % 6 != 0
            WindowStyle.SMALL_HIGH -> local == v.archetype.floorHeight - 1 && along % 2 == 1
        }
    }

    // -------------------------------------------------------------- roofs

    private fun roofBlock(v: BuildingVariant, fx: Int, ry: Int, fz: Int, w: Int, d: Int, seed: Long): Byte {
        return when (v.roof) {
            RoofStyle.FLAT -> PASS
            RoofStyle.PARAPET ->
                if (ry == 1 && (fx == 0 || fz == 0 || fx == w - 1 || fz == d - 1)) v.wall else PASS
            RoofStyle.GABLE -> {
                // pitched along shorter axis, shingle shell + wall-material gable ends
                val alongX = w >= d
                val t = if (alongX) fz else fx
                val len = if (alongX) d else w
                val h = min(t, len - 1 - t) + 1
                val ridge = (len - 1) / 2
                when {
                    ry == h && min(t, len - 1 - t) <= ridge -> Blocks.ROOF_SHINGLE
                    ry < h -> {
                        val end = if (alongX) (fx == 0 || fx == w - 1) else (fz == 0 || fz == d - 1)
                        if (end) v.wall else PASS
                    }
                    else -> PASS
                }
            }
            RoofStyle.HIP -> {
                val h = min(min(fx, w - 1 - fx), min(fz, d - 1 - fz)) + 1
                val cap = min((w - 1) / 2, (d - 1) / 2) + 1
                if (ry == min(h, cap)) Blocks.ROOF_SHINGLE else PASS
            }
            RoofStyle.TOWER_CAP -> {
                if (ry == 1 && (fx == 0 || fz == 0 || fx == w - 1 || fz == d - 1)) return v.wall
                val inX = fx in w / 6..w - 1 - w / 6
                val inZ = fz in d / 6..d - 1 - d / 6
                val box = inX && inZ
                val boxEdge = box && (fx == w / 6 || fx == w - 1 - w / 6 || fz == d / 6 || fz == d - 1 - d / 6)
                when {
                    ry in 1..3 && boxEdge -> Blocks.METAL_PANEL
                    ry == 4 && box -> Blocks.METAL_PANEL
                    ry in 5..8 && fx == w / 2 && fz == d / 2 -> Blocks.METAL_RUST   // antenna mast
                    else -> PASS
                }
            }
            RoofStyle.SAWTOOTH -> {
                val phase = fx % 4
                when {
                    ry == phase + 1 && phase < 3 -> Blocks.METAL_PANEL
                    phase == 3 && ry in 1..3 ->
                        if (ry == 3) Blocks.METAL_PANEL
                        else if (fz % 2 == 0) Blocks.GLASS else Blocks.METAL_PANEL
                    else -> PASS
                }
            }
        }
    }

    // -------------------------------------------------------------- interiors

    private fun interiorBlock(
        v: BuildingVariant, fx: Int, ly: Int, fz: Int, w: Int, d: Int, fh: Int,
        floorIdx: Int, seed: Long,
    ): Byte {
        val local = ly - floorIdx * fh                    // 1..fh-1 inside a storey
        val fs = Rng.hash(seed, floorIdx, 17)
        val stair = stairInfo(v, w, d, seed)
        val inWellArea = fx in stair.x0 - 1..stair.x1 + 1 && fz >= stair.z - 1

        // room partition walls (skip industrial/warehouse open plans; keep the stairwell clear)
        if (!inWellArea && v.function != BuildingFunction.INDUSTRIAL && v.function != BuildingFunction.STORAGE && w >= 8 && d >= 8) {
            val px = 3 + (Rng.toFloat(Rng.hash(fs, 1)) * (w - 6)).toInt()
            val pz = 3 + (Rng.toFloat(Rng.hash(fs, 2)) * (d - 6)).toInt()
            val doorX = 1 + (Rng.toFloat(Rng.hash(fs, 3)) * (w - 3)).toInt()
            val doorZ = 1 + (Rng.toFloat(Rng.hash(fs, 4)) * (d - 3)).toInt()
            if (fx == px && !(fz == doorZ && local <= 2) && local < fh) return partitionMat(v)
            if (fz == pz && !(fx == doorX && local <= 2) && local < fh) return partitionMat(v)
        }

        // furnishing layer sits on the storey floor
        if (local == 1 && !inWellArea) {
            val r = Rng.toFloat(Rng.hash(seed, fx, floorIdx, fz + 900))
            val nearWall = fx == 1 || fz == 1 || fx == w - 2 || fz == d - 2
            when (v.function) {
                BuildingFunction.GROCERY, BuildingFunction.PHARMACY, BuildingFunction.HARDWARE -> {
                    // aisle shelving on the ground floor
                    if (floorIdx == 0 && fx in 2 until w - 2 && fx % 3 == 0 && fz in 2 until d - 2 && fz % 5 != 0)
                        return Blocks.SHELF
                    if (nearWall && r < 0.12f) return Blocks.COUNTER
                }
                BuildingFunction.STORAGE, BuildingFunction.INDUSTRIAL -> {
                    // crate clusters
                    val cl = Rng.toFloat(Rng.hash(seed, fx / 3, floorIdx, fz / 3 + 33))
                    if (cl < 0.28f && r < 0.6f) return Blocks.CONTAINER
                    if (v.function == BuildingFunction.INDUSTRIAL && fx % 5 == 2 && fz % 6 == 3)
                        return Blocks.METAL_RUST          // dead machinery
                }
                BuildingFunction.RESIDENTIAL -> {
                    if (nearWall && r < 0.10f) return Blocks.COUNTER
                    if (r > 0.995f) return Blocks.CONTAINER
                }
                BuildingFunction.OFFICE -> {
                    if (fx % 4 == 2 && fz % 4 == 2 && r < 0.5f) return Blocks.COUNTER  // desks
                    if (nearWall && r < 0.04f) return Blocks.CONTAINER
                }
            }
            // scattered debris everywhere — the city did not fall gently
            if (r > 0.985f) return Blocks.RUBBLE
        }
        // second tier of tall shelving in warehouses
        if (local == 2 && v.function == BuildingFunction.STORAGE) {
            val cl = Rng.toFloat(Rng.hash(seed, fx / 3, floorIdx, fz / 3 + 33))
            val r = Rng.toFloat(Rng.hash(seed, fx, floorIdx, fz + 900))
            if (cl < 0.28f && r < 0.3f) return Blocks.CONTAINER
        }
        return PASS
    }

    private fun partitionMat(v: BuildingVariant): Byte = when (v.function) {
        BuildingFunction.RESIDENTIAL -> Blocks.WOOD_FRAME
        else -> Blocks.CONCRETE
    }
}
