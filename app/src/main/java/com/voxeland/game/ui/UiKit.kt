package com.voxeland.game.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import com.voxeland.game.items.ItemDef
import com.voxeland.game.items.ItemKind
import com.voxeland.game.items.Stack

/** Shared grim styling + procedural item icons (no art assets anywhere). */
object UiKit {
    const val BG = 0xEE10100F.toInt()
    const val PANEL = 0xF01A1A18.toInt()
    const val EDGE = 0xFF3A3A36.toInt()
    const val TEXT = 0xFFB9B6AC.toInt()
    const val TEXT_DIM = 0xFF77746C.toInt()
    const val ACCENT = 0xFF8A2E2A.toInt()      // dried blood
    const val GOOD = 0xFF5E7D53.toInt()
    const val WARN = 0xFF9C7C3C.toInt()

    val mono: Typeface = Typeface.MONOSPACE

    fun title(ctx: Context, text: String, size: Float = 22f): TextView = TextView(ctx).apply {
        this.text = text
        setTextColor(TEXT)
        textSize = size
        typeface = Typeface.create(mono, Typeface.BOLD)
        letterSpacing = 0.12f
        gravity = Gravity.CENTER
    }

    fun label(ctx: Context, text: String, size: Float = 13f, color: Int = TEXT_DIM): TextView =
        TextView(ctx).apply {
            this.text = text
            setTextColor(color)
            textSize = size
            typeface = mono
        }

    /** density-independent pixels — every layout size must go through this */
    fun dp(ctx: Context, v: Float): Int = (v * ctx.resources.displayMetrics.density).toInt()

    fun button(
        ctx: Context,
        text: String,
        accent: Boolean = false,
        compact: Boolean = false,
        onClick: () -> Unit,
    ): Button = Button(ctx).apply {
        this.text = text
        isAllCaps = true
        textSize = if (compact) 15f else 14f
        typeface = Typeface.create(mono, Typeface.BOLD)
        setTextColor(if (accent) 0xFFD8D5CB.toInt() else TEXT)
        setBackgroundColor(if (accent) ACCENT else 0xFF262622.toInt())
        val px = dp(ctx, if (compact) 6f else 18f)
        val py = dp(ctx, if (compact) 8f else 11f)
        setPadding(px, py, px, py)
        minWidth = 0
        minimumWidth = 0
        setOnClickListener { onClick() }
    }

    fun vspace(ctx: Context, h: Int) = android.view.View(ctx).apply {
        layoutParams = LinearLayout.LayoutParams(1, h)
    }

    /** stable muted hue per item id */
    fun itemColor(item: ItemDef): Int {
        var h = 0
        for (c in item.id) h = h * 31 + c.code
        val hue = (h and 0x7FFFFFFF) % 360
        val base = Color.HSVToColor(floatArrayOf(hue.toFloat(), 0.32f, 0.62f))
        return base
    }

