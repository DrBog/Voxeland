package com.voxeland.game

import android.app.Activity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView
import com.voxeland.game.ui.MenuViews
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * Real measure/layout of the menu hierarchies at phone landscape sizes.
 * These guard the class of bug that made character creation unusable:
 * squeezed value columns and an off-screen primary action.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MenuLayoutTest {

    /**
     * A phone landscape configuration. Density matters: the layout bug that
     * broke character creation only appears when raw-pixel sizes collide with
     * density-scaled text, so every case is exercised at real device DPIs.
     */
    private data class Screen(val wDp: Int, val hDp: Int, val dpi: String) {
        override fun toString() = "${wDp}x${hDp}dp@$dpi"
    }

    /** applies the configuration, then returns a fresh activity under it */
    private fun activityFor(s: Screen): Activity {
        RuntimeEnvironment.setQualifiers("w${s.wDp}dp-h${s.hDp}dp-land-${s.dpi}")
        return Robolectric.buildActivity(Activity::class.java).setup().get()
    }

    private fun screenPx(act: Activity): IntArray {
        val dm = act.resources.displayMetrics
        return intArrayOf(dm.widthPixels, dm.heightPixels)
    }

    private fun layout(v: View, wPx: Int, hPx: Int) {
        v.measure(
            View.MeasureSpec.makeMeasureSpec(wPx, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(hPx, View.MeasureSpec.EXACTLY)
        )
        v.layout(0, 0, wPx, hPx)
    }

    private fun walk(v: View, out: MutableList<View>) {
        out.add(v)
        if (v is ViewGroup) for (i in 0 until v.childCount) walk(v.getChildAt(i), out)
    }

    private fun all(v: View): List<View> = ArrayList<View>().also { walk(v, it) }

    /** absolute on-screen bounds of a view within its laid-out root */
    private fun boundsIn(root: View, v: View): IntArray {
        var x = 0; var y = 0
        var cur: View? = v
        while (cur != null && cur !== root) {
            x += cur.left; y += cur.top
            cur = cur.parent as? View
        }
        return intArrayOf(x, y, x + v.width, y + v.height)
    }

    private fun findText(root: View, text: String): View? =
        all(root).firstOrNull { it is TextView && it.text?.toString()?.contains(text, true) == true }

    // real landscape phones/tablets, spanning mdpi .. xxxhdpi
    private val screens = listOf(
        Screen(851, 393, "440dpi"),   // ~2340x1080, the class of device in the bug report
        Screen(800, 360, "xxhdpi"),   // 2400x1080
        Screen(732, 412, "xhdpi"),
        Screen(640, 360, "mdpi"),
        Screen(592, 360, "xxxhdpi"),  // dense + short: the tightest case
        Screen(1024, 768, "hdpi"),    // tablet
    )

    @Test
    fun wakeUpButtonIsAlwaysOnScreen() {
        for (s in screens) {
            val act = activityFor(s)
            val (wPx, hPx) = screenPx(act).let { it[0] to it[1] }
            val root = MenuViews.characterCreation(act) { }
            layout(root, wPx, hPx)
            val wake = all(root).firstOrNull {
                it is Button && it.text?.toString()?.contains("WAKE", true) == true
            }
            assertTrue("WAKE UP button missing at $s", wake != null)
            val b = boundsIn(root, wake!!)
            assertTrue("WAKE UP has no size at $s: ${b.toList()}", b[2] > b[0] && b[3] > b[1])
            assertTrue("WAKE UP off the bottom at $s: bottom=${b[3]} screen=$hPx", b[3] <= hPx)
            assertTrue("WAKE UP above screen at $s: top=${b[1]}", b[1] >= 0)
            assertTrue("WAKE UP clipped horizontally at $s", b[0] >= 0 && b[2] <= wPx)
        }
    }

    @Test
    fun optionValuesRenderOnASingleWideLine() {
        for (s in screens) {
            val act = activityFor(s)
            val (wPx, hPx) = screenPx(act).let { it[0] to it[1] }
            val root = MenuViews.characterCreation(act) { }
            layout(root, wPx, hPx)
            // "Average" is the default BUILD value that rendered one-letter-per-line in the bug
            val v = findText(root, "Average") as? TextView
            assertTrue("BUILD value not found at $s", v != null)
            val needed = v!!.paint.measureText("Average")
            assertTrue("value collapsed to ${v.width}px (needs ${needed.toInt()}px) at $s",
                v.width >= needed)
            assertTrue("value wrapped onto ${v.lineCount} lines at $s", v.lineCount == 1)
        }
    }

    @Test
    fun titleAndAllFourChoicesFitOnScreen() {
        for (s in screens) {
            val act = activityFor(s)
            val (wPx, hPx) = screenPx(act).let { it[0] to it[1] }
            val root = MenuViews.characterCreation(act) { }
            layout(root, wPx, hPx)
            val title = findText(root, "WHO WERE YOU") as? TextView
            assertTrue("title missing at $s", title != null)
            val tb = boundsIn(root, title!!)
            assertTrue("title clipped at $s: ${tb.toList()} screen=${wPx}x$hPx",
                tb[0] >= 0 && tb[2] <= wPx && tb[3] <= hPx)
            assertTrue("title wrapped onto ${title.lineCount} lines at $s", title.lineCount == 1)
            for (label in listOf("BUILD", "SKIN", "HAIR", "PAST LIFE")) {
                val lv = findText(root, label)
                assertTrue("$label missing at $s", lv != null)
                val lb = boundsIn(root, lv!!)
                assertTrue("$label off-screen at $s: ${lb.toList()}",
                    lb[0] >= 0 && lb[2] <= wPx && lb[1] >= 0 && lb[3] <= hPx)
            }
        }
    }

    @Test
    fun mainMenuButtonsAreOnScreenWithAndWithoutSave() {
        for (hasSave in listOf(false, true)) for (s in screens) {
            val act = activityFor(s)
            val (wPx, hPx) = screenPx(act).let { it[0] to it[1] }
            val root = MenuViews.mainMenu(act, hasSave, {}, {})
            layout(root, wPx, hPx)
            val buttons = all(root).filterIsInstance<Button>()
            assertTrue("no menu buttons (save=$hasSave) at $s", buttons.isNotEmpty())
            if (hasSave) assertTrue("CONTINUE missing when a save exists",
                buttons.any { it.text.toString().contains("CONTINUE", true) })
            for (b in buttons) {
                val r = boundsIn(root, b)
                assertTrue("button '${b.text}' off-screen at $s: ${r.toList()} screen=${wPx}x$hPx",
                    r[0] >= 0 && r[2] <= wPx && r[1] >= 0 && r[3] <= hPx)
                assertTrue("button '${b.text}' has no size at $s", r[2] > r[0] && r[3] > r[1])
            }
        }
    }
}
