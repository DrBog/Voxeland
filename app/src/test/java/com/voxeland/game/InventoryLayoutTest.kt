package com.voxeland.game

import android.app.Activity
import android.graphics.RectF
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.ScrollView
import com.voxeland.game.audio.SoundManager
import com.voxeland.game.core.Environment
import com.voxeland.game.items.Items
import com.voxeland.game.progression.Character
import com.voxeland.game.ui.GameHud
import com.voxeland.game.ui.Panels
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * The backpack panel and the hotbar, laid out on real phone geometry.
 * The old panel was about 700dp wide with no scroll, so on a landscape
 * handset it was clipped off both edges.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class InventoryLayoutTest {

    private data class Screen(val wDp: Int, val hDp: Int, val dpi: String) {
        override fun toString() = "${wDp}x${hDp}dp@$dpi"
    }

    private val screens = listOf(
        Screen(851, 393, "440dpi"),
        Screen(800, 360, "xxhdpi"),
        Screen(732, 412, "xhdpi"),
        Screen(640, 360, "mdpi"),
        Screen(592, 360, "xxxhdpi"),
    )

    private fun activityFor(s: Screen): Activity {
        RuntimeEnvironment.setQualifiers("w${s.wDp}dp-h${s.hDp}dp-land-${s.dpi}")
        return Robolectric.buildActivity(Activity::class.java).setup().get()
    }

    private fun engineFor(act: Activity): GameEngine {
        val (w, p) = GameEngine.newGame(5L, Character("Test", 1, 0, 0, 0))
        return GameEngine(w, p, Environment(), SoundManager(act))
    }

    private fun layout(v: View, wPx: Int, hPx: Int) {
        v.measure(
            View.MeasureSpec.makeMeasureSpec(wPx, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(hPx, View.MeasureSpec.EXACTLY))
        v.layout(0, 0, wPx, hPx)
    }

    private fun all(v: View): List<View> {
        val out = ArrayList<View>()
        fun walk(x: View) {
            out.add(x)
            if (x is ViewGroup) for (i in 0 until x.childCount) walk(x.getChildAt(i))
        }
        walk(v); return out
    }

    private fun inScroller(root: View, v: View): Boolean {
        var cur: View? = v
        while (cur != null && cur !== root) {
            if (cur is ScrollView) return true
            cur = cur.parent as? View
        }
        return false
    }

    private fun boundsIn(root: View, v: View): IntArray {
        var x = 0; var y = 0; var cur: View? = v
        while (cur != null && cur !== root) { x += cur.left; y += cur.top; cur = cur.parent as? View }
        return intArrayOf(x, y, x + v.width, y + v.height)
    }

    @Test
    fun theBackpackPanelFitsOnScreen() {
        for (s in screens) {
            val act = activityFor(s)
            val dm = act.resources.displayMetrics
            val eng = engineFor(act)
            val root = Panels.inventory(act, eng) { }
            layout(root, dm.widthPixels, dm.heightPixels)

            // the panel is the clickable card inside the scrim
            val panel = (root as ViewGroup).getChildAt(0)
            val b = boundsIn(root, panel)
            assertTrue("panel wider than the screen at $s: ${b[2] - b[0]} > ${dm.widthPixels}",
                b[2] - b[0] <= dm.widthPixels)
            assertTrue("panel taller than the screen at $s: ${b[3] - b[1]} > ${dm.heightPixels}",
                b[3] - b[1] <= dm.heightPixels)
            assertTrue("panel clipped off an edge at $s: ${b.toList()}",
                b[0] >= 0 && b[1] >= 0 && b[2] <= dm.widthPixels && b[3] <= dm.heightPixels)
        }
    }

    @Test
    fun everyPanelButtonIsReachable() {
        for (s in screens) {
            val act = activityFor(s)
            val dm = act.resources.displayMetrics
            val eng = engineFor(act)
            val root = Panels.inventory(act, eng) { }
            layout(root, dm.widthPixels, dm.heightPixels)
            val buttons = all(root).filterIsInstance<Button>()
            assertTrue("no buttons in the backpack at $s", buttons.size >= 4)
            for (btn in buttons) {
                val r = boundsIn(root, btn)
                assertTrue("button '${btn.text}' has no size at $s", r[2] > r[0] && r[3] > r[1])
                // recipe buttons live in a scroller, so below the fold is fine;
                // everything else has to be on screen without scrolling
                if (inScroller(root, btn)) continue
                assertTrue("button '${btn.text}' off-screen at $s: ${r.toList()}",
                    r[0] >= 0 && r[1] >= 0 && r[2] <= dm.widthPixels && r[3] <= dm.heightPixels)
            }

            // and the scroller itself must be on screen and worth scrolling
            val scroller = all(root).firstOrNull { it is ScrollView }
            assertTrue("crafting list missing at $s", scroller != null)
            val sr = boundsIn(root, scroller!!)
            assertTrue("crafting list off-screen at $s: ${sr.toList()}",
                sr[0] >= 0 && sr[1] >= 0 && sr[2] <= dm.widthPixels && sr[3] <= dm.heightPixels)
            assertTrue("crafting list too short to use at $s: ${(sr[3] - sr[1]) / dm.density}dp",
                (sr[3] - sr[1]) / dm.density >= 90f)
            assertTrue("crafting list too narrow at $s: ${(sr[2] - sr[0]) / dm.density}dp",
                (sr[2] - sr[0]) / dm.density >= 120f)
        }
    }

    @Test
    fun theSlotGridGetsRealEstate() {
        for (s in screens) {
            val act = activityFor(s)
            val dm = act.resources.displayMetrics
            val eng = engineFor(act)
            val root = Panels.inventory(act, eng) { }
            layout(root, dm.widthPixels, dm.heightPixels)
            val grid = all(root).firstOrNull { it.javaClass.simpleName == "InventoryGrid" }
            assertTrue("the slot grid is missing at $s", grid != null)
            val den = dm.density
            assertTrue("grid too small to hold slots at $s: ${grid!!.width}x${grid.height}",
                grid.width > 140 * den && grid.height > 90 * den)
        }
    }

    @Test
    fun theHotbarNeverCollidesWithTheActionButtons() {
        for (s in screens) {
            val act = activityFor(s)
            val dm = act.resources.displayMetrics
            val eng = engineFor(act)
            val hud = GameHud(act, eng, object : GameHud.Callbacks {
                override fun onPauseMenu() {}
                override fun onOpenInventory() {}
                override fun onOpenSkills() {}
                override fun onAutosave() {}
                override fun toastText(): String? = null
            })
            layout(hud, dm.widthPixels, dm.heightPixels)
            val rects = hud.controlRects()

            fun overlaps(a: RectF, b: RectF) =
                a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

            for (i in 0 until 5) {
                val slot = rects["hotbar$i"]!!
                assertTrue("hotbar slot $i off-screen at $s: $slot",
                    slot.left >= 0 && slot.top >= 0 &&
                    slot.right <= dm.widthPixels && slot.bottom <= dm.heightPixels)
                assertTrue("hotbar slot $i is not thumb sized at $s: ${slot.width() / dm.density}dp",
                    slot.width() / dm.density >= 30f)
                for (id in listOf("attack", "use", "jump", "light", "crouch")) {
                    assertTrue("hotbar slot $i overlaps the $id button at $s",
                        !overlaps(slot, rects[id]!!))
                }
            }
        }
    }

    @Test
    fun everyBackpackSlotIsDrawnWhenPocketsAreDeepened() {
        // a maxed backpack is 35 slots; none of them may fall outside the grid
        val s = screens.first()
        val act = activityFor(s)
        val dm = act.resources.displayMetrics
        val eng = engineFor(act)
        eng.player.inventory.rows = 6
        repeat(20) { eng.player.inventory.add(Items.NAILS, 5) }
        val root = Panels.inventory(act, eng) { }
        layout(root, dm.widthPixels, dm.heightPixels)
        val grid = all(root).first { it.javaClass.simpleName == "InventoryGrid" }
        val l = com.voxeland.game.ui.SlotGrid.layout(
            grid.width.toFloat(), grid.height.toFloat(), 7, dm.density)
        for (i in 0 until eng.player.inventory.capacity) {
            val c = l.rect(i)
            assertTrue("slot $i falls outside the grid view",
                c.left >= -0.5f && c.top >= -0.5f &&
                c.right <= grid.width + 0.5f && c.bottom <= grid.height + 0.5f)
        }
    }
}