    /** draw a compact glyph for an item inside rect — shape by kind, hue by id */
    fun drawItemIcon(c: Canvas, r: RectF, item: ItemDef, paint: Paint) {
        val col = itemColor(item)
        paint.style = Paint.Style.FILL
        val cx = r.centerX(); val cy = r.centerY()
        val s = kotlin.math.min(r.width(), r.height()) * 0.30f
        when (item.kind) {
            ItemKind.FOOD -> {          // can
                paint.color = col
                c.drawRect(cx - s * 0.7f, cy - s, cx + s * 0.7f, cy + s, paint)
                paint.color = 0xFF888880.toInt()
                c.drawRect(cx - s * 0.7f, cy - s, cx + s * 0.7f, cy - s * 0.6f, paint)
            }
            ItemKind.DRINK -> {         // bottle
                paint.color = col
                c.drawRect(cx - s * 0.45f, cy - s * 0.4f, cx + s * 0.45f, cy + s, paint)
                c.drawRect(cx - s * 0.2f, cy - s, cx + s * 0.2f, cy - s * 0.3f, paint)
            }
            ItemKind.MEDICAL -> {       // cross
                paint.color = 0xFF9A3A34.toInt()
                c.drawRect(cx - s * 0.3f, cy - s, cx + s * 0.3f, cy + s, paint)
                c.drawRect(cx - s, cy - s * 0.3f, cx + s, cy + s * 0.3f, paint)
            }
            ItemKind.WEAPON, ItemKind.TOOL -> {   // blade/handle diagonal
                paint.color = 0xFF8F8F94.toInt()
                paint.strokeWidth = s * 0.42f
                paint.style = Paint.Style.STROKE
                c.drawLine(cx - s, cy + s, cx + s * 0.7f, cy - s * 0.7f, paint)
                paint.color = 0xFF6B5138.toInt()
                c.drawLine(cx - s, cy + s, cx - s * 0.35f, cy + s * 0.35f, paint)
                paint.style = Paint.Style.FILL
            }
            ItemKind.BLOCK -> {         // cube
                paint.color = col
                c.drawRect(cx - s, cy - s * 0.6f, cx + s * 0.4f, cy + s, paint)
                paint.color = brighten(col, 1.25f)
                c.drawRect(cx - s * 0.5f, cy - s, cx + s, cy + s * 0.55f, paint)
            }
            ItemKind.SPECIAL -> {       // compass ring
                paint.color = 0xFFB0AC9E.toInt()
                paint.style = Paint.Style.STROKE
                paint.strokeWidth = s * 0.3f
                c.drawCircle(cx, cy, s, paint)
                paint.style = Paint.Style.FILL
                paint.color = ACCENT
                c.drawCircle(cx, cy - s * 0.4f, s * 0.22f, paint)
            }
            else -> {                   // material chunk
                paint.color = col
                c.drawRect(cx - s, cy - s * 0.5f, cx, cy + s * 0.8f, paint)
                paint.color = brighten(col, 0.8f)
                c.drawRect(cx - s * 0.2f, cy - s * 0.8f, cx + s, cy + s * 0.4f, paint)
            }
        }
    }

    /**
     * One slot, drawn the same way in the hotbar and the backpack so the two
     * read as the same object. [index] >= 0 prints the hotbar key number.
     */
    fun drawSlot(
        c: Canvas,
        r: RectF,
        stack: Stack?,
        selected: Boolean,
        inHand: Boolean,
        index: Int,
        density: Float,
        p: Paint,
        tp: Paint,
    ) {
        val rad = 3f * density
        p.style = Paint.Style.FILL
        p.color = when {
            selected -> 0xFF3A3A33.toInt()
            inHand -> 0xFF2C2C26.toInt()
            else -> 0xE01B1B18.toInt()
        }
        c.drawRoundRect(r, rad, rad, p)

        p.style = Paint.Style.STROKE
        p.strokeWidth = if (inHand || selected) 2.2f * density else 1.2f * density
        p.color = when {
            selected -> 0xFFC8C3B4.toInt()
            inHand -> 0xFF8A8578.toInt()
            else -> EDGE
        }
        c.drawRoundRect(r, rad, rad, p)
        p.style = Paint.Style.FILL

        if (index >= 0) {
            tp.textAlign = Paint.Align.LEFT
            tp.textSize = 8f * density
            tp.color = 0xFF6E6B63.toInt()
            c.drawText("${index + 1}", r.left + 3f * density, r.top + 10f * density, tp)
        }

        if (stack == null) return
        drawItemIcon(c, r, stack.item, p)

        if (stack.count > 1) {
            tp.textAlign = Paint.Align.RIGHT
            tp.textSize = 10f * density
            val txt = "${stack.count}"
            val tw = tp.measureText(txt)
            // a plate behind the number so it stays readable over any icon
            p.color = 0xCC0E0E0C.toInt()
            c.drawRect(
                r.right - tw - 6f * density, r.bottom - 13f * density,
                r.right - 1f * density, r.bottom - 1f * density, p)
            tp.color = 0xFFDDD9CC.toInt()
            c.drawText(txt, r.right - 3f * density, r.bottom - 3.5f * density, tp)
        }
        tp.textAlign = Paint.Align.LEFT
    }

    private fun brighten(c: Int, f: Float): Int {
        val r = ((c shr 16 and 0xFF) * f).toInt().coerceIn(0, 255)
        val g = ((c shr 8 and 0xFF) * f).toInt().coerceIn(0, 255)
        val b = ((c and 0xFF) * f).toInt().coerceIn(0, 255)
        return (0xFF shl 24) or (r shl 16) or (g shl 8) or b
    }
}
