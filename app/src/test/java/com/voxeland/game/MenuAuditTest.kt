package com.voxeland.game

import android.app.Activity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.ScrollView
import android.widget.TextView
import com.voxeland.game.audio.SoundManager
import com.voxeland.game.core.Environment
import com.voxeland.game.progression.Character
import com.voxeland.game.ui.MenuViews
import com.voxeland.game.ui.Panels
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * Every menu and panel, laid out on real phone geometry.
 *
 * This exists because a weighted child of a WRAP_CONTENT parent measures to
 * zero: every panel title was invisible except the one panel that happened to
 * have an explicit width. A per-screen sweep catches that class of thing
 * without needing a device.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MenuAuditTest {

    private data class Screen(val wDp: Int, val hDp: Int, val dpi: String) {
        override fun toString() = "${wDp}x${hDp}@$dpi"
    }

    private val screens = listOf(
        Screen(851, 393, "440dpi"),
        Screen(800, 360, "xxhdpi"),
        Screen(640, 360, "mdpi"),
        Screen(592, 360, "xxxhdpi"),
    )

    private fun act(s: Screen): Activity {
        RuntimeEnvironment.setQualifiers("w${s.wDp}dp-h${s.hDp}dp-land-${s.dpi}")
        return Robolectric.buildActivity(Activity::class.java).setup().get()
    }

    private fun all(v: View): List<View> {
        val out = ArrayList<View>()
        fun walk(x: View) { out.add(x); if (x is ViewGroup) for (i in 0 until x.childCount) walk(x.getChildAt(i)) }
        walk(v); return out
    }

    private fun inScroller(root: View, v: View): Boolean {
        var cur: View? = v
        while (cur != null && cur !== root) {
            if (cur is ScrollView || cur is HorizontalScrollView) return true
            cur = cur.parent as? View
        }
        return false
    }

    private fun View.paintLeft() = paddingLeft
    private fun View.paintRight() = paddingRight
    private fun View.paintTop() = paddingTop
    private fun View.paintBottom() = paddingBottom

    private fun bounds(root: View, v: View): IntArray {
        var x = 0; var y = 0; var cur: View? = v
        while (cur != null && cur !== root) { x += cur.left; y += cur.top; cur = cur.parent as? View }
        return intArrayOf(x, y, x + v.width, y + v.height)
    }

    private val failures = ArrayList<String>()

    private fun audit(name: String, s: Screen, root: View, wPx: Int, hPx: Int) {
        root.measure(
            View.MeasureSpec.makeMeasureSpec(wPx, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(hPx, View.MeasureSpec.EXACTLY))
        root.layout(0, 0, wPx, hPx)

        val problems = ArrayList<String>()
        // the panel card itself
        if (root is ViewGroup && root.childCount > 0) {
            val card = root.getChildAt(0)
            val cb = bounds(root, card)
            if (cb[0] < 0 || cb[1] < 0 || cb[2] > wPx || cb[3] > hPx)
                problems.add("CARD out of bounds ${cb.toList()} screen=${wPx}x$hPx")
        }
        // scrollers must themselves be on screen and usable
        for (sc in all(root).filter { it is ScrollView || it is HorizontalScrollView }) {
            val sb = bounds(root, sc)
            if (sb[0] < 0 || sb[1] < 0 || sb[2] > wPx || sb[3] > hPx)
                problems.add("${sc.javaClass.simpleName} out of bounds ${sb.toList()} screen=${wPx}x$hPx")
            // and its content must be reachable horizontally
            val inner = (sc as ViewGroup).getChildAt(0)
            if (inner != null && inner.width > sc.width + 2)
                problems.add("${sc.javaClass.simpleName} content ${inner.width}px wider than viewport ${sc.width}px")
        }
        for (v in all(root)) {
            val interactive = v is Button || v is EditText
            val textual = v is TextView
            if (!interactive && !textual) continue
            val b = bounds(root, v)
            val label = when {
                v is Button -> "BTN '${v.text}'"
                v is EditText -> "EDIT"
                else -> "TXT '${(v as TextView).text.toString().take(22)}'"
            }
            if (b[2] <= b[0] || b[3] <= b[1]) { problems.add("$label has ZERO SIZE"); continue }
            if (inScroller(root, v)) continue
            if (b[0] < 0 || b[1] < 0 || b[2] > wPx || b[3] > hPx)
                problems.add("$label out of bounds ${b.toList()} screen=${wPx}x$hPx")
            val den = wPx / s.wDp.toFloat()
            if (interactive && (b[3] - b[1]) < 30 * den)
                problems.add("$label too short to tap: ${((b[3] - b[1]) / den).toInt()}dp")
            if (interactive && (b[2] - b[0]) < 34 * den)
                problems.add("$label too narrow to tap: ${((b[2] - b[0]) / den).toInt()}dp")
            // text that neither wraps nor ellipsises simply gets cut off
            if (v is TextView && v.text.isNotEmpty()) {
                val avail = (b[2] - b[0]) - v.paintLeft() - v.paintRight()
                val needed = v.paint.measureText(v.text.toString())
                val singleLine = v.maxLines == 1 || v.lineCount == 1
                if (singleLine && v.ellipsize == null && needed > avail + 1f && v.lineCount <= 1)
                    problems.add("$label CLIPPED: needs ${needed.toInt()}px, has ${avail.toInt()}px")
                if (v.lineCount > 0 && v.layout != null) {
                    val textH = v.layout.height + v.paintTop() + v.paintBottom()
                    if (textH > (b[3] - b[1]) + 1)
                        problems.add("$label VERTICALLY CLIPPED: text ${textH}px in ${b[3] - b[1]}px")
                }
            }
        }
        for (pr in problems.distinct()) failures.add("$name @ $s :: $pr")
    }

    @Test
    fun auditEveryMenu() {
        for (s in screens) {
            val a = act(s)
            val dm = a.resources.displayMetrics
            val w = dm.widthPixels; val h = dm.heightPixels
            val eng = GameEngine(
                GameEngine.newGame(3L, Character("Riley", 1, 0, 0, 0)).first,
                GameEngine.newGame(3L, Character("Riley", 1, 0, 0, 0)).second,
                Environment(), SoundManager(a))

            audit("mainMenu(no save)", s, MenuViews.mainMenu(a, false, {}, {}), w, h)
            audit("mainMenu(save)", s, MenuViews.mainMenu(a, true, {}, {}), w, h)
            audit("characterCreation", s, MenuViews.characterCreation(a) {}, w, h)
            audit("skills", s, Panels.skills(a, eng) {}, w, h)
            audit("pause", s, Panels.pause(a, eng, {}, {}), w, h)
            audit("death", s, Panels.death(a, "Torn apart.", "stats\nline two") {}, w, h)
            audit("inventory", s, Panels.inventory(a, eng) {}, w, h)
        }
        assertTrue(
            "${failures.size} layout problems:\n" + failures.joinToString("\n").take(2500),
            failures.isEmpty())
    }
}
